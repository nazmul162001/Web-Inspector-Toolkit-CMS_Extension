/**
 * Select Area shortcut: turn a key press into a stored combo, and decide
 * whether a later press is the same combo. No Chrome APIs - the panel, the
 * page listener and the tests all share this.
 */

const FORBIDDEN_KEYS = new Set(['escape', 'tab', 'capslock', 'control', 'alt', 'shift', 'meta', 'os', 'contextmenu']);

const NAMED_KEYS = Object.freeze({
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
});

const KEY_LABELS = Object.freeze({
  space: 'Space',
  enter: 'Enter',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  home: 'Home',
  end: 'End',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  insert: 'Insert',
  delete: 'Delete',
  backspace: 'Backspace',
});

/** The character or named key of a KeyboardEvent, or null if it cannot be a shortcut. */
export function normalizeKey(event) {
  if (!event) return null;
  const key = event.key || '';
  if (key.length === 1 && key !== ' ') {
    const lower = key.toLowerCase();
    return FORBIDDEN_KEYS.has(lower) ? null : lower;
  }
  const code = event.code || '';
  if (/^F([1-9]|1[0-2])$/.test(code)) return code.toLowerCase();
  return NAMED_KEYS[key] || NAMED_KEYS[code] || null;
}

export function isUsableCombo(combo) {
  if (!combo || typeof combo.key !== 'string' || !combo.key || combo.key.length > 20) return false;
  return !FORBIDDEN_KEYS.has(combo.key);
}

function toCombo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    key: typeof raw.key === 'string' ? raw.key.toLowerCase().slice(0, 20) : '',
    ctrl: !!raw.ctrl,
    alt: !!raw.alt,
    shift: !!raw.shift,
    meta: !!raw.meta,
  };
}

/** Stored or incoming value: a usable combo, or null. */
export function sanitizeCombo(raw) {
  const combo = toCombo(raw);
  return isUsableCombo(combo) ? combo : null;
}

/** The key plus modifiers from a keydown, or null while only modifiers are held. */
export function readCombo(event) {
  const key = normalizeKey(event);
  if (!key) return null;
  return {
    key,
    ctrl: !!event.ctrlKey,
    alt: !!event.altKey,
    shift: !!event.shiftKey,
    meta: !!event.metaKey,
  };
}

/** A finished shortcut from a keydown, or null while only modifiers are held. */
export function comboFromEvent(event) {
  return sanitizeCombo(readCombo(event));
}

export function combosEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.key === b.key && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta;
}

export function matchesCombo(event, combo) {
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

export function comboKeys(combo) {
  const raw = combo && typeof combo === 'object' ? toCombo(combo) : null;
  if (!raw) return [];
  const keys = [];
  if (raw.ctrl) keys.push('Ctrl');
  if (raw.alt) keys.push('Alt');
  if (raw.shift) keys.push('Shift');
  if (raw.meta) keys.push('⌘');
  if (raw.key && !FORBIDDEN_KEYS.has(raw.key)) {
    keys.push(KEY_LABELS[raw.key] || raw.key.toUpperCase());
  }
  return keys;
}

export function formatCombo(combo) {
  return comboKeys(combo).join('+');
}

/** True when a key press is meant for a field, not for a page shortcut. */
export function isTypingTarget(node) {
  if (!node) return false;
  const element = node.nodeType === 1 ? node : node.parentElement;
  if (!element || typeof element.closest !== 'function') return false;
  if (element.isContentEditable) return true;
  return !!element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}
