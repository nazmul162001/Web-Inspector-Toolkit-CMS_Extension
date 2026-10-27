/**
 * URL normalization for the site crawler.
 *
 * Two forms are produced for every accepted URL:
 *   - `url`: clean and navigable - fragment and tracking parameters removed,
 *            remaining query parameters sorted, original path preserved.
 *   - `key`: de-duplication identity - `url` without a trailing slash on
 *            non-root paths (`/about/` and `/about` are the same page).
 *
 * Only http(s) is supported. mailto:, tel:, javascript:, data:, blob:, ftp:,
 * file: ... all normalize to `null`.
 */

const TRACKING_PARAM =
  /^(utm_.+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|yclid|twclid|ttclid|igshid|mc_cid|mc_eid|_ga|_gl|mkt_tok|vero_id|ref_src|ref_url|spm|cmpid)$/i;

/** Non-HTML resources that would trigger downloads or useless navigations. */
const NON_PAGE_EXTENSION =
  /\.(pdf|zip|gz|tgz|tar|rar|7z|exe|dmg|pkg|apk|msi|iso|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp3|mp4|m4a|mov|avi|wmv|webm|mkv|wav|ogg|flac|css|js|mjs|json|xml|rss|atom|txt|csv|tsv|xlsx?|docx?|pptx?|odt|ods|woff2?|ttf|otf|eot|map)$/i;

/**
 * GET links that very likely change state or end the user's session. A crawler
 * that follows the user's cookies must never hit these.
 */
const RISKY_PATH =
  /(^|[/_.\-?=&])(log[-_]?out|log[-_]?off|sign[-_]?out|sign[-_]?off|unsubscribe|delete|remove|destroy|revoke|deactivate)([/_.\-?=&]|$)/i;

/**
 * Normalize a (possibly relative) URL.
 * @param {string} input
 * @param {string} [base] base URL for relative inputs
 * @returns {{ url: string, key: string } | null}
 */
export function normalizeUrl(input, base) {
  if (typeof input !== 'string' || !input.trim()) return null;
  let parsed;
  try {
    parsed = new URL(input.trim(), base);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;

  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';

  // Filter tracking params on the raw query so original encoding is kept.
  const rawQuery = parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search;
  const params = rawQuery
    .split('&')
    .filter(Boolean)
    .filter((pair) => {
      const name = pair.split('=')[0];
      let decoded = name;
      try {
        decoded = decodeURIComponent(name.replace(/\+/g, ' '));
      } catch {
        /* keep raw name */
      }
      return !TRACKING_PARAM.test(decoded);
    })
    .sort();
  parsed.search = params.length ? `?${params.join('&')}` : '';

  const url = parsed.href;
  const key = parsed.pathname.length > 1 && parsed.pathname.endsWith('/')
    ? url.replace(/\/(?=(\?|$))/, '')
    : url;
  return { url, key };
}

export const isSameOrigin = (a, b) => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/** Is this URL something worth navigating to in order to inspect a page? */
export function isCrawlableUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (NON_PAGE_EXTENSION.test(parsed.pathname)) return false;
  if (RISKY_PATH.test(parsed.pathname + parsed.search)) return false;
  return true;
}

/**
 * Turn raw hrefs found on a page into unique, normalized, same-origin,
 * crawlable URLs.
 *
 * @param {string[]} hrefs
 * @param {string} pageUrl URL the hrefs were found on
 * @param {string} origin only URLs on this origin are kept
 * @returns {{ url: string, key: string }[]}
 */
export function extractInternalLinks(hrefs, pageUrl, origin) {
  const seen = new Set();
  const links = [];
  for (const href of hrefs) {
    const normalized = normalizeUrl(href, pageUrl);
    if (!normalized) continue;
    if (!isSameOrigin(normalized.url, origin)) continue;
    if (!isCrawlableUrl(normalized.url)) continue;
    if (seen.has(normalized.key)) continue;
    seen.add(normalized.key);
    links.push(normalized);
  }
  return links;
}

/** Path + query for compact display. */
export function displayPath(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}
