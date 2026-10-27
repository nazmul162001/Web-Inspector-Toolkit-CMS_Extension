/**
 * Runs scans in a single tab from the service worker: injects the content
 * script on demand, sends the scan request, and handles cancellation/timeouts.
 * Used for This Page scans and by the site crawler for every crawled page.
 */

import { ERR, MSG, PAGE_SCAN_TIMEOUT_MS } from '../shared/constants.js';
import { createError, sleep } from '../shared/helpers.js';
import { classifyChromeError, sendToTab } from './message-service.js';

const CONTENT_FILE = 'content/content.js';

async function pingTab(tabId, timeoutMs) {
  try {
    return await sendToTab(tabId, MSG.CONTENT_PING, null, { timeoutMs });
  } catch {
    return null;
  }
}

/**
 * Make sure the scanner is running in `tabId`. Injection needs either an
 * active activeTab grant or host permission for the tab's origin; failures are
 * mapped to PERMISSION_DENIED / RESTRICTED_PAGE / FILE_ACCESS errors.
 */
export async function ensureContentScript(tabId, { timeoutMs = 4000 } = {}) {
  if (await pingTab(tabId, 800)) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
  } catch (error) {
    const mapped = classifyChromeError(error);
    if (mapped.code === ERR.UNKNOWN) {
      throw createError(ERR.INJECTION_FAILED, `Could not start the scanner: ${mapped.message}`);
    }
    throw mapped;
  }

  // The loader imports the module graph asynchronously - wait until it answers.
  const deadline = Date.now() + timeoutMs;
  let delay = 60;
  while (Date.now() < deadline) {
    if (await pingTab(tabId, 600)) return;
    await sleep(delay);
    delay = Math.min(delay * 2, 400);
  }
  throw createError(ERR.INJECTION_FAILED, 'The scanner did not start in the page. Reload the page and try again.');
}

/** Lightweight "can we run code in this tab right now?" probe. */
export async function probeAccess(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => true });
    return { ok: true };
  } catch (error) {
    const mapped = classifyChromeError(error);
    return { ok: false, code: mapped.code, message: mapped.message };
  }
}

/**
 * Scan one tab.
 * @param {number} tabId
 * @param {{ scanId: string, target: object, options?: object, signal?: AbortSignal, timeoutMs?: number }} params
 */
export async function scanTab(tabId, { scanId, target, options = {}, signal, timeoutMs = PAGE_SCAN_TIMEOUT_MS }) {
  if (signal?.aborted) throw createError(ERR.CANCELLED, 'Scan cancelled');
  await ensureContentScript(tabId);

  const cancelRemote = () => {
    sendToTab(tabId, MSG.CONTENT_CANCEL, { scanId }, { timeoutMs: 2000 }).catch(() => {});
  };

  let onAbort;
  const aborted = signal
    ? new Promise((_, reject) => {
        onAbort = () => {
          cancelRemote();
          reject(createError(ERR.CANCELLED, 'Scan cancelled'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      })
    : null;

  try {
    const scan = sendToTab(tabId, MSG.CONTENT_SCAN, { scanId, target, options }, { timeoutMs });
    return await (aborted ? Promise.race([scan, aborted]) : scan);
  } catch (error) {
    if (error?.code === ERR.TIMEOUT) cancelRemote();
    throw error;
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Highlight (or scroll to) an element in a tab. */
export async function highlightInTab(tabId, locator, mode) {
  await ensureContentScript(tabId);
  return sendToTab(tabId, MSG.CONTENT_HIGHLIGHT, { ...locator, mode }, { timeoutMs: 8000 });
}
