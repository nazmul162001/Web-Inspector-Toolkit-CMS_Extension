/**
 * Entire Site scan: a bounded, same-origin, breadth-first crawl that inspects
 * the RENDERED DOM of every page (never downloaded HTML).
 *
 * - The page the user is on is scanned in their own tab (exact current state,
 *   including authentication and client-side rendering).
 * - Every other page is opened in a temporary inactive background tab, awaited
 *   until `complete` plus a short render delay, scanned by the content script,
 *   and the tab is closed in a `finally` block no matter what happens.
 * - Links are discovered from each rendered page, normalized, de-duplicated,
 *   restricted to the start origin and filtered to crawlable URLs.
 * - Concurrency, page count, timeouts and retries are bounded; the crawl can
 *   be cancelled at any moment through an AbortSignal.
 * - The result never claims full coverage: failed pages, pages never reached
 *   because of the limit, and cancellation are all reported.
 */

import { ERR } from '../shared/constants.js';
import { createError, isCancelled, sleep, throttle } from '../shared/helpers.js';
import { sanitizeCrawlOptions } from '../shared/validators.js';
import { extractInternalLinks, isSameOrigin, normalizeUrl } from './url-normalizer.js';
import { scanTab } from './page-scan-service.js';
import { closeTempTab, openTempTab, waitForTabComplete } from './temp-tab-manager.js';

const MAX_DISCOVERED_URLS = 5000;
const RETRYABLE = new Set([ERR.TIMEOUT, ERR.LOAD_FAILED, ERR.NO_RECEIVER, ERR.PORT_CLOSED, ERR.INJECTION_FAILED]);

const defaultDeps = { scanTab, openTempTab, closeTempTab, waitForTabComplete };

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
  deps = defaultDeps,
}) {
  const options = sanitizeCrawlOptions(crawl);
  const origin = new URL(startUrl).origin;
  const startedAt = Date.now();

  const pages = [];
  const failures = [];
  const duplicates = [];
  const queue = [];
  const seen = new Set();
  const scannedKeys = new Set();
  const inFlight = new Map(); // url -> true
  const waiters = [];
  let attempted = 0;
  let matchCount = 0;

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
    250,
  );

  function enqueueLinks(links, pageUrl) {
    if (!links?.length) return;
    for (const link of extractInternalLinks(links, pageUrl, origin)) {
      if (seen.has(link.key) || seen.size >= MAX_DISCOVERED_URLS) continue;
      seen.add(link.key);
      queue.push(link);
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

  /* ---------------------------------------------------------- start page */

  const startKey = normalizeUrl(startUrl)?.key;
  if (startKey) {
    seen.add(startKey);
    scannedKeys.add(startKey);
  }
  attempted += 1;
  inFlight.set(startUrl, true);
  try {
    const result = await deps.scanTab(startTabId, {
      scanId,
      target,
      options: { ...scanOptions, collectLinks: true },
      signal,
      timeoutMs: Math.max(options.pageTimeoutMs, 60000),
    });
    const finalKey = normalizeUrl(result.url)?.key;
    if (finalKey) {
      seen.add(finalKey);
      scannedKeys.add(finalKey);
    }
    recordPage(result, null);
  } catch (error) {
    if (isCancelled(error)) return finish(true);
    throw error; // the current page must be scannable, otherwise nothing sensible can follow
  } finally {
    inFlight.delete(startUrl);
  }
  emit();

  /* -------------------------------------------------------- crawl others */

  async function scanInTempTab(item) {
    let tabId = null;
    try {
      const tab = await deps.openTempTab(item.url, { windowId });
      tabId = tab.id;
      const loaded = await deps.waitForTabComplete(tabId, { timeoutMs: options.pageTimeoutMs, signal });

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
        timeoutMs: options.pageTimeoutMs,
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

  async function processItem(item) {
    for (let attempt = 0; attempt <= options.retries; attempt += 1) {
      item.attempts = attempt + 1;
      try {
        const { result, finalKey } = await scanInTempTab(item);
        recordPage(result, finalKey);
        return;
      } catch (error) {
        if (isCancelled(error) || signal.aborted) throw createError(ERR.CANCELLED, 'Scan cancelled');
        const canRetry = RETRYABLE.has(error?.code) && attempt < options.retries;
        if (!canRetry) {
          fail(item, error);
          return;
        }
        await sleep(600 * (attempt + 1), signal);
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
  await Promise.all(workers);
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
