/**
 * Image Resolution: not a search. While this tool is open the page in the
 * active tab shows a card with the size of whatever image the pointer is over
 * (see content/image-inspector.js). This panel switches the inspector on and
 * off, follows the active tab, and keeps the last image so its details can be
 * read and copied after the pointer has moved on.
 */

import { MSG } from '../../../shared/constants.js';
import { copyToClipboard, el, setChildren } from '../../../shared/helpers.js';
import { onEvent, sendToBackground } from '../../../services/message-service.js';
import { loadSettings, saveSettings } from '../../../services/settings-service.js';
import { getLanguage } from '../../../services/i18n.js';
import { formatBytes, formatPixels, formatSize } from '../../../services/image-geometry.js';
import { ensureAccess } from '../../permissions.js';
import { describeError } from '../scan-ui.js';
import { icon } from '../../components/icons.js';

async function ensureStyles() {
  for (const file of ['../color-find/color-find.css', './image-resolution.css']) {
    const href = new URL(file, import.meta.url).href;
    if (document.querySelector(`link[href="${href}"]`)) continue;
    await new Promise((resolve) => {
      const link = el('link', { rel: 'stylesheet', href });
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
      document.head.append(link);
    });
  }
}

const OPTIONS = [
  { name: 'backgrounds', label: 'Include CSS background images', help: 'Pictures set with background-image, even under text and other elements.' },
  { name: 'outline', label: 'Outline the image on the page', help: 'Draws a frame around the picture the card is about.' },
  { name: 'preview', label: 'Show a small preview in the card', help: '' },
];

export function createFeature(ctx) {
  let refs = null;
  let enabled = true;
  let options = { backgrounds: true, outline: true, preview: true };
  let inspectedTabId = null;
  let sequence = 0;
  let last = null; // the last image reported by the page
  let lastTabKey = '';
  const disposers = [];

  /* ------------------------------------------------------------- Status */

  /** tone: 'on' | 'off' | 'warn' */
  function showStatus(tone, title, detail = '', actions = []) {
    refs.state.dataset.tone = tone;
    refs.stateTitle.textContent = title;
    refs.stateDetail.textContent = detail;
    refs.stateDetail.hidden = !detail;
    setChildren(
      refs.stateActions,
      actions.map((action) => el('button', { class: `btn btn--sm${action.primary ? ' btn--primary' : ''}`, type: 'button', onClick: action.onClick }, action.label)),
    );
    refs.stateActions.hidden = actions.length === 0;
    refs.toggle.setAttribute('aria-checked', String(enabled));
  }

  /** Is the page reachable right now, without asking the user for anything? */
  async function reachable(tabContext) {
    if (tabContext.hasHostAccess) return true;
    try {
      const probe = await sendToBackground(MSG.CHECK_ACCESS, { tabId: tabContext.tab.id });
      return !!probe.ok;
    } catch {
      return false;
    }
  }

  async function stopRunning() {
    const tabId = inspectedTabId;
    inspectedTabId = null;
    if (tabId === null) return;
    try {
      await sendToBackground(MSG.IMAGE_INSPECT, { tabId, enabled: false, sessionId: ctx.sessionId }, { timeoutMs: 6000 });
    } catch {
      /* the tab was closed or navigated away: nothing is left to stop */
    }
  }

  /** Make the page match what the panel wants: on for the active tab, or off. */
  async function apply({ withGesture = false } = {}) {
    const mine = ++sequence;
    const stale = () => mine !== sequence || !refs;

    if (!enabled) {
      await stopRunning();
      if (!stale()) showStatus('off', 'Inspector is off', 'Turn it on to see image sizes while you move the pointer over the page.');
      return;
    }

    const tabContext = ctx.getTabContext();
    if (!tabContext?.tab) {
      await stopRunning();
      if (!stale()) showStatus('warn', 'No page to inspect', 'Open a website in the active tab.');
      return;
    }
    if (tabContext.restricted) {
      await stopRunning();
      if (!stale()) showStatus('warn', "This page can't be inspected", tabContext.restrictionReason || 'Chrome does not let extensions run on this page.');
      return;
    }

    const tabId = tabContext.tab.id;
    if (inspectedTabId !== null && inspectedTabId !== tabId) await stopRunning();

    try {
      if (withGesture) await ensureAccess(tabContext, 'page');
      else if (!(await reachable(tabContext))) {
        await stopRunning();
        if (stale()) return;
        showStatus('warn', 'Allow access to this site', `The inspector needs permission to run on ${tabContext.origin || 'this page'}. Nothing leaves your device.`, [
          { label: 'Allow access', primary: true, onClick: () => apply({ withGesture: true }) },
        ]);
        return;
      }
      if (stale()) return;
      await sendToBackground(MSG.IMAGE_INSPECT, { tabId, enabled: true, options: { ...options, language: getLanguage() }, sessionId: ctx.sessionId }, { timeoutMs: 10000 });
      inspectedTabId = tabId; // remembered even if a newer change took over, so it can still be stopped
      if (stale()) return;
      showStatus('on', 'Inspector is on', 'Move the pointer over any image on the page. Press Esc on the page to stop.');
    } catch (error) {
      if (stale()) return;
      const info = describeError(error);
      showStatus('warn', "Couldn't start the inspector", info.message, [
        info.canGrant
          ? { label: 'Allow access', primary: true, onClick: () => apply({ withGesture: true }) }
          : { label: 'Try again', onClick: () => apply() },
      ]);
    }
  }

  /* --------------------------------------------------------- Last image */

  const row = (label, value, { mono = false, tone = '' } = {}) =>
    value ? el('div', { class: 'ir-row' }, el('span', {}, label), el('span', { class: `${mono ? 'mono' : ''} ${tone ? `ir-tone--${tone}` : ''}`.trim() }, value)) : null;

  function renderLast() {
    if (!last) {
      refs.last.hidden = true;
      return;
    }
    refs.last.hidden = false;
    const { display, natural } = last;
    const known = natural.w > 0 && natural.h > 0;
    const shortUrl = last.isData ? 'Inline image (data URL)' : last.url;
    setChildren(
      refs.lastBody,
      el(
        'div',
        { class: 'ir-last__top' },
        el('span', { class: 'ir-kind' }, last.kind),
        el('span', { class: 'ir-last__name', title: last.name }, last.name),
      ),
      el('div', { class: 'ir-size' }, formatSize(known ? natural.w : display.w, known ? natural.h : display.h), el('small', {}, known ? 'px actual size' : 'px displayed')),
      el(
        'div',
        { class: 'ir-rows' },
        row('Displayed on page', known ? `${formatSize(display.w, display.h)} px` : '', { mono: true }),
        row('Scale', last.scale?.text, { tone: last.scale?.tone }),
        row('Aspect ratio', last.ratio, { mono: true }),
        row('File', [last.format, formatBytes(last.bytes)].filter(Boolean).join(' · ')),
        row('Element box', last.box ? `${formatSize(last.box.w, last.box.h)} px` : '', { mono: true }),
        row('Alt text', last.alt ? (last.alt.length > 80 ? `${last.alt.slice(0, 79)}…` : last.alt) : ''),
      ),
      el('div', { class: 'ir-url', title: last.isData ? '' : last.url }, shortUrl),
    );
  }

  async function copy(text, noun) {
    if (await copyToClipboard(text)) ctx.notify.success(`${noun} copied.`);
    else ctx.notify.error('Could not copy to the clipboard.');
  }

  /* -------------------------------------------------------------- Mount */

  async function mount(container) {
    await ensureStyles();

    const toggle = el('button', { class: 'ir-switch', type: 'button', role: 'switch', 'aria-checked': 'true', 'aria-label': 'Inspect images on the page' }, el('span', { class: 'ir-switch__knob' }));
    const stateTitle = el('div', { class: 'ir-state__title' });
    const stateDetail = el('div', { class: 'ir-state__detail' });
    const stateActions = el('div', { class: 'ir-state__actions', hidden: true });
    const state = el(
      'div',
      { class: 'ir-state', dataset: { tone: 'off' } },
      el('div', { class: 'ir-state__icon' }, icon('image', 18)),
      el('div', { class: 'ir-state__text' }, stateTitle, stateDetail, stateActions),
      toggle,
    );

    const settings = (await loadSettings()).image;
    options = { backgrounds: settings.backgrounds, outline: settings.outline, preview: settings.preview };

    const optionBoxes = OPTIONS.map((option) => {
      const box = el('input', { type: 'checkbox', id: `ir-${option.name}` });
      box.checked = options[option.name];
      box.addEventListener('change', () => {
        options = { ...options, [option.name]: box.checked };
        saveSettings({ image: options });
        if (enabled && inspectedTabId !== null) apply();
      });
      return el('label', { class: 'cf-check', for: `ir-${option.name}`, title: option.help }, box, el('span', {}, option.label));
    });

    const lastBody = el('div', { class: 'ir-last__body' });
    const last_ = el(
      'div',
      { class: 'ir-last', hidden: true },
      el('div', { class: 'field-label' }, 'Last image'),
      lastBody,
      el(
        'div',
        { class: 'ir-last__actions' },
        el('button', { class: 'btn btn--sm', type: 'button', onClick: () => last && copy(last.natural.w > 0 ? `${last.natural.w}x${last.natural.h}` : `${formatPixels(last.display.w)}x${formatPixels(last.display.h)}`, 'Size') }, icon('copy', 14), 'Copy size'),
        el('button', { class: 'btn btn--sm', type: 'button', onClick: () => last && copy(last.url, 'Image address') }, icon('copy', 14), 'Copy address'),
      ),
    );

    container.replaceChildren(
      el(
        'section',
        { class: 'cf ir', 'aria-labelledby': 'ir-title' },
        el(
          'div',
          { class: 'cf-head' },
          el('h2', { id: 'ir-title', class: 'cf-title' }, 'Image Resolution'),
          el('p', { class: 'cf-lead' }, 'Hover any image on the page to see its width and height.'),
        ),
        state,
        el(
          'ul',
          { class: 'ir-tips' },
          el('li', {}, 'Works through text, buttons and other layers on top of an image.'),
          el('li', {}, 'Also reads CSS background images, such as hero banners.'),
          el('li', {}, 'Shows the size on the page, the image\'s own size and how they compare.'),
        ),
        el('div', { class: 'ir-options' }, optionBoxes),
        last_,
      ),
    );

    refs = { state, stateTitle, stateDetail, stateActions, toggle, last: last_, lastBody };

    toggle.addEventListener('click', () => {
      enabled = !enabled;
      apply({ withGesture: enabled });
    });

    disposers.push(
      onEvent(MSG.IMAGE_INSPECT_EVENT, (event) => {
        if (!refs || !event) return;
        if (event.type === 'hover' && event.info) {
          last = event.info;
          renderLast();
        } else if (event.type === 'stopped') {
          enabled = false;
          inspectedTabId = null;
          apply();
        }
      }),
    );

    // The inspector is on as soon as the tool is opened.
    lastTabKey = '';
    await apply();
  }

  /** The card in the page speaks the panel's language. */
  function onLanguageChange() {
    if (refs && enabled && inspectedTabId !== null) apply();
  }

  function unmount() {
    sequence += 1;
    disposers.splice(0).forEach((dispose) => dispose());
    const tabId = inspectedTabId;
    inspectedTabId = null;
    refs = null;
    if (tabId !== null) sendToBackground(MSG.IMAGE_INSPECT, { tabId, enabled: false, sessionId: ctx.sessionId }, { timeoutMs: 6000 }).catch(() => {});
  }

  function onTabContextChange(tabContext) {
    if (!refs) return;
    const key = `${tabContext?.tab?.id ?? ''}|${tabContext?.tab?.url ?? ''}`;
    if (key !== lastTabKey) {
      const switchedTab = lastTabKey && lastTabKey.split('|')[0] !== key.split('|')[0];
      lastTabKey = key;
      if (switchedTab) {
        last = null;
        renderLast();
      }
    }
    apply(); // follows the active tab and re-starts after a reload or navigation
  }

  return { mount, unmount, onTabContextChange, onLanguageChange };
}
