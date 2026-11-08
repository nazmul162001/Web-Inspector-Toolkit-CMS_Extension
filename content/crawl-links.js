/**
 * URLs the Entire Site crawler should follow from a page.
 *
 * Live pages and downloaded HTML both miss a lot of CMS navigation if we only
 * look at `<a href>`: buttons use data-href, click handlers call location.href,
 * and JSON-LD / the site map list pages the header never links to.
 *
 * Every value is resolved against an http(s) page URL. Parsed documents in the
 * offscreen renderer have a baseURI of `about:blank` or `chrome-extension://…`,
 * which would turn `/about` into an extension URL and drop it from the crawl.
 */

import { SCAN_LIMITS } from '../shared/constants.js';
import { addressesInCode } from './href-scanner.js';

const LINK_SELECTOR = [
  'a[href]',
  'area[href]',
  'link[href]',
  '[data-href]',
  '[data-url]',
  '[data-link]',
  '[data-link-url]',
  '[data-target-url]',
  '[data-redirect-url]',
  '[formaction]',
  'form[action]',
  '[onclick]',
  '[data-wit-onclick]',
].join(',');

const LINK_ATTRS = ['href', 'action', 'formaction', 'data-href', 'data-url', 'data-link', 'data-link-url', 'data-target-url', 'data-redirect-url'];

const ATTR_RE =
  /\s(?:href|action|formaction|data-href|data-url|data-link|data-link-url|data-target-url|data-redirect-url)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CLICK_RE = /\s(?:onclick|data-wit-onclick)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const JSON_LD_RE = /<script\b[^>]*\btype\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi;

/** Prefer a real web address over about:blank / chrome-extension:// baseURIs. */
export function documentHttpBase(doc, pageUrl = '') {
  const tagged = doc?.querySelector?.('base[href]')?.getAttribute('href') || '';
  const candidates = [tagged, pageUrl, doc?.baseURI, doc?.URL];
  for (const value of candidates) {
    if (typeof value !== 'string' || !value) continue;
    try {
      const absolute = new URL(value, pageUrl || doc?.baseURI || undefined).href;
      if (/^https?:/i.test(absolute)) return absolute;
    } catch {
      if (/^https?:/i.test(value)) return value;
    }
  }
  return pageUrl || doc?.baseURI || '';
}

function addHref(hrefs, raw, base, limit) {
  if (!raw || hrefs.size >= limit) return;
  const value = String(raw).trim();
  if (!value || /^javascript:/i.test(value) || /^data:/i.test(value) || /^blob:/i.test(value)) return;
  try {
    hrefs.add(new URL(value, base).href);
  } catch {
    /* ignore unparsable href */
  }
}

function jsonLdLooksLikePage(value) {
  const text = String(value).trim();
  if (!text || /\s/.test(text)) return false;
  if (/^(https?:)?\/\//i.test(text) || text.startsWith('/')) return true;
  if (/^(mailto:|tel:|javascript:|data:|urn:)/i.test(text)) return false;
  return /\.(html?|php|aspx?|jsp)(\?|#|$)/i.test(text) || text.startsWith('./') || text.startsWith('../');
}

function collectJsonLdUrls(text, hrefs, base, limit) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return;
  }
  const visit = (node) => {
    if (hrefs.size >= limit || node == null) return;
    if (typeof node === 'string') {
      if (jsonLdLooksLikePage(node)) addHref(hrefs, node, base, limit);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === 'object') {
      for (const value of Object.values(node)) visit(value);
    }
  };
  visit(data);
}

/**
 * Collect crawlable addresses from a (live or parsed) document.
 * Returns absolute URLs; the crawler normalizes and filters them.
 */
export function collectLinks(doc = document, limit = SCAN_LIMITS.MAX_LINKS_PER_PAGE, pageUrl = '') {
  const cap = Number.isFinite(limit) ? limit : SCAN_LIMITS.MAX_LINKS_PER_PAGE;
  const base = documentHttpBase(doc, pageUrl);
  const hrefs = new Set();

  for (const node of doc.querySelectorAll(LINK_SELECTOR)) {
    if (node.hasAttribute('download')) continue;
    for (const name of LINK_ATTRS) {
      if (node.hasAttribute(name)) addHref(hrefs, node.getAttribute(name), base, cap);
    }
    const onclick = node.getAttribute('onclick') || node.getAttribute('data-wit-onclick');
    if (onclick) {
      for (const value of addressesInCode(onclick)) addHref(hrefs, value, base, cap);
    }
    if (hrefs.size >= cap) break;
  }

  for (const script of doc.querySelectorAll('script[type="application/ld+json" i]')) {
    collectJsonLdUrls(script.textContent || '', hrefs, base, cap);
    if (hrefs.size >= cap) break;
  }

  return Array.from(hrefs);
}

/**
 * Same discovery on the raw HTML string, used before the renderer strips
 * `<script>` / `<noscript>` (JSON-LD and noscript fallback nav live there).
 */
export function collectMarkupLinks(html, pageUrl, limit = SCAN_LIMITS.MAX_LINKS_PER_PAGE) {
  const cap = Number.isFinite(limit) ? limit : SCAN_LIMITS.MAX_LINKS_PER_PAGE;
  const base = pageUrl;
  const hrefs = new Set();
  const text = String(html || '');

  ATTR_RE.lastIndex = 0;
  for (const match of text.matchAll(ATTR_RE)) addHref(hrefs, match[1] ?? match[2] ?? match[3], base, cap);

  CLICK_RE.lastIndex = 0;
  for (const match of text.matchAll(CLICK_RE)) {
    for (const value of addressesInCode(match[1] ?? match[2] ?? '')) addHref(hrefs, value, base, cap);
  }

  JSON_LD_RE.lastIndex = 0;
  for (const match of text.matchAll(JSON_LD_RE)) collectJsonLdUrls(match[2] || '', hrefs, base, cap);

  return Array.from(hrefs);
}

export function mergeHrefLists(...lists) {
  const hrefs = new Set();
  for (const list of lists) {
    if (!list) continue;
    for (const href of list) {
      if (href) hrefs.add(href);
    }
  }
  return Array.from(hrefs);
}
