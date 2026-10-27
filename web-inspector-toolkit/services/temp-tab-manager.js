/**
 * Lifecycle of the temporary background tabs used by the Entire Site crawl.
 *
 * Guarantees:
 *  - tabs are opened inactive (the user's active tab is never switched) and muted;
 *  - every opened tab id is tracked in memory AND in chrome.storage.session, so
 *    if the service worker is ever restarted mid-crawl the orphans are closed
 *    the next time it starts;
 *  - closing is idempotent and never throws.
 */

import { ERR, STORAGE_KEYS } from '../shared/constants.js';
import { createError } from '../shared/helpers.js';

const live = new Set();

async function persist() {
  try {
    await chrome.storage.session.set({ [STORAGE_KEYS.TEMP_TABS]: Array.from(live) });
  } catch {
    /* storage.session unavailable - in-memory tracking still works */
  }
}

export async function openTempTab(url, { windowId } = {}) {
  const tab = await chrome.tabs.create({ url, active: false, ...(windowId ? { windowId } : {}) });
  live.add(tab.id);
  await persist();
  try {
    await chrome.tabs.update(tab.id, { muted: true });
  } catch {
    /* tab may already be gone */
  }
  return tab;
}

export async function closeTempTab(tabId) {
  live.delete(tabId);
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* already closed */
  }
  await persist();
}

export async function closeAllTempTabs() {
  await Promise.all(Array.from(live).map((id) => closeTempTab(id)));
}

/** Close tabs left behind by a previous (killed) service-worker instance. */
export async function cleanupOrphanedTempTabs() {
  try {
    const stored = await chrome.storage.session.get(STORAGE_KEYS.TEMP_TABS);
    const ids = (stored[STORAGE_KEYS.TEMP_TABS] || []).filter((id) => !live.has(id));
    await Promise.all(ids.map((id) => chrome.tabs.remove(id).catch(() => {})));
    await persist();
  } catch {
    /* nothing to clean */
  }
}

/**
 * Resolve with the tab once navigation has completed. Rejects on timeout,
 * abort, or if the tab is closed first.
 */
export function waitForTabComplete(tabId, { timeoutMs = 20000, signal } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };

    // The tab starts out as about:blank; only a real, completed navigation counts.
    const isReady = (tab) =>
      tab && tab.status === 'complete' && tab.url && tab.url !== 'about:blank' && !tab.pendingUrl;

    const onUpdated = (id, change, tab) => {
      if (id === tabId && change.status === 'complete' && isReady(tab)) finish(resolve, tab);
    };
    const onRemoved = (id) => {
      if (id === tabId) finish(reject, createError(ERR.LOAD_FAILED, 'The page tab was closed before it finished loading.'));
    };
    const onAbort = () => finish(reject, createError(ERR.CANCELLED, 'Scan cancelled'));
    const timer = setTimeout(
      () => finish(reject, createError(ERR.TIMEOUT, `The page did not finish loading within ${Math.round(timeoutMs / 1000)}s.`)),
      timeoutMs,
    );

    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (isReady(tab)) finish(resolve, tab);
      })
      .catch(() => finish(reject, createError(ERR.LOAD_FAILED, 'The page tab could not be opened.')));
  });
}
