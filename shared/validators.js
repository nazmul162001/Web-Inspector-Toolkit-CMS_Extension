/**
 * Input validation shared by the side panel (fail fast, show friendly errors)
 * and the service worker (never trust a message payload).
 */

import { normalizeColor } from '../services/color-normalizer.js';
import { isPhoneQuery, sanitizePhoneQuery } from '../services/phone-matcher.js';
import { isTextQuery, sanitizeTextQuery } from '../services/text-matcher.js';
import { CRAWL_LIMITS, CRAWL_MODE, DEFAULT_CRAWL_OPTIONS, ERR, NEAR_TOLERANCE, SCOPE } from './constants.js';
import { clamp, createError } from './helpers.js';

/** Validate the Color Find text input. */
export function validateColorInput(input) {
  const result = normalizeColor(input, { allowBareHex: true });
  return result.ok ? result : { ok: false, error: result.error };
}

/** Is `value` a canonical { r, g, b, a } with integer 0..255 channels? */
export function isCanonicalColor(value) {
  return (
    !!value &&
    ['r', 'g', 'b', 'a'].every(
      (key) => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 255,
    )
  );
}

/** A scan target is a canonical color, a text query or a phone number query. */
export const isScanTarget = (value) => isCanonicalColor(value) || isTextQuery(value) || isPhoneQuery(value);

export const isValidScope = (scope) => scope === SCOPE.PAGE || scope === SCOPE.SITE;

/** Clamp every crawl option into its allowed range, filling defaults. */
export function sanitizeCrawlOptions(raw = {}) {
  const out = {
    mode: Object.values(CRAWL_MODE).includes(raw?.mode) ? raw.mode : DEFAULT_CRAWL_OPTIONS.mode,
  };
  for (const [key, fallback] of Object.entries(DEFAULT_CRAWL_OPTIONS)) {
    if (key === 'mode') continue;
    const { min, max } = CRAWL_LIMITS[key];
    const value = Number(raw?.[key]);
    out[key] = Number.isFinite(value) ? clamp(Math.round(value), min, max) : fallback;
  }
  return out;
}

const RESTRICTED_SCHEMES = ['chrome:', 'chrome-extension:', 'chrome-untrusted:', 'chrome-search:',
  'devtools:', 'edge:', 'about:', 'view-source:', 'chrome-error:'];

const RESTRICTED_HOSTS = [
  { host: 'chromewebstore.google.com' },
  { host: 'chrome.google.com', pathPrefix: '/webstore' },
];

/**
 * Pages extensions cannot inspect.
 * @returns {{ restricted: boolean, reason?: string, code?: string }}
 */
export function checkRestrictedUrl(url) {
  if (!url) return { restricted: true, reason: 'This tab has no accessible address yet.', code: 'NO_URL' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { restricted: true, reason: 'This tab has an invalid address.', code: 'BAD_URL' };
  }
  if (RESTRICTED_SCHEMES.includes(parsed.protocol)) {
    return {
      restricted: true,
      code: 'BROWSER_PAGE',
      reason: 'Chrome does not let extensions inspect browser pages. Open a normal website and try again.',
    };
  }
  if (parsed.protocol === 'file:') {
    return {
      restricted: false,
      fileUrl: true,
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { restricted: true, code: 'UNSUPPORTED_SCHEME', reason: `"${parsed.protocol}" pages cannot be inspected.` };
  }
  for (const rule of RESTRICTED_HOSTS) {
    if (parsed.hostname === rule.host && (!rule.pathPrefix || parsed.pathname.startsWith(rule.pathPrefix))) {
      return {
        restricted: true,
        code: 'WEBSTORE',
        reason: 'The Chrome Web Store is protected - extensions cannot inspect it.',
      };
    }
  }
  return { restricted: false };
}

/** Origin match pattern for chrome.permissions (`https://example.com/*`). */
export function originPattern(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

/**
 * Validate and sanitize a SCAN_PAGE / SCAN_SITE payload. Message payloads come
 * from another extension context and are never trusted blindly.
 */
export function parseScanRequest(payload, { site = false } = {}) {
  const bad = (message) => createError(ERR.INVALID_REQUEST, message);
  if (!payload || typeof payload !== 'object') throw bad('Missing scan request.');
  const { scanId, sessionId, tabId, target, options = {}, crawl } = payload;
  if (typeof scanId !== 'string' || !scanId) throw bad('Missing scan id.');
  if (!Number.isInteger(tabId)) throw bad('Missing tab id.');
  const search = sanitizeTextQuery(target) || sanitizePhoneQuery(target);
  if (!search && !isCanonicalColor(target)) throw bad('The search target is invalid.');
  return {
    scanId,
    sessionId: typeof sessionId === 'string' ? sessionId : null,
    tabId,
    target: search || { r: target.r, g: target.g, b: target.b, a: target.a },
    scanOptions: {
      tolerance: options.tolerance ? clamp(Math.round(Number(options.tolerance)) || 0, 0, NEAR_TOLERANCE) : 0,
      includeInherited: !!options.includeInherited,
    },
    crawl: site ? sanitizeCrawlOptions(crawl) : null,
  };
}
