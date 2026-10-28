/**
 * Invisible page renderer for Entire Site scans - no tab, no window.
 *
 * It runs inside a hidden offscreen document (see offscreen/offscreen.js) and,
 * for one URL:
 *
 *   1. downloads the HTML (cookies of the user's session are sent, exactly as
 *      the browser would),
 *   2. removes everything that could execute or navigate (scripts, <noscript>,
 *      frames, meta refresh, meta CSP, preloads),
 *   3. downloads every linked stylesheet - following @import - and inlines it
 *      as a <style data-wit-href> element, so the stylesheets are readable
 *      (a <link> to another origin would be opaque to CSSOM) and keep their
 *      original order and media conditions,
 *   4. loads the result into a sandboxed iframe (`allow-same-origin`, NO
 *      `allow-scripts`) whose own CSP forbids images, fonts, media, frames,
 *      objects and scripts, so nothing but styles is ever processed,
 *   5. runs the very same scanner used for live pages on that document.
 *
 * What this means: the HTML and CSS are exactly what the server sent;
 * JavaScript is NOT executed, so markup that scripts add later (or styles they
 * toggle) is not seen. The "Rendered in temporary tabs" crawl mode exists for
 * sites that need their scripts.
 */

import { ERR } from '../shared/constants.js';
import { createError } from '../shared/helpers.js';
import { collectLinks } from '../content/dom-scanner.js';
import { runScan } from '../content/run-scan.js';
import { isPhoneQuery } from './phone-matcher.js';
import { isTextQuery } from './text-matcher.js';
import { isSameOrigin } from './url-normalizer.js';

const MAX_HTML_CHARS = 6_000_000;
const MAX_SHEET_CHARS = 2_500_000;
const MAX_SHEETS_PER_PAGE = 60;
const MAX_IMPORT_DEPTH = 4;
const SHEET_TIMEOUT_MS = 15000;
const VIEWPORT = { width: 1280, height: 800 };

/** Applied inside the sandboxed document: only styles may be processed. */
const FRAME_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; media-src 'none'; " +
  "frame-src 'none'; object-src 'none'; script-src 'none'; connect-src 'none'";

const REMOVE_SELECTOR = [
  'script',
  'noscript',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'base',
  'meta[http-equiv]',
  'link[rel~="preload"]',
  'link[rel~="prefetch"]',
  'link[rel~="modulepreload"]',
  'link[rel~="preconnect"]',
  'link[rel~="dns-prefetch"]',
  'link[rel~="prerender"]',
].join(',');

const IMPORT_RE =
  /@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)|"([^"]+)"|'([^']+)')\s*([^;{]*);/gi;

/** An AbortSignal combining the caller's signal with a timeout. */
function linkSignals(external, timeoutMs) {
  const controller = new AbortController();
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    state,
    dispose() {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

function abortError(state) {
  return state.timedOut
    ? createError(ERR.TIMEOUT, 'The page took too long to load.')
    : createError(ERR.CANCELLED, 'Scan cancelled');
}

/** Wrap imported CSS in the @layer / @media its @import asked for. */
function wrapImported(css, conditions) {
  let rest = (conditions || '').trim();
  let wrapped = css;
  const layer = /(^|\s)layer(?:\(([^)]*)\))?/i.exec(rest);
  if (layer) {
    wrapped = `@layer ${layer[2] ? layer[2].trim() : ''} {\n${wrapped}\n}`;
    rest = rest.replace(layer[0], ' ');
  }
  rest = rest.replace(/supports\((?:[^()]|\([^)]*\))*\)/i, ' ').trim();
  if (rest) wrapped = `@media ${rest} {\n${wrapped}\n}`;
  return wrapped;
}

/**
 * @param {object} [config]
 * @param {typeof fetch} [config.fetchImpl]
 * @param {HTMLElement} [config.container] where the temporary iframes live
 */
export function createBackgroundRenderer({ fetchImpl = (...args) => fetch(...args), container } = {}) {
  /** absolute stylesheet URL -> Promise<segments | null> (shared by every page of a crawl) */
  const sheetCache = new Map();
  /** absolute stylesheet URL -> original text */
  const rawTexts = new Map();
  /** Caches the scanner reuses from page to page (stylesheet indexes, line-number lookups). */
  const shared = {
    indexes: new Map(),
    lineTexts: new Map(),
    lineResults: new Map(),
    fetchText: async (href) => rawTexts.get(href) ?? null,
  };

  async function fetchSheetText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SHEET_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { credentials: 'include', redirect: 'follow', signal: controller.signal });
      if (!response.ok) return null;
      const text = await response.text();
      if (text.length > MAX_SHEET_CHARS) return null;
      rawTexts.set(url, text); // original text: the source of truth for line numbers
      return text;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A stylesheet as an ordered list of segments `{ href, css }`: first the
   * segments of every file it @imports (kept as SEPARATE segments, so each rule
   * is still attributed to the file it really came from), then its own text
   * with the @import statements removed. null = it could not be downloaded.
   */
  function loadSheet(url, depth) {
    const cached = sheetCache.get(url);
    if (cached) return cached;
    const job = (async () => {
      const text = await fetchSheetText(url);
      return text === null ? null : splitImports(text, url, depth, url);
    })();
    sheetCache.set(url, job);
    return job;
  }

  /** @returns {Promise<{href: string|null, css: string}[]>} imported segments + the text itself */
  async function splitImports(css, baseUrl, depth, ownHref) {
    const found = Array.from(css.matchAll(IMPORT_RE));
    const imported = await Promise.all(
      found.map(async (match) => {
        const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
        if (depth >= MAX_IMPORT_DEPTH) return [];
        let absolute;
        try {
          absolute = new URL(raw, baseUrl).href;
        } catch {
          return [];
        }
        const segments = await loadSheet(absolute, depth + 1);
        return (segments || []).map((segment) => ({ ...segment, css: wrapImported(segment.css, match[6]) }));
      }),
    );
    return [...imported.flat(), { href: ownHref, css: found.length ? css.replace(IMPORT_RE, '') : css }];
  }

  function styleElements(doc, segments, media) {
    return segments.map((segment) => {
      const style = doc.createElement('style');
      if (segment.href) style.setAttribute('data-wit-href', segment.href);
      if (media) style.setAttribute('media', media);
      style.textContent = segment.css;
      return style;
    });
  }

  /**
   * Turn downloaded HTML into a self-contained, script-free document string.
   * @returns {Promise<{ html: string, unreadable: {href:string,label:string,reason:string}[] }>}
   */
  async function prepareHtml(html, pageUrl) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');

    let baseUrl = pageUrl;
    const baseElement = parsed.querySelector('base[href]');
    if (baseElement) {
      try {
        baseUrl = new URL(baseElement.getAttribute('href'), pageUrl).href;
      } catch {
        /* keep page URL */
      }
    }

    parsed.querySelectorAll(REMOVE_SELECTOR).forEach((node) => node.remove());

    const unreadable = [];
    const links = Array.from(parsed.querySelectorAll('link[rel~="stylesheet"]'));
    await Promise.all(
      links.map(async (link, position) => {
        const disabled = link.hasAttribute('disabled') || /alternate/i.test(link.getAttribute('rel') || '');
        const raw = link.getAttribute('href');
        if (disabled || !raw || position >= MAX_SHEETS_PER_PAGE) {
          link.remove();
          return;
        }
        let href;
        try {
          href = new URL(raw, baseUrl).href;
        } catch {
          link.remove();
          return;
        }
        const segments = await loadSheet(href, 0);
        if (segments === null) {
          unreadable.push({ href, label: href, reason: 'The stylesheet could not be downloaded' });
          link.remove();
          return;
        }
        link.replaceWith(...styleElements(parsed, segments, link.getAttribute('media')));
      }),
    );

    // Inline <style> blocks may @import files as well.
    for (const style of Array.from(parsed.querySelectorAll('style:not([data-wit-href])'))) {
      if (!/@import/i.test(style.textContent)) continue;
      const segments = await splitImports(style.textContent, baseUrl, 0, null);
      const own = segments.pop(); // the block itself, imports removed
      style.textContent = own.css;
      style.before(...styleElements(parsed, segments, style.getAttribute('media')));
    }

    // Our own head: base URL for relative links + the restrictive CSP, before anything else.
    const head = parsed.head || parsed.documentElement.insertBefore(parsed.createElement('head'), parsed.body);
    const meta = parsed.createElement('meta');
    meta.setAttribute('http-equiv', 'Content-Security-Policy');
    meta.setAttribute('content', FRAME_CSP);
    const base = parsed.createElement('base');
    base.setAttribute('href', baseUrl);
    head.prepend(meta, base);

    return { html: `<!DOCTYPE html>\n${parsed.documentElement.outerHTML}`, unreadable };
  }

  /**
   * The page as an inert parsed document (no scripts run, nothing loads) with
   * the same sanitising as prepareHtml but without stylesheets or layout.
   */
  function parseInert(html, pageUrl) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    let baseUrl = pageUrl;
    const baseElement = parsed.querySelector('base[href]');
    if (baseElement) {
      try {
        baseUrl = new URL(baseElement.getAttribute('href'), pageUrl).href;
      } catch {
        /* keep page URL */
      }
    }
    parsed.querySelectorAll(REMOVE_SELECTOR).forEach((node) => node.remove());
    const head = parsed.head || parsed.documentElement.insertBefore(parsed.createElement('head'), parsed.body);
    const base = parsed.createElement('base');
    base.setAttribute('href', baseUrl);
    head.prepend(base);
    return parsed;
  }

  async function download(url, { signal, origin }) {
    let response;
    try {
      response = await fetchImpl(url, {
        credentials: 'include',
        redirect: 'follow',
        signal,
        headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw createError(ERR.LOAD_FAILED, `The page could not be loaded (${error?.message || 'network error'}).`);
    }

    const finalUrl = response.url || url;
    if (origin && !isSameOrigin(finalUrl, origin)) {
      throw createError(ERR.REDIRECTED_OFFSITE, `Redirected away from the site to ${new URL(finalUrl).host}.`);
    }
    if (!response.ok) throw createError(ERR.HTTP_ERROR, `The server answered HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/html/i.test(contentType)) {
      throw createError(ERR.NOT_HTML, `Not an HTML page (${contentType.split(';')[0]}).`);
    }
    const html = await response.text();
    if (html.length > MAX_HTML_CHARS) throw createError(ERR.LOAD_FAILED, 'The page is too large to inspect.');
    return { finalUrl, status: response.status, contentType, html };
  }

  function loadFrame(html, signal) {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin'); // deliberately no allow-scripts
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    Object.assign(frame.style, {
      position: 'fixed',
      left: '-20000px',
      top: '0',
      width: `${VIEWPORT.width}px`,
      height: `${VIEWPORT.height}px`,
      border: '0',
    });
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(createError(ERR.CANCELLED, 'Scan cancelled'));
      signal.addEventListener('abort', onAbort, { once: true });
      frame.addEventListener(
        'load',
        () => {
          signal.removeEventListener('abort', onAbort);
          resolve(frame);
        },
        { once: true },
      );
      frame.srcdoc = html;
      (container || document.body).append(frame);
    }).catch((error) => {
      frame.remove();
      throw error;
    });
  }

  return {
    /** Forget downloaded stylesheets (call between crawls). */
    clearCache() {
      sheetCache.clear();
      rawTexts.clear();
      shared.indexes.clear();
      shared.lineTexts.clear();
      shared.lineResults.clear();
    },

    /**
     * Scan one URL without any tab or window.
     * @returns {Promise<object>} same shape as a content-script page result
     */
    async scanUrl(url, { target, options = {}, signal, timeoutMs = 20000, origin } = {}) {
      if (signal?.aborted) throw createError(ERR.CANCELLED, 'Scan cancelled');
      const linked = linkSignals(signal, timeoutMs);
      let frame = null;
      try {
        const t0 = performance.now();
        const page = await download(url, { signal: linked.signal, origin });
        const t1 = performance.now();
        let doc;
        let unreadable = [];
        let t2;
        let t3;
        if (isPhoneQuery(target) || (isTextQuery(target) && !target.visibleOnly)) {
          // Searching text needs no layout: skip the stylesheets and the iframe entirely.
          doc = parseInert(page.html, page.finalUrl);
          t2 = performance.now();
          t3 = t2;
        } else {
          const prepared = await prepareHtml(page.html, page.finalUrl);
          unreadable = prepared.unreadable;
          if (linked.signal.aborted) throw abortError(linked.state);
          t2 = performance.now();
          frame = await loadFrame(prepared.html, linked.signal);
          doc = frame.contentDocument;
          if (!doc?.documentElement) throw createError(ERR.LOAD_FAILED, 'The page could not be rendered.');
          t3 = performance.now();
        }

        const result = await runScan({
          doc,
          target,
          options,
          shared,
          budgetMs: 40, // nothing else to keep responsive in the hidden document
          isCancelled: () => linked.signal.aborted,
        });
        result.stats.stylesheets.inaccessible.push(...unreadable);
        Object.assign(result.stats.timings, {
          downloadMs: Math.round(t1 - t0),
          prepareMs: Math.round(t2 - t1),
          frameMs: Math.round(t3 - t2),
        });

        return {
          url: page.finalUrl,
          title: doc.title || '',
          scannedAt: Date.now(),
          httpStatus: page.status,
          contentType: page.contentType,
          readyState: 'complete',
          renderMode: 'static',
          ...result,
          links: options.collectLinks ? collectLinks(doc) : undefined,
        };
      } catch (error) {
        if (linked.signal.aborted && error?.code !== ERR.CANCELLED && error?.code !== ERR.TIMEOUT) throw abortError(linked.state);
        if (error?.name === 'AbortError') throw abortError(linked.state);
        if (linked.signal.aborted && error?.code === ERR.CANCELLED && linked.state.timedOut) throw abortError(linked.state);
        throw error;
      } finally {
        linked.dispose();
        frame?.remove();
      }
    },
  };
}
