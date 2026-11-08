/**
 * Entire Site scan: a bounded, same-origin, breadth-first crawl that inspects
 * the RENDERED DOM of every page (never downloaded HTML).
 *
 * - The crawl always starts at the site home (`/`), even if the user is on
 *   `/about` or `/concept`. Their tab is not switched. Home is scanned in the
 *   live tab only when they are already on `/`.
 * - Top-level pages (`/about`, `/blog`, …) are queued ahead of listing articles
 *   so results appear in a stable, nav-like order.
 * - Other pages are opened in a temporary inactive background tab (or the
 *   hidden offscreen renderer), awaited until `complete` plus a short render
 *   delay, scanned, and the tab is closed in a `finally` block.
 * - Links are discovered from each rendered page, normalized, de-duplicated,
 *   restricted to the start origin and filtered to crawlable URLs.
 * - Concurrency, page count, timeouts and retries are bounded; the crawl can
 *   be cancelled at any moment through an AbortSignal.
 * - The result never claims full coverage: failed pages, pages never reached
 *   because of the limit, and cancellation are all reported.
 */

import { CRAWL_MODE, ERR, LISTING_ARTICLE_LIMIT, LISTING_ARTICLE_SECTIONS } from '../shared/constants.js';
import { createError, isCancelled, sleep, throttle } from '../shared/helpers.js';
import { sanitizeCrawlOptions } from '../shared/validators.js';
import { extractInternalLinks, isListingArticle, isSameOrigin, isSectionIndex, normalizeUrl, sectionPath, siteHomeUrl } from './url-normalizer.js';
import { basicAuthorization, isUnauthorized } from './http-auth.js';
import { scanTab } from './page-scan-service.js';
import { scanUrl } from './offscreen-scanner.js';
import { closeTempTab, openTempTab, waitForTabComplete } from './temp-tab-manager.js';
import { collectSitemapUrls } from './sitemap.js';

const MAX_DISCOVERED_URLS = 5000;
const RETRYABLE = new Set([ERR.TIMEOUT, ERR.LOAD_FAILED, ERR.NO_RECEIVER, ERR.PORT_CLOSED, ERR.INJECTION_FAILED]);

const defaultDeps = { scanTab, scanUrl, openTempTab, closeTempTab, waitForTabComplete };

/**
 * @param {object} params
 * @param {number} params.startTabId  the user's tab showing the start page
 * @param {string} params.startUrl
 * @param {number} [params.windowId]  window for temporary tabs
 * @param {string} params.scanId
 * @param {object} params.target      canonical RGBA
 * @param {object} params.scanOptions match options forwarded to the content scanner
 * @param {object} params.crawl       crawl options (sanitized here)
 * @param {AbortSignal} params.signal
 * @param {(progress: object) => void} [params.onProgress]
 * @param {(info: { origin: string, url?: string, realm?: string, invalid?: boolean }) => Promise<{ username: string, password: string }>} [params.requestAuth]
 * @param {typeof defaultDeps} [params.deps] injectable for tests
 */
export async function crawlSite({
  startTabId,
  startUrl,
  windowId,
  scanId,
  target,
  scanOptions = {},
  crawl,
  signal,
  onProgress = () => {},
  onPage = () => {},
  requestAuth,
  deps = defaultDeps,
}) {
  const options = sanitizeCrawlOptions(crawl);
  const useBackground = options.mode === CRAWL_MODE.BACKGROUND && typeof deps.scanUrl === 'function';
  const origin = new URL(startUrl).origin;
  const home = siteHomeUrl(startUrl) || normalizeUrl(`${origin}/`);
  const homeUrl = home?.url || `${origin}/`;
  const homeKey = home?.key || '';
  const current = normalizeUrl(startUrl);
  const currentKey = current?.key || '';
  const currentIsHome = !!homeKey && currentKey === homeKey;
  const liveTimeoutMs = Math.max(options.pageTimeoutMs, 15000);
  const startedAt = Date.now();

  const pages = [];
  const failures = [];
  const duplicates = [];
  const queue = [];
  const seen = new Set();
  const scannedKeys = new Set();
  const inFlight = new Map(); // url -> true
  const waiters = [];
  const articleCounts = new Map();
  let attempted = 0;
  let matchCount = 0;
  let authorization = null;
  let authGate = null;

  function noteListingArticle(url) {
    if (!options.limitListingArticles || !isListingArticle(url, LISTING_ARTICLE_SECTIONS)) return;
    const section = sectionPath(url);
    articleCounts.set(section, (articleCounts.get(section) || 0) + 1);
  }

  function acceptLink(link) {
    if (!options.limitListingArticles || !isListingArticle(link.url, LISTING_ARTICLE_SECTIONS)) return true;
    const section = sectionPath(link.url);
    if ((articleCounts.get(section) || 0) >= LISTING_ARTICLE_LIMIT) return false;
    noteListingArticle(link.url);
    return true;
  }

  const wake = () => waiters.splice(0).forEach((resolve) => resolve());
  const waitForWork = () =>
    new Promise((resolve) => {
      waiters.push(resolve);
      signal.addEventListener('abort', resolve, { once: true });
    });

  const emit = throttle(
    () =>
      onProgress({
        scanId,
        phase: 'crawling',
        attempted,
        scanned: pages.length,
        failed: failures.length,
        queued: queue.length,
        discovered: seen.size,
        maxPages: options.maxPages,
        matches: matchCount,
        active: Array.from(inFlight.keys()),
        elapsedMs: Date.now() - startedAt,
      }),
    120,
  );

  /** Home and top-level pages first, then deeper pages, listing articles last. */
  function linkRank(url) {
    try {
      if (isSectionIndex(url)) return 0;
      if (isListingArticle(url, LISTING_ARTICLE_SECTIONS)) return 2;
      return 1;
    } catch {
      return 1;
    }
  }

  function insertQueued(link) {
    const rank = linkRank(link.url);
    link.rank = rank;
    let index = 0;
    while (index < queue.length && queue[index].rank <= rank) index += 1;
    queue.splice(index, 0, link);
  }

  function enqueueLinks(links, pageUrl) {
    if (!links?.length) return;
    for (const link of extractInternalLinks(links, pageUrl, origin)) {
      if (seen.has(link.key) || seen.size >= MAX_DISCOVERED_URLS) continue;
      if (!acceptLink(link)) continue;
      seen.add(link.key);
      insertQueued(link);
    }
  }

  function recordPage(result, finalKey) {
    if (finalKey) {
      if (scannedKeys.has(finalKey)) {
        duplicates.push(result.url);
        return;
      }
      scannedKeys.add(finalKey);
    }
    const { links, ...page } = result;
    pages.push(page);
    matchCount += page.matches.length;
    try {
      onPage(page);
    } catch (error) {
      console.error('[crawler] onPage failed', error);
    }
    enqueueLinks(links, result.url);
  }

  function fail(item, error) {
    failures.push({
      url: item.url,
      code: error?.code || ERR.UNKNOWN,
      reason: error?.message || 'Unknown error',
      attempts: item.attempts || 1,
    });
  }

  /* -------------------------------------------------------- page scanners */

  async function scanInTempTab(item, timeoutMs = options.pageTimeoutMs) {
    let tabId = null;
    try {
      const tab = await deps.openTempTab(item.url, { windowId });
      tabId = tab.id;
      const loaded = await deps.waitForTabComplete(tabId, { timeoutMs, signal });

      if (loaded.url.startsWith('chrome-error:')) {
        throw createError(ERR.LOAD_FAILED, 'The page could not be loaded (network or certificate error).');
      }
      const final = normalizeUrl(loaded.url);
      if (!final || !isSameOrigin(final.url, origin)) {
        throw createError(ERR.REDIRECTED_OFFSITE, `Redirected away from the site to ${new URL(loaded.url).host}.`);
      }

      await sleep(options.renderDelayMs, signal);
      const result = await deps.scanTab(tabId, {
        scanId,
        target,
        options: { ...scanOptions, collectLinks: true },
        signal,
        timeoutMs,
      });

      if (result.httpStatus && result.httpStatus >= 400) {
        throw createError(ERR.HTTP_ERROR, `The server answered HTTP ${result.httpStatus}.`);
      }
      if (result.contentType && !/html/i.test(result.contentType)) {
        throw createError(ERR.NOT_HTML, `Not an HTML page (${result.contentType}).`);
      }
      return { result, finalKey: final.key };
    } finally {
      if (tabId !== null) await deps.closeTempTab(tabId);
    }
  }

  /** Invisible mode: no tab, no window - the page is rendered in the hidden offscreen document. */
  async function scanInBackground(item, timeoutMs = options.pageTimeoutMs) {
    const result = await deps.scanUrl(item.url, {
      scanId,
      origin,
      target,
      options: { ...scanOptions, collectLinks: true },
      signal,
      timeoutMs,
      authorization,
    });

    const final = normalizeUrl(result.url);
    if (!final || !isSameOrigin(final.url, origin)) {
      throw createError(ERR.REDIRECTED_OFFSITE, 'Redirected away from the site.');
    }
    if (result.httpStatus && result.httpStatus >= 400) {
      throw createError(ERR.HTTP_ERROR, `The server answered HTTP ${result.httpStatus}.`);
    }
    if (result.contentType && !/html/i.test(result.contentType)) {
      throw createError(ERR.NOT_HTML, `Not an HTML page (${result.contentType}).`);
    }
    return { result, finalKey: final.key };
  }

  const scanOne = (item, timeoutMs) =>
    (useBackground ? scanInBackground : scanInTempTab)(item, timeoutMs);

  async function obtainAuth(error) {
    if (typeof requestAuth !== 'function') throw error;
    if (!authGate) {
      authGate = Promise.resolve()
        .then(() =>
          requestAuth({
            origin,
            url: error?.details?.url || '',
            realm: error?.details?.realm || '',
            invalid: !!authorization,
          }),
        )
        .then((creds) => {
          if (!creds) throw createError(ERR.CANCELLED, 'Scan cancelled');
          authorization = basicAuthorization(creds.username, creds.password);
          return authorization;
        })
        .finally(() => {
          authGate = null;
        });
    }
    return authGate;
  }

  async function withAuth(run) {
    for (;;) {
      try {
        return await run();
      } catch (error) {
        if (isCancelled(error) || signal.aborted) throw createError(ERR.CANCELLED, 'Scan cancelled');
        if (!isUnauthorized(error)) throw error;
        await obtainAuth(error);
      }
    }
  }

  async function attemptScan(run) {
    let lastError;
    for (let attempt = 0; attempt <= options.retries; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        lastError = error;
        if (isCancelled(error) || signal.aborted) throw createError(ERR.CANCELLED, 'Scan cancelled');
        if (!RETRYABLE.has(error?.code) || attempt >= options.retries) throw error;
        await sleep(250 * (attempt + 1), signal);
      }
    }
    throw lastError;
  }

  async function scanLiveTab() {
    const result = await deps.scanTab(startTabId, {
      scanId,
      target,
      options: { ...scanOptions, collectLinks: true },
      signal,
      timeoutMs: liveTimeoutMs,
    });
    return { result, finalKey: normalizeUrl(result.url)?.key || null };
  }

  function remember(finalKey) {
    if (!finalKey) return;
    seen.add(finalKey);
    scannedKeys.add(finalKey);
  }

  /* ---------------------------------------------------------- home page */

  if (homeKey) seen.add(homeKey);
  attempted += 1;
  inFlight.set(homeUrl, true);
  let recordedLiveTab = currentIsHome;
  try {
    let scanned;
    if (currentIsHome) {
      scanned = await withAuth(() => attemptScan(scanLiveTab));
    } else {
      try {
        scanned = await withAuth(() => attemptScan(() => scanOne({ url: homeUrl, key: homeKey }, options.pageTimeoutMs)));
      } catch (error) {
        if (isCancelled(error)) return finish(true);
        // Home is required as the crawl root, but a timeout there must not
        // kill Entire Site when the user started from /about or similar.
        fail({ url: homeUrl, attempts: options.retries + 1 }, error);
        scanned = await withAuth(() => attemptScan(scanLiveTab));
        recordedLiveTab = true;
      }
    }
    remember(scanned.finalKey);
    // Keep the open tab out of the fetch queue; it is scanned in the live tab next.
    if (!currentIsHome && !recordedLiveTab && currentKey) seen.add(currentKey);
    recordPage(scanned.result, null);
  } catch (error) {
    if (isCancelled(error)) return finish(true);
    throw error;
  } finally {
    inFlight.delete(homeUrl);
  }

  const extra = [];
  if (!currentIsHome && !recordedLiveTab && currentKey && !scannedKeys.has(currentKey)) {
    extra.push((async () => {
      attempted += 1;
      inFlight.set(current.url, true);
      emit();
      try {
        const live = await withAuth(() => attemptScan(scanLiveTab));
        remember(live.finalKey);
        recordPage(live.result, null);
      } catch (error) {
        if (!isCancelled(error)) fail({ url: current.url, attempts: options.retries + 1 }, error);
      } finally {
        inFlight.delete(current.url);
        emit();
        wake();
      }
    })());
  }
  emit();

  async function seedFromSitemap() {
    if (typeof deps.fetchText !== 'function') return;
    try {
      const hrefs = await withAuth(() =>
        collectSitemapUrls({
          origin,
          signal,
          fetchText: (url) => deps.fetchText(url, { origin, authorization, signal }),
        }),
      );
      enqueueLinks(hrefs, `${origin}/`);
    } catch (error) {
      if (isCancelled(error) || signal.aborted) throw error;
    }
  }

  try {
    await seedFromSitemap();
  } catch (error) {
    if (isCancelled(error)) return finish(true);
    throw error;
  }
  emit();

  async function processItem(item) {
    for (let attempt = 0; attempt <= options.retries; attempt += 1) {
      item.attempts = attempt + 1;
      try {
        const { result, finalKey } = await withAuth(() => scanOne(item));
        recordPage(result, finalKey);
        return;
      } catch (error) {
        if (isCancelled(error) || signal.aborted) throw createError(ERR.CANCELLED, 'Scan cancelled');
        const canRetry = RETRYABLE.has(error?.code) && attempt < options.retries;
        if (!canRetry) {
          fail(item, error);
          return;
        }
        await sleep(250 * (attempt + 1), signal);
      }
    }
  }

  async function worker() {
    while (!signal.aborted) {
      if (attempted >= options.maxPages) return;
      const item = queue.shift();
      if (!item) {
        if (inFlight.size === 0) return;
        await waitForWork();
        continue;
      }
      if (scannedKeys.has(item.key)) continue;
      attempted += 1;
      inFlight.set(item.url, true);
      emit();
      try {
        await processItem(item);
      } catch (error) {
        if (!isCancelled(error)) fail(item, error);
      } finally {
        inFlight.delete(item.url);
        emit();
        wake();
      }
    }
  }

  const workers = Array.from({ length: options.concurrency }, () => worker());
  await Promise.all([...extra, ...workers]);
  return finish(signal.aborted);

  /* --------------------------------------------------------------- result */

  function finish(cancelled) {
    const notScanned = queue.length;
    return {
      pages,
      failures,
      coverage: {
        scope: 'site',
        origin,
        mode: useBackground ? CRAWL_MODE.BACKGROUND : CRAWL_MODE.TABS,
        maxPages: options.maxPages,
        discovered: seen.size,
        scanned: pages.length,
        failed: failures.length,
        duplicates: duplicates.length,
        notScanned,
        limitReached: !cancelled && notScanned > 0,
        cancelled,
        complete: !cancelled && failures.length === 0 && notScanned === 0,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}
