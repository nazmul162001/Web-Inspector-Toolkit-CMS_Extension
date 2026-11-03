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
import { formatBytes, formatSize } from '../../../services/image-geometry.js';
import {
  DOWNLOAD_FORMAT_LABELS,
  DOWNLOAD_FORMATS,
  exportImage,
  isTruncatedUrl,
  preferredDownloadFormat,
  isAutoHeight,
  sanitizeExportSize,
  saveBlob,
} from '../../../services/image-export.js';
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
  let downloading = false;
  let previewSeq = 0;
  let downloadPrefs = { sizeMode: 'original', customWidth: '', customHeight: 'auto' };
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

  function previewSrc(info) {
    if (!info?.url || isTruncatedUrl(info.url) || /^blob:/i.test(info.url)) return '';
    return info.url;
  }

  function renderLast() {
    if (!last) {
      refs.last.hidden = true;
      previewSeq += 1;
      return;
    }
    refs.last.hidden = false;
    const { display, natural } = last;
    const known = natural.w > 0 && natural.h > 0;
    const shortUrl = last.isData ? 'Inline image (data URL)' : last.url;
    const src = previewSrc(last);
    const thumb = el('img', { alt: last.alt || last.name || '', draggable: 'false' });
    const preview = el('div', { class: 'ir-preview', hidden: !options.preview });
    const hideBroken = () => {
      preview.hidden = true;
    };
    if (src) {
      thumb.addEventListener('error', hideBroken);
      thumb.src = src;
    }
    preview.append(thumb);
    setChildren(
      refs.lastBody,
      el(
        'div',
        { class: 'ir-last__head' },
        el(
          'div',
          { class: 'ir-last__meta' },
          el(
            'div',
            { class: 'ir-last__top' },
            el('span', { class: 'ir-kind' }, last.kind),
            el('span', { class: 'ir-last__name', title: last.name }, last.name),
          ),
          el('div', { class: 'ir-size' }, formatSize(known ? natural.w : display.w, known ? natural.h : display.h), el('small', {}, known ? 'px actual size' : 'px displayed')),
        ),
        preview,
      ),
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
    if (refs.format) refs.format.value = preferredDownloadFormat(last.format);
    syncCustomPanel();
    if (options.preview && !src) fillPreview(thumb, preview);
  }

  async function fillPreview(thumb, preview) {
    const mine = ++previewSeq;
    try {
      const url = await sourceUrl();
      if (mine !== previewSeq || !refs || !last || !options.preview) return;
      if (!url || isTruncatedUrl(url) || /^blob:/i.test(url)) {
        preview.hidden = true;
        return;
      }
      thumb.addEventListener('error', () => {
        preview.hidden = true;
      });
      thumb.src = url;
      preview.hidden = false;
    } catch {
      if (mine === previewSeq) preview.hidden = true;
    }
  }

  function persistDownloadPrefs() {
    saveSettings({
      image: {
        sizeMode: downloadPrefs.sizeMode,
        customWidth: downloadPrefs.customWidth,
        customHeight: downloadPrefs.customHeight,
      },
    });
  }

  function syncCustomPanel() {
    if (!refs?.custom) return;
    const custom = downloadPrefs.sizeMode === 'custom';
    refs.sizeMode.value = custom ? 'custom' : 'original';
    refs.custom.hidden = !last || !custom;
  }

  function readCustomSize() {
    const natural = last?.natural;
    if (!sanitizeExportSize(refs.width?.value, 'auto')) return { error: 'Enter a width.' };
    const size = sanitizeExportSize(refs.width.value, refs.height?.value, {
      sourceWidth: natural?.w,
      sourceHeight: natural?.h,
    });
    if (!size) return { error: 'Enter a valid height, or leave it as auto.' };
    return { size };
  }

  function rememberCustomSize(size) {
    downloadPrefs.customWidth = String(size.w);
    downloadPrefs.customHeight = size.autoHeight || isAutoHeight(refs.height?.value) ? 'auto' : String(size.h);
    if (refs.width) refs.width.value = downloadPrefs.customWidth;
    if (refs.height) refs.height.value = downloadPrefs.customHeight;
    persistDownloadPrefs();
  }

  function saveCustomSize() {
    const { size, error } = readCustomSize();
    if (!size) {
      ctx.notify.error(error);
      return;
    }
    rememberCustomSize(size);
    ctx.notify.success('Custom size saved.');
  }

  function onSizeModeChange() {
    downloadPrefs.sizeMode = refs.sizeMode.value === 'custom' ? 'custom' : 'original';
    persistDownloadPrefs();
    syncCustomPanel();
  }

  async function copy(text, noun) {
    if (await copyToClipboard(text)) ctx.notify.success(`${noun} copied.`);
    else ctx.notify.error('Could not copy to the clipboard.');
  }

  async function sourceUrl() {
    const tabId = ctx.getTabContext()?.tab?.id;
    if (Number.isInteger(tabId)) {
      try {
        const source = await sendToBackground(MSG.IMAGE_SOURCE, { tabId }, { timeoutMs: 20000 });
        if (source?.url) return source.url;
      } catch {
        /* inspector not running in this tab; use what the panel already has */
      }
    }
    return last.url;
  }

  async function downloadLast() {
    if (!last || downloading) return;
    downloading = true;
    if (refs.download) refs.download.disabled = true;
    try {
      const url = await sourceUrl();
      if (isTruncatedUrl(url)) {
        throw new Error('The image address is incomplete. Hover the image again and try downloading.');
      }
      const format = DOWNLOAD_FORMATS.includes(refs.format?.value) ? refs.format.value : preferredDownloadFormat(last.format);
      let size = null;
      if (downloadPrefs.sizeMode === 'custom') {
        const read = readCustomSize();
        if (!read.size) throw new Error(read.error);
        size = read.size;
        rememberCustomSize(size);
      }
      const { blob, filename } = await exportImage(url, format, {
        name: last.name,
        width: size?.w,
        height: size?.autoHeight ? 'auto' : size?.h,
      });
      saveBlob(blob, filename);
      ctx.notify.success('Image saved.');
    } catch (error) {
      ctx.notify.error(error?.message || 'The image could not be downloaded.');
    } finally {
      downloading = false;
      if (refs?.download) refs.download.disabled = false;
    }
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
    downloadPrefs = { sizeMode: settings.sizeMode, customWidth: settings.customWidth, customHeight: settings.customHeight };

    const optionBoxes = OPTIONS.map((option) => {
      const box = el('input', { type: 'checkbox', id: `ir-${option.name}` });
      box.checked = options[option.name];
      box.addEventListener('change', () => {
        options = { ...options, [option.name]: box.checked };
        saveSettings({ image: options });
        if (option.name === 'preview') renderLast();
        if (enabled && inspectedTabId !== null) apply();
      });
      return el('label', { class: 'cf-check', for: `ir-${option.name}`, title: option.help }, box, el('span', {}, option.label));
    });

    const lastBody = el('div', { class: 'ir-last__body' });
    const formatSelect = el(
      'select',
      { class: 'select ir-format__select', 'aria-label': 'Download format', 'data-i18n-skip': true },
      ...DOWNLOAD_FORMATS.map((value) => el('option', { value }, DOWNLOAD_FORMAT_LABELS[value])),
    );
    const sizeSelect = el(
      'select',
      { class: 'select ir-size-select', 'aria-label': 'Download size', onChange: () => onSizeModeChange() },
      el('option', { value: 'original' }, 'Original size'),
      el('option', { value: 'custom' }, 'Custom'),
    );
    sizeSelect.value = downloadPrefs.sizeMode === 'custom' ? 'custom' : 'original';
    const widthInput = el('input', {
      class: 'input ir-custom__input',
      type: 'number',
      min: '1',
      max: '8192',
      step: '1',
      inputmode: 'numeric',
      'aria-label': 'Width',
      placeholder: 'Width',
      value: downloadPrefs.customWidth,
    });
    const heightInput = el('input', {
      class: 'input ir-custom__input',
      type: 'text',
      inputmode: 'numeric',
      'aria-label': 'Height',
      placeholder: 'Auto',
      value: downloadPrefs.customHeight || 'auto',
      spellcheck: 'false',
    });
    const saveSizeBtn = el('button', { class: 'btn btn--sm', type: 'button', onClick: () => saveCustomSize() }, 'Save');
    const customPanel = el(
      'div',
      { class: 'ir-custom', hidden: true },
      el('label', { class: 'ir-custom__field' }, el('span', { class: 'field-label' }, 'Width'), widthInput),
      el('label', { class: 'ir-custom__field' }, el('span', { class: 'field-label' }, 'Height'), heightInput),
      saveSizeBtn,
    );
    const downloadBtn = el('button', { class: 'btn btn--sm', type: 'button', onClick: () => downloadLast() }, icon('download', 14), 'Download');
    const last_ = el(
      'div',
      { class: 'ir-last', hidden: true },
      el('div', { class: 'field-label' }, 'Last image'),
      lastBody,
      el(
        'div',
        { class: 'ir-last__actions' },
        el('button', { class: 'btn btn--sm', type: 'button', onClick: () => last && copy(last.url, 'Image address') }, icon('copy', 14), 'Copy address'),
        el('div', { class: 'ir-download' }, downloadBtn, formatSelect, sizeSelect),
      ),
      customPanel,
    );

    container.replaceChildren(
      el(
        'section',
        { class: 'cf ir', 'aria-labelledby': 'ir-title' },
        el(
          'div',
          { class: 'cf-head' },
          el('h2', { id: 'ir-title', class: 'cf-title' }, 'Inspect/Download image'),
          el('p', { class: 'cf-lead' }, 'Hover any image on the page to see its width and height.'),
        ),
        state,
        el(
          'ul',
          { class: 'ir-tips' },
          el('li', {}, 'Works through text, buttons and other layers on top of an image.'),
          el('li', {}, 'Also reads CSS background images and pictures drawn with ::before / ::after.'),
          el('li', {}, 'Shows the size on the page, the image\'s own size and how they compare.'),
        ),
        el('div', { class: 'ir-options' }, optionBoxes),
        last_,
      ),
    );

    refs = {
      state,
      stateTitle,
      stateDetail,
      stateActions,
      toggle,
      last: last_,
      lastBody,
      download: downloadBtn,
      format: formatSelect,
      sizeMode: sizeSelect,
      custom: customPanel,
      width: widthInput,
      height: heightInput,
    };

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
