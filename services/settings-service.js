/**
 * User preferences in chrome.storage.local. Everything stays on this device.
 * Reads are validated/sanitized so a corrupted value can never break the UI.
 */

import { DEFAULT_CRAWL_OPTIONS, MATCH_MODE, STORAGE_KEYS } from '../shared/constants.js';
import { sanitizeCrawlOptions } from '../shared/validators.js';
import { normalizeLanguage } from './i18n.js';

export const DEFAULT_SETTINGS = Object.freeze({
  language: 'en',
  color: '',
  matchMode: MATCH_MODE.EXACT,
  includeInherited: false,
  groupMode: 'section',
  crawl: DEFAULT_CRAWL_OPTIONS,
  text: Object.freeze({
    query: '',
    matchCase: false,
    wholeWord: false,
    includeAttributes: false,
    visibleOnly: false,
    groupMode: 'section',
  }),
  phone: Object.freeze({
    query: '',
    exact: true,
    international: true,
    includeLinks: true,
    groupMode: 'section',
  }),
  href: Object.freeze({
    query: '',
    exact: true,
    looseHost: true,
    includeButtons: true,
    groupMode: 'section',
  }),
  // Only parentheses are ticked at first. (Stored under its own key, so older saved tick-boxes do not carry over.)
  widthText: Object.freeze({
    query: '',
    number: false,
    letter: false,
    bracket: true,
    colon: false,
    percent: false,
    mark: false,
    punct: false,
    symbol: false,
    space: false,
    highlightOnPage: true,
    groupMode: 'section',
  }),
  image: Object.freeze({
    backgrounds: true,
    outline: true,
    preview: true,
  }),
  font: Object.freeze({
    query: '',
    use: 'first',
    exact: true,
    primaryOnly: false,
    includeInherited: false,
    groupMode: 'section',
  }),
});

/** Saved options of a "find in page text" tool: strings and booleans only, anything else falls back to the default. */
function sanitizeSearchSettings(raw, defaults) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    if (key === 'query') out.query = typeof value.query === 'string' ? value.query.slice(0, 500) : fallback;
    else if (key === 'groupMode') out.groupMode = ['section', 'tag', 'none'].includes(value.groupMode) ? value.groupMode : fallback;
    else if (typeof fallback === 'string') out[key] = typeof value[key] === 'string' && value[key].length <= 20 ? value[key] : fallback;
    else out[key] = typeof value[key] === 'boolean' ? value[key] : fallback;
  }
  return out;
}

function sanitize(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    language: normalizeLanguage(value.language),
    color: typeof value.color === 'string' && value.color.length <= 100 ? value.color : DEFAULT_SETTINGS.color,
    matchMode: Object.values(MATCH_MODE).includes(value.matchMode) ? value.matchMode : DEFAULT_SETTINGS.matchMode,
    includeInherited: !!value.includeInherited,
    groupMode: ['section', 'property', 'none'].includes(value.groupMode) ? value.groupMode : DEFAULT_SETTINGS.groupMode,
    crawl: sanitizeCrawlOptions(value.crawl),
    text: sanitizeSearchSettings(value.text, DEFAULT_SETTINGS.text),
    phone: sanitizeSearchSettings(value.phone, DEFAULT_SETTINGS.phone),
    href: sanitizeSearchSettings(value.href, DEFAULT_SETTINGS.href),
    font: sanitizeSearchSettings(value.font, DEFAULT_SETTINGS.font),
    widthText: sanitizeSearchSettings(value.widthText, DEFAULT_SETTINGS.widthText),
    image: sanitizeSearchSettings(value.image, DEFAULT_SETTINGS.image),
  };
}

export async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return sanitize(stored[STORAGE_KEYS.SETTINGS]);
  } catch {
    return sanitize(null);
  }
}

/** Merge `patch` into the stored settings. */
export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = sanitize({
    ...current,
    ...patch,
    crawl: { ...current.crawl, ...(patch.crawl || {}) },
    text: { ...current.text, ...(patch.text || {}) },
    phone: { ...current.phone, ...(patch.phone || {}) },
    href: { ...current.href, ...(patch.href || {}) },
    font: { ...current.font, ...(patch.font || {}) },
    widthText: { ...current.widthText, ...(patch.widthText || {}) },
    image: { ...current.image, ...(patch.image || {}) },
  });
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
  } catch {
    /* non-fatal: preferences just will not persist */
  }
  return next;
}
