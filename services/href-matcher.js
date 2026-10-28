/**
 * Link (href) matching. Pure functions (no DOM, no chrome.*), shared by the
 * content script, the invisible renderer, the side panel and the tests.
 *
 * The user types a link; every link on the page that points to it is found.
 *
 * Rules
 *  - A link is compared after it is resolved against the page it is on, so a
 *    relative `<a href="/en/">` on https://www.line.me counts as
 *    https://www.line.me/en/.
 *  - "Exact" (default) compares whole addresses. Ignored on purpose, because
 *    they do not change where a link goes: letter case of the scheme and host,
 *    a default port, the order of the query parameters, upper/lower-case in
 *    %XX escapes, a trailing slash on a path (`/en` = `/en/`), and the
 *    #fragment unless the typed link has one. A link that only holds a #fragment
 *    (`href="#top"`) is not matched by a full address unless the fragment is typed.
 *  - "Ignore http/https and www" (default) lets http://line.me/en/ match
 *    https://www.line.me/en/. A typed link without a scheme (`line.me/en/`)
 *    always behaves like that.
 *  - With "Exact" off, any link that CONTAINS the typed text matches, in the
 *    address as written or as resolved, in escaped or readable form
 *    (`ja_åJP` finds `ja_%C3%A5JP`), ignoring letter case.
 *  - A typed path (`/contact`) matches links to that path on the page's own site only.
 *    Other relative text (`#top`, `?page=2`, `about.html`) is compared with the
 *    link exactly as it is written in the page.
 */

export const MAX_URL_LENGTH = 2000;

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST_LIKE = /^(?:[a-z0-9-]+\.)+([a-z]{2,24})(?::\d+)?(?:[/?#]|$)/i;
/** `about.html` looks like a host name but is a file. */
const FILE_EXTENSIONS = new Set([
  'html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'cgi', 'js', 'css', 'json', 'xml', 'txt', 'pdf', 'png', 'jpg', 'jpeg',
  'gif', 'svg', 'webp', 'ico', 'zip', 'csv',
]);

/* ---------------------------------------------------------------- Query */

/**
 * Parse what the user typed.
 * @returns {{ ok: true, query: object } | { ok: false, error: string }}
 */
export function parseHrefInput(input, flags = {}) {
  const url = String(input ?? '').trim();
  if (!url) return { ok: false, error: 'Enter a link, for example https://www.line.me/en/.' };
  if (url.length > MAX_URL_LENGTH) return { ok: false, error: 'That link is too long.' };
  if (/\s/.test(url)) return { ok: false, error: 'A link cannot contain spaces.' };
  if (/^javascript:/i.test(url)) return { ok: false, error: 'Enter a web address, not a javascript: link.' };
  return {
    ok: true,
    query: {
      kind: 'href',
      url,
      exact: flags.exact !== false,
      looseHost: flags.looseHost !== false,
      includeButtons: flags.includeButtons !== false,
    },
  };
}

/** Canonical query from an untrusted object (message payloads, saved settings), or null. */
export function sanitizeHrefQuery(raw) {
  if (!raw || typeof raw !== 'object' || raw.kind !== 'href' || typeof raw.url !== 'string') return null;
  const parsed = parseHrefInput(raw.url, raw);
  return parsed.ok ? parsed.query : null;
}

export const isHrefQuery = (value) => !!value && typeof value === 'object' && value.kind === 'href' && sanitizeHrefQuery(value) !== null;

/* ------------------------------------------------------------ Normalizing */

const upperEscapes = (text) => text.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function safeEncode(text) {
  try {
    return encodeURI(text);
  } catch {
    return text;
  }
}

function parseUrl(text, base) {
  try {
    return new URL(text, base);
  } catch {
    return null;
  }
}

/** Identity of an address for the "same link" comparison. */
function keyOf(url, { looseHost, withHash }) {
  const web = url.protocol === 'http:' || url.protocol === 'https:';
  const protocol = looseHost && web ? 'http:' : url.protocol;
  const host = looseHost ? url.host.replace(/^www\./, '') : url.host;

  let path = upperEscapes(url.pathname);
  if (web && path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  const search = url.search.length > 1 ? `?${upperEscapes(url.search.slice(1)).split('&').filter(Boolean).sort().join('&')}` : '';
  const hash = withHash && url.hash.length > 1 ? upperEscapes(url.hash) : '';
  return `${protocol}//${host}${path}${search}${hash}`;
}

/**
 * What kind of thing was typed.
 *  - `absolute`: an address with a scheme (`https://...`, `mailto:...`) or a host name (`line.me/en/`)
 *  - `path`: starts with `/`
 *  - `relative`: anything else (`#top`, `?page=2`, `about.html`)
 */
function classify(text) {
  if (SCHEME.test(text)) {
    const url = parseUrl(text);
    if (url) return { type: 'absolute', url, scheme: true };
  }
  if (text.startsWith('//')) {
    const url = parseUrl(`https:${text}`);
    if (url) return { type: 'absolute', url, scheme: false };
  }
  if (text.startsWith('/')) return { type: 'path' };
  const host = HOST_LIKE.exec(text);
  if (host && !FILE_EXTENSIONS.has(host[1].toLowerCase())) {
    const url = parseUrl(`https://${text}`);
    if (url) return { type: 'absolute', url, scheme: false };
  }
  return { type: 'relative' };
}

/* --------------------------------------------------------------- Matcher */

/**
 * @param {{ url: string, exact: boolean, looseHost: boolean }} query a sanitized query
 * @returns {{ test: (value: string, baseUrl: string) => ({ start: number, end: number, resolved: string|null } | null) }}
 */
export function createHrefMatcher(query) {
  const typed = query.url.trim();
  const shape = classify(typed);
  const looseHost = query.looseHost || (shape.type === 'absolute' && !shape.scheme);

  /* ---- Exact */
  let queryKey = null;
  let queryHasHash = false;
  if (shape.type === 'absolute') {
    queryHasHash = shape.url.hash.length > 1;
    queryKey = keyOf(shape.url, { looseHost, withHash: queryHasHash });
  }
  const typedPath = shape.type === 'path' ? parseUrl(typed, 'https://placeholder.invalid') : null;
  const typedPathHasHash = !!typedPath && typedPath.hash.length > 1;
  const typedPathKey = typedPath ? pathKey(typedPath, typedPathHasHash) : null;

  function pathKey(url, withHash) {
    return keyOf(url, { looseHost: false, withHash }).replace(/^[^/]*\/\/[^/?#]*/, '');
  }

  function exactMatch(value, resolved, pageOrigin) {
    if (shape.type === 'absolute') {
      if (!resolved) return false;
      if (value.startsWith('#') && !queryHasHash) return false;
      return keyOf(resolved, { looseHost, withHash: queryHasHash }) === queryKey;
    }
    if (shape.type === 'path') {
      if (!resolved || value.startsWith('#')) return false;
      return resolved.origin === pageOrigin && pathKey(resolved, typedPathHasHash) === typedPathKey;
    }
    return value === typed || value === `${typed}/` || `${value}/` === typed;
  }

  /* ---- Contains */
  const folded = typed.toLowerCase();
  const needles = Array.from(new Set([folded, safeEncode(typed).toLowerCase(), safeDecode(typed).toLowerCase()]));

  function containsMatch(value, resolvedHref) {
    const find = (text) => {
      const hay = text.toLowerCase();
      for (const needle of needles) {
        const start = hay.indexOf(needle);
        if (start >= 0) return { start, end: start + needle.length };
      }
      return null;
    };
    const direct = find(value);
    if (direct) return direct;
    // Found only in the readable form or in the resolved address: show the whole link as the match.
    if (find(safeDecode(value)) || (resolvedHref && (find(resolvedHref) || find(safeDecode(resolvedHref))))) {
      return { start: 0, end: value.length };
    }
    return null;
  }

  return {
    /**
     * @param {string} raw the link exactly as written in the page
     * @param {string} baseUrl address the link is resolved against
     */
    test(raw, baseUrl) {
      const value = String(raw ?? '').trim();
      if (!value) return null;
      const offset = raw.indexOf(value);
      const resolved = parseUrl(value, baseUrl);

      if (query.exact) {
        return exactMatch(value, resolved, parseUrl(baseUrl)?.origin ?? null) ? { start: offset, end: offset + value.length, resolved: resolved?.href ?? null } : null;
      }
      // A bare #fragment link is not "the page address" for this purpose.
      const hit = containsMatch(value, value.startsWith('#') ? null : (resolved?.href ?? null));
      return hit ? { start: offset + hit.start, end: offset + hit.end, resolved: resolved?.href ?? null } : null;
    },
  };
}
