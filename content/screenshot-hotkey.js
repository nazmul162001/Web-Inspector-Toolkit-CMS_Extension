/**
 * Select Area shortcut listener. Classic script on purpose:
 * chrome.scripting.registerContentScripts cannot load ES modules, and a
 * dynamic chrome-extension module load is blocked on sites (YouTube) whose
 * service worker intercepts those fetches.
 */
(() => {
  if (globalThis.__witShotHotkey) return;
  globalThis.__witShotHotkey = true;

  const MSG_TYPE = 'wit/screenshot-hotkey';
  const SETTINGS_KEY = 'wit.settings';
  const OVERLAY_IDS = ['wit-screenshot-selector', 'wit-screenshot-editor'];
  const FORBIDDEN = new Set(['escape', 'tab', 'capslock', 'control', 'alt', 'shift', 'meta', 'os', 'contextmenu']);
  const NAMED = {
    ' ': 'space',
    Space: 'space',
    Enter: 'enter',
    ArrowUp: 'arrowup',
    ArrowDown: 'arrowdown',
    ArrowLeft: 'arrowleft',
    ArrowRight: 'arrowright',
    Home: 'home',
    End: 'end',
    PageUp: 'pageup',
    PageDown: 'pagedown',
    Insert: 'insert',
    Delete: 'delete',
    Backspace: 'backspace',
  };

  function normalizeKey(event) {
    if (!event) return null;
    const key = event.key || '';
    if (key.length === 1 && key !== ' ') {
      const lower = key.toLowerCase();
      return FORBIDDEN.has(lower) ? null : lower;
    }
    const code = event.code || '';
    if (/^F([1-9]|1[0-2])$/.test(code)) return code.toLowerCase();
    return NAMED[key] || NAMED[code] || null;
  }

  function sanitizeCombo(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const combo = {
      key: typeof raw.key === 'string' ? raw.key.toLowerCase().slice(0, 20) : '',
      ctrl: !!raw.ctrl,
      alt: !!raw.alt,
      shift: !!raw.shift,
      meta: !!raw.meta,
    };
    if (!combo.key || combo.key.length > 20 || FORBIDDEN.has(combo.key)) return null;
    return combo;
  }

  function matchesCombo(event, combo) {
    const wanted = sanitizeCombo(combo);
    if (!wanted || !event || event.repeat) return false;
    return (
      !!event.ctrlKey === wanted.ctrl &&
      !!event.altKey === wanted.alt &&
      !!event.shiftKey === wanted.shift &&
      !!event.metaKey === wanted.meta &&
      normalizeKey(event) === wanted.key
    );
  }

  function isTypingTarget(node) {
    if (!node) return false;
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || typeof element.closest !== 'function') return false;
    if (element.isContentEditable) return true;
    return !!element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  }

  let combo = null;
  let starting = false;

  function readStored(raw) {
    combo = sanitizeCombo(raw && raw[SETTINGS_KEY] && raw[SETTINGS_KEY].screenshot && raw[SETTINGS_KEY].screenshot.shortcut);
  }

  function overlayOpen() {
    return OVERLAY_IDS.some((id) => document.getElementById(id));
  }

  function onKeyDown(event) {
    if (!combo || starting || overlayOpen() || isTypingTarget(event.target)) return;
    if (!matchesCombo(event, combo)) return;
    event.preventDefault();
    event.stopPropagation();
    starting = true;
    const id = `hotkey_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    Promise.resolve(
      chrome.runtime.sendMessage({ __wit: 1, id, type: MSG_TYPE, payload: {}, ts: Date.now() }),
    )
      .catch(() => {})
      .finally(() => {
        starting = false;
      });
  }

  chrome.storage.local.get(SETTINGS_KEY, readStored);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    readStored({ [SETTINGS_KEY]: changes[SETTINGS_KEY].newValue });
  });
  document.addEventListener('keydown', onKeyDown, true);
})();
