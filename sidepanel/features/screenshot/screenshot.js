/**
 * Screenshot Taker: the side panel part. It offers the three ways to take a
 * picture (Full Page, Current Screen, Select Area), starts the capture in the
 * active tab and shows what is happening. The picture itself, and the editor
 * (draw, copy, save), live in the page: see content/screenshot*.js.
 */

import { ERR, MSG } from '../../../shared/constants.js';
import { el, setChildren } from '../../../shared/helpers.js';
import { onEvent, sendToBackground } from '../../../services/message-service.js';
import { getLanguage } from '../../../services/i18n.js';
import { comboKeys, combosEqual, readCombo, sanitizeCombo } from '../../../services/screenshot-hotkey.js';
import { loadSettings, saveSettings } from '../../../services/settings-service.js';
import { ensureAllHostsAccess, ensureCaptureAccess } from '../../permissions.js';
import { describeError } from '../scan-ui.js';
import { icon } from '../../components/icons.js';
import { createProgressBar } from '../../components/loading.js';

async function ensureStyles() {
  for (const file of ['../color-find/color-find.css', '../image-resolution/image-resolution.css', './screenshot.css']) {
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

const MODES = [
  { id: 'full', icon: 'fullpage', title: 'Full Page', text: 'Scrolls through the whole page and joins it into one picture.' },
  { id: 'current', icon: 'monitor', title: 'Current Screen', text: 'Only what you can see in the tab right now.' },
  { id: 'area', icon: 'crop', title: 'Select Area', text: 'Drag a rectangle over the part of the page you want.' },
];

const SHORTCUTS = [
  [['P', 'L', 'A', 'C', 'R', 'S', 'T'], 'Pen, Line, Arrow, Circle, Rectangle, Square, Text'],
  [['Shift'], 'Keeps a circle, a rectangle or a line straight'],
  [['Ctrl', 'Z'], 'Undo (add Shift to redo)'],
  [['Ctrl', 'C'], 'Copy to the clipboard'],
  [['Ctrl', 'S'], 'Save as a PNG file'],
  [['Esc'], 'Close'],
];

export function createFeature(ctx) {
  let refs = null;
  let busy = false; // a capture is running or the editor is open
  let runTabId = null;
  let starting = false;
  let phase = 'idle'; // 'idle' | 'selecting' | 'capturing' | 'editing'
  let savedShortcut = null;
  let draftShortcut = null;
  let listening = false;
  let shortcutBusy = false;
  const disposers = [];

  function stopListening() {
    listening = false;
  }

  function onShortcutCapture(event) {
    if (!refs || event.repeat) return;
    if (event.key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      draftShortcut = null;
      refs.capture.blur();
      return;
    }
    const next = readCombo(event);
    if (!next) return;
    draftShortcut = next;
    listening = true;
    renderShortcut();
  }

  function beginListening() {
    if (shortcutBusy || listening) return;
    listening = true;
    renderShortcut();
  }

  function endListening() {
    if (!listening) return;
    stopListening();
    renderShortcut();
  }

  function renderShortcut(hint = '', tone = '') {
    if (!refs) return;
    const shown = draftShortcut || savedShortcut;
    const keys = comboKeys(shown);
    const usable = sanitizeCombo(draftShortcut);
    refs.capture.dataset.listening = listening ? 'true' : 'false';
    refs.capture.value = keys.length ? keys.join(' + ') : '';
    refs.capture.placeholder = listening ? 'Press keys…' : 'Click here, then press a shortcut';
    refs.save.disabled = shortcutBusy || !usable || combosEqual(usable, savedShortcut);
    refs.clear.disabled = shortcutBusy || (!savedShortcut && !draftShortcut);
    refs.hint.textContent =
      hint ||
      (usable
        ? 'Click Save to use this shortcut on any website.'
        : listening
          ? 'Press the key or combination you want, then click Save.'
          : '');
    refs.hint.hidden = !refs.hint.textContent;
    refs.hint.dataset.tone = tone;
  }

  async function saveShortcut() {
    const combo = sanitizeCombo(draftShortcut);
    if (!combo || shortcutBusy) return;
    shortcutBusy = true;
    renderShortcut();
    let hint = '';
    let tone = '';
    try {
      await ensureAllHostsAccess();
      const settings = await saveSettings({ screenshot: { shortcut: combo } });
      savedShortcut = settings.screenshot.shortcut;
      draftShortcut = null;
      await sendToBackground(MSG.SCREENSHOT_SET_HOTKEY, { shortcut: savedShortcut }, { timeoutMs: 8000 });
      hint = 'Shortcut saved. Press it on a website to select an area.';
      tone = 'ok';
    } catch (error) {
      hint = error?.message || 'Could not save the shortcut.';
      tone = 'warn';
    } finally {
      shortcutBusy = false;
      renderShortcut(hint, tone);
    }
  }

  async function clearShortcut() {
    if (shortcutBusy) return;
    shortcutBusy = true;
    renderShortcut();
    let hint = '';
    let tone = '';
    try {
      await saveSettings({ screenshot: { shortcut: null } });
      savedShortcut = null;
      draftShortcut = null;
      await sendToBackground(MSG.SCREENSHOT_SET_HOTKEY, { shortcut: null }, { timeoutMs: 8000 });
    } catch (error) {
      hint = error?.message || 'Could not save the shortcut.';
      tone = 'warn';
    } finally {
      shortcutBusy = false;
      renderShortcut(hint, tone);
    }
  }

  /** tone: 'idle' | 'on' | 'warn' | 'busy' */
  function showStatus(tone, title, detail = '', { actions = [], fraction } = {}) {
    refs.state.hidden = tone === 'idle';
    refs.state.dataset.tone = tone;
    refs.stateTitle.textContent = title;
    refs.stateDetail.textContent = detail;
    refs.stateDetail.hidden = !detail;
    refs.progress.element.hidden = fraction === undefined;
    if (fraction !== undefined) refs.progress.set(fraction);
    setChildren(
      refs.stateActions,
      actions.map((action) => el('button', { class: `btn btn--sm${action.primary ? ' btn--primary' : ''}`, type: 'button', onClick: action.onClick }, action.label)),
    );
    refs.stateActions.hidden = actions.length === 0;
    refs.stateIcon.replaceChildren(icon(tone === 'warn' ? 'alert' : tone === 'on' ? 'check' : 'camera', 18));
  }

  function setBusy(value) {
    busy = value;
    if (!refs) return;
    refs.cards.forEach((card) => {
      card.disabled = value || !!refs.blocked;
    });
  }

  /** The active tab cannot be photographed (no tab, or a Chrome page). */
  function applyTabState(tabContext) {
    if (!refs) return;
    let blocked = null;
    if (!tabContext?.tab) blocked = 'Open a website in the active tab to take a screenshot.';
    else if (tabContext.restricted) blocked = tabContext.restrictionReason || 'Chrome does not let extensions capture this page.';
    refs.cards.forEach((card) => {
      card.disabled = busy || !!blocked;
    });
    refs.blocked = blocked;
    if (busy) return;
    if (blocked) {
      showStatus('warn', "This page can't be captured", blocked);
      refs.blockedShown = true;
    } else if (refs.blockedShown) {
      refs.blockedShown = false;
      showStatus('idle', '');
    }
  }

  async function cancel() {
    const tabId = runTabId;
    if (tabId === null) return;
    try {
      await sendToBackground(MSG.SCREENSHOT_CANCEL, { tabId }, { timeoutMs: 6000 });
    } catch {
      /* the tab is gone: nothing is left to cancel */
    }
    finish();
  }

  function finish() {
    runTabId = null;
    phase = 'idle';
    setBusy(false);
  }

  async function start(mode, { withGesture = true } = {}) {
    if (busy || starting || !refs) return;
    starting = true;
    try {
      await ctx.refreshTabContext?.();
    } catch {
      /* the last known context is used */
    }
    const tabContext = ctx.getTabContext();
    try {
      if (withGesture) await ensureCaptureAccess(tabContext);
      setBusy(true);
      runTabId = tabContext.tab.id;
      const label = mode === 'area' ? 'Starting…' : 'Capturing…';
      showStatus('busy', label, '', { actions: [{ label: 'Cancel', onClick: cancel }], fraction: null });
      await sendToBackground(
        MSG.SCREENSHOT_START,
        { tabId: runTabId, mode, language: getLanguage(), sessionId: ctx.sessionId },
        { timeoutMs: 10000 },
      );
    } catch (error) {
      finish();
      showError(error, mode);
    } finally {
      starting = false;
    }
  }

  function showError(error, mode) {
    const info = describeError(error);
    let message = info.message;
    if (error?.code === ERR.TAB_NOT_ACTIVE || error?.code === ERR.CAPTURE_FAILED) message = error.message;
    showStatus('warn', "Couldn't take the screenshot", message, {
      actions: [
        info.canGrant ? { label: 'Allow access', primary: true, onClick: () => start(mode) } : { label: 'Try again', onClick: () => start(mode) },
      ],
    });
  }

  /** What the page reports while it works. */
  function onShotEvent(event) {
    if (!refs || !event || runTabId === null) return;
    const cancelAction = [{ label: 'Cancel', onClick: cancel }];
    if (['selecting', 'capturing', 'editing'].includes(event.state)) phase = event.state;
    switch (event.state) {
      case 'selecting':
        showStatus('busy', 'Select an area on the page', 'Drag a rectangle, then drag it to adjust. Enter or a tool takes the picture.', { actions: cancelAction });
        break;
      case 'capturing':
        if (event.progress) {
          const { current, total } = event.progress;
          showStatus('busy', `Capturing the page… ${current} of ${total}`, 'Keep this tab open. The page scrolls by itself. Press Esc on the page to stop.', { actions: cancelAction, fraction: (current - 1) / total });
        } else showStatus('busy', 'Capturing…', '', { fraction: null });
        break;
      case 'editing':
        showStatus('on', 'The editor is open on the page', 'Draw on the picture. Copy or Save also closes the editor.', { actions: cancelAction.map((action) => ({ ...action, label: 'Close editor' })) });
        break;
      case 'done':
        finish();
        showStatus('idle', '');
        break;
      case 'cancelled':
        finish();
        showStatus('idle', '');
        break;
      case 'error':
        finish();
        showError({ code: event.code, message: event.message }, null);
        break;
      default:
        break;
    }
  }

  async function mount(container) {
    await ensureStyles();

    const stateIcon = el('div', { class: 'ir-state__icon' });
    const stateTitle = el('div', { class: 'ir-state__title' });
    const stateDetail = el('div', { class: 'ir-state__detail' });
    const progress = createProgressBar();
    progress.element.hidden = true;
    progress.element.classList.add('shot-progress');
    const stateActions = el('div', { class: 'ir-state__actions', hidden: true });
    const state = el('div', { class: 'ir-state shot-state', role: 'status', hidden: true, dataset: { tone: 'idle' } }, stateIcon, el('div', { class: 'ir-state__text' }, stateTitle, stateDetail, progress.element, stateActions));

    const cards = MODES.map((mode) =>
      el(
        'button',
        { class: 'shot-card', type: 'button', dataset: { mode: mode.id }, onClick: () => start(mode.id) },
        el('span', { class: 'shot-card__icon' }, icon(mode.icon, 20)),
        el('span', { class: 'shot-card__text' }, el('span', { class: 'shot-card__title' }, mode.title), el('span', { class: 'shot-card__desc' }, mode.text)),
        el('span', { class: 'shot-card__go' }, icon('chevron', 16)),
      ),
    );

    const capture = el('input', {
      class: 'shot-hotkey__capture',
      type: 'text',
      readonly: true,
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: 'Click here, then press a shortcut',
      'aria-label': 'Select Area shortcut',
      onFocus: beginListening,
      onBlur: endListening,
      onKeyDown: onShortcutCapture,
    });
    const save = el('button', { class: 'btn btn--sm btn--primary', type: 'button', onClick: saveShortcut }, 'Save');
    const clear = el('button', { class: 'btn btn--sm', type: 'button', onClick: clearShortcut }, 'Clear');
    const hint = el('p', { class: 'shot-hotkey__hint', hidden: true });
    const shortcuts = el(
      'details',
      { class: 'shot-help' },
      el('summary', {}, 'Editor tools and shortcuts'),
      el('dl', { class: 'shot-keys' }, SHORTCUTS.flatMap(([keys, text]) => [el('dt', { class: 'shot-keys__keys' }, keys.map((key) => el('kbd', {}, key))), el('dd', {}, text)])),
      el(
        'div',
        { class: 'shot-hotkey' },
        el('div', { class: 'shot-hotkey__title' }, 'Select Area shortcut'),
        el('p', { class: 'shot-hotkey__text' }, 'Works on any website without opening this panel. Select an area, then Copy or Save. The overlay closes; this panel stays closed.'),
        el('div', { class: 'shot-hotkey__row' }, capture, save, clear),
        hint,
      ),
      el('p', { class: 'shot-note' }, 'Full Page shows fixed and sticky bars once. Pages that scroll inside a panel are captured as you see them.'),
    );

    container.replaceChildren(
      el(
        'section',
        { class: 'cf shot', 'aria-labelledby': 'shot-title' },
        el('div', { class: 'cf-head' }, el('h2', { id: 'shot-title', class: 'cf-title' }, 'Screenshot Taker'), el('p', { class: 'cf-lead' }, 'Capture a page, mark it up, then copy or save it.')),
        el('div', { class: 'shot-cards', role: 'group', 'aria-label': 'Capture' }, cards),
        state,
        shortcuts,
      ),
    );

    refs = { state, stateTitle, stateDetail, stateActions, stateIcon, progress, cards, capture, save, clear, hint, blocked: null, blockedShown: false };
    disposers.push(onEvent(MSG.SCREENSHOT_EVENT, onShotEvent));
    applyTabState(ctx.getTabContext());
    loadSettings()
      .then((settings) => {
        savedShortcut = settings.screenshot.shortcut;
        renderShortcut();
      })
      .catch(() => renderShortcut());
  }

  function unmount() {
    stopListening();
    disposers.splice(0).forEach((dispose) => dispose());
    refs = null;
    // Leaving the tool while choosing or capturing: stop it. An open editor stays, so the user's drawing is not lost.
    if (runTabId !== null && phase !== 'editing') sendToBackground(MSG.SCREENSHOT_CANCEL, { tabId: runTabId }, { timeoutMs: 6000 }).catch(() => {});
    runTabId = null;
    phase = 'idle';
    busy = false;
  }

  return { mount, unmount, onTabContextChange: applyTabState };
}
