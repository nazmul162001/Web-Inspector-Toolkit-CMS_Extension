/**
 * Service worker side of the Screenshot Taker: the only place that may
 * photograph a tab (tabs.captureVisibleTab).
 *
 * A tab can only be photographed while a screenshot run that the user started
 * is going on in it, and only by this extension's own content script. The set
 * of such tabs is kept in session storage because the worker may be stopped
 * while the user is still choosing an area.
 */

import { ERR } from '../shared/constants.js';
import { createError, sleep } from '../shared/helpers.js';
import { CAPTURE_GAP_MS } from './screenshot-geometry.js';

const KEY = 'wit.screenshotTabs';
const RETRIES = 3;

async function readTabs() {
  const stored = await chrome.storage.session.get(KEY);
  return Array.isArray(stored[KEY]) ? stored[KEY] : [];
}

/** Allow (or stop allowing) photos of a tab. */
export async function markScreenshotTab(tabId, on) {
  const tabs = new Set(await readTabs());
  if (on) tabs.add(tabId);
  else tabs.delete(tabId);
  await chrome.storage.session.set({ [KEY]: [...tabs] });
}

export async function isScreenshotTab(tabId) {
  return (await readTabs()).includes(tabId);
}

let chain = Promise.resolve();
let lastShotAt = 0;

async function takePhoto(windowId) {
  for (let attempt = 1; ; attempt += 1) {
    const wait = lastShotAt + CAPTURE_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait); // Chrome allows about two photos a second
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      lastShotAt = Date.now();
      return dataUrl;
    } catch (error) {
      lastShotAt = Date.now();
      const text = String(error?.message || error);
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(text) && attempt < RETRIES) {
        await sleep(CAPTURE_GAP_MS + 100);
        continue;
      }
      if (/permission|activeTab|<all_urls>/i.test(text)) {
        throw createError(ERR.PERMISSION_DENIED, 'Chrome needs permission to photograph the tab. Nothing is uploaded.');
      }
      throw createError(ERR.CAPTURE_FAILED, 'Chrome could not take the screenshot. Make sure the tab is visible and try again.', { cause: text });
    }
  }
}

/**
 * Photograph the visible part of the tab that sent the message.
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<{ dataUrl: string }>}
 */
export function captureForSender(sender) {
  const run = async () => {
    const tabId = sender?.tab?.id;
    if (sender?.id !== chrome.runtime.id || !Number.isInteger(tabId) || !(await isScreenshotTab(tabId))) {
      throw createError(ERR.INVALID_REQUEST, 'No screenshot was requested for this tab.');
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw createError(ERR.NO_TAB, 'The tab was closed.');
    if (!tab.active) throw createError(ERR.TAB_NOT_ACTIVE, 'The tab is in the background. Switch back to it and try again.');
    return { dataUrl: await takePhoto(tab.windowId) };
  };
  const result = chain.then(run, run); // one photo at a time, in order
  chain = result.catch(() => {});
  return result;
}
