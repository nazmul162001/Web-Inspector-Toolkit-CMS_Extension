/**
 * Service worker: the only context that talks to tabs and orchestrates scans.
 *
 *   side panel  --(requests)-->  service worker  --(requests)-->  content script
 *   side panel  <--(events)----  service worker  <--(events)----  content script
 *
 * It owns scan lifecycles (AbortControllers), relays progress, and makes sure
 * temporary crawl tabs never outlive a scan or the panel that started it.
 */

import { ERR, MSG } from '../shared/constants.js';
import { createError } from '../shared/helpers.js';
import { checkRestrictedUrl, originPattern, parseScanRequest } from '../shared/validators.js';
import { broadcast, onEvent, registerHandlers, watchSessions } from '../services/message-service.js';
import { clearMarksInTab, controlScreenshot, highlightInTab, probeAccess, scanTab, setImageInspector } from '../services/page-scan-service.js';
import { captureForSender, markScreenshotTab } from '../services/capture-tab-service.js';
import { crawlSite } from '../services/site-crawler.js';
import { closeOffscreen, scanUrl } from '../services/offscreen-scanner.js';
import { normalizeUrl } from '../services/url-normalizer.js';
import { sanitizeWidthQuery } from '../services/width-matcher.js';
import { normalizeLanguage } from '../services/i18n.js';
import { loadSettings } from '../services/settings-service.js';
import { sanitizeCombo } from '../services/screenshot-hotkey.js';
import { syncScreenshotHotkey } from '../services/screenshot-hotkey-service.js';
import {
  cleanupOrphanedTempTabs,
  closeAllTempTabs,
  closeTempTab,
  openTempTab,
  waitForTabComplete,
} from '../services/temp-tab-manager.js';

/* -------------------------------------------------------------- Startup */

// Clicking the toolbar icon opens the native side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.error('[WIT] could not enable open-on-click', error);
});

// A previous service-worker instance may have been killed mid-crawl.
cleanupOrphanedTempTabs();
closeOffscreen(); // a leftover hidden renderer from a previous worker is not needed at boot
loadSettings()
  .then((settings) => syncScreenshotHotkey(settings.screenshot.shortcut))
  .catch(() => {});

/* ----------------------------------------------------------- Scan state */

/** scanId -> { controller, sessionId } */
const activeScans = new Map();

function beginScan(scanId, sessionId) {
  const controller = new AbortController();
  activeScans.set(scanId, { controller, sessionId });
  return controller;
}

function endScan(scanId) {
  activeScans.delete(scanId);
}

watchSessions({
  // The side panel closed: stop its scans; temp tabs are closed by the crawler's finally blocks.
  onDisconnect(sessionId) {
    for (const [scanId, scan] of activeScans) {
      if (scan.sessionId !== sessionId) continue;
      scan.controller.abort();
      endScan(scanId);
    }
    stopInspectorOf(sessionId); // the panel closed: the hover inspector must not stay on in the page
    stopScreenshotOf(sessionId); // stop a capture in progress; an open editor on the page is left
  },
});

/* ------------------------------------------------------ Image inspector */

/** sessionId -> tabId where that side panel's Image Resolution inspector runs. */
const inspectors = new Map();

function stopInspectorOf(sessionId) {
  const tabId = inspectors.get(sessionId);
  inspectors.delete(sessionId);
  if (tabId !== undefined) setImageInspector(tabId, false).catch(() => {}); // the tab may be gone already
}

// Per-page progress from content scripts is relayed under a single event type.
onEvent(MSG.CONTENT_PROGRESS, (progress) => {
  if (activeScans.has(progress.scanId)) {
    broadcast(MSG.SCAN_PROGRESS, { phase: 'page', ...progress });
  }
});

/* ------------------------------------------------------------ Tab context */

async function resolveActiveTab(windowId) {
  const query = windowId ? { active: true, windowId } : { active: true, lastFocusedWindow: true };
  const [tab] = await chrome.tabs.query(query);
  if (!tab) return null;

  // When the panel page itself is opened in a tab (development/testing), fall
  // back to the most recently used regular tab in that window.
  if (tab.url?.startsWith(chrome.runtime.getURL(''))) {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    const others = tabs
      .filter((t) => t.id !== tab.id && t.url && !t.url.startsWith(chrome.runtime.getURL('')))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    if (others[0]) return others[0];
  }
  return tab;
}

async function getTabContext({ windowId } = {}) {
  const tab = await resolveActiveTab(windowId);
  if (!tab) return { tab: null, restricted: true, restrictionReason: 'No active tab was found.' };

  const restriction = checkRestrictedUrl(tab.url);
  const pattern = originPattern(tab.url);
  const hasHostAccess = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false;

  return {
    tab: {
      id: tab.id,
      windowId: tab.windowId,
      url: tab.url || '',
      title: tab.title || '',
      favIconUrl: tab.favIconUrl || '',
      status: tab.status,
    },
    origin: pattern ? new URL(tab.url).origin : null,
    originPattern: pattern,
    hasHostAccess,
    fileUrl: !!restriction.fileUrl,
    restricted: restriction.restricted,
    restrictionReason: restriction.reason || null,
  };
}

function announceTabChange(tabId, windowId) {
  broadcast(MSG.TAB_CONTEXT_CHANGED, { tabId, windowId });
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => announceTabChange(tabId, windowId));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.active && (change.url || change.title || change.status === 'complete')) {
    announceTabChange(tabId, tab.windowId);
  }
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) announceTabChange(null, windowId);
});

/* ---------------------------------------------------------------- Scans */

async function requireScannableTab(tabId, { site }) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw createError(ERR.NO_TAB, 'The tab was closed.');
  const restriction = checkRestrictedUrl(tab.url);
  if (restriction.restricted) throw createError(ERR.RESTRICTED_PAGE, restriction.reason);
  if (site) {
    if (restriction.fileUrl) {
      throw createError(ERR.RESTRICTED_PAGE, 'Entire Site scanning supports http(s) websites, not local files.');
    }
    const pattern = originPattern(tab.url);
    if (!(await chrome.permissions.contains({ origins: [pattern] }))) {
      throw createError(ERR.PERMISSION_DENIED, 'Access to this website has not been granted.', {
        origin: new URL(tab.url).origin,
      });
    }
  }
  return tab;
}

async function handleScanPage(payload) {
  const request = parseScanRequest(payload);
  await requireScannableTab(request.tabId, { site: false });
  const controller = beginScan(request.scanId, request.sessionId);
  const startedAt = Date.now();
  try {
    const { links, ...page } = await scanTab(request.tabId, {
      scanId: request.scanId,
      target: request.target,
      options: { ...request.scanOptions, reportProgress: true },
      signal: controller.signal,
    });
    return {
      scanId: request.scanId,
      scope: 'page',
      target: request.target,
      tabId: request.tabId,
      pages: [page],
      failures: [],
      coverage: {
        scope: 'page',
        scanned: 1,
        failed: 0,
        notScanned: 0,
        cancelled: false,
        complete: true,
        durationMs: Date.now() - startedAt,
      },
    };
  } finally {
    endScan(request.scanId);
  }
}

async function handleScanSite(payload) {
  const request = parseScanRequest(payload, { site: true });
  const tab = await requireScannableTab(request.tabId, { site: true });
  const controller = beginScan(request.scanId, request.sessionId);
  try {
    const result = await crawlSite({
      startTabId: request.tabId,
      startUrl: tab.url,
      windowId: tab.windowId,
      scanId: request.scanId,
      target: request.target,
      scanOptions: request.scanOptions,
      crawl: request.crawl,
      signal: controller.signal,
      onProgress: (progress) => broadcast(MSG.SCAN_PROGRESS, progress),
      // Stream every finished page so the panel can show results while the crawl continues.
      onPage: (page) => broadcast(MSG.SCAN_PAGE_RESULT, { scanId: request.scanId, page }),
      deps: { scanTab, scanUrl, openTempTab, closeTempTab, waitForTabComplete },
    });
    return { scanId: request.scanId, scope: 'site', target: request.target, tabId: request.tabId, ...result };
  } finally {
    endScan(request.scanId);
    if (activeScans.size === 0) {
      await closeAllTempTabs(); // belt and braces
      await closeOffscreen(); // the invisible renderer only lives for the duration of a crawl
    }
  }
}

function handleCancel({ scanId }) {
  const scan = activeScans.get(scanId);
  if (scan) scan.controller.abort();
  return { cancelled: !!scan };
}

/* ------------------------------------------------------------ Highlight */

async function findOrOpenPageTab({ tabId, windowId, pageUrl }) {
  const wanted = normalizeUrl(pageUrl)?.key;
  const matches = (tab) => tab?.url && normalizeUrl(tab.url)?.key === wanted;

  if (tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (matches(tab)) return tab;
  }
  const candidates = await chrome.tabs.query(windowId ? { windowId } : {});
  const existing = candidates.find(matches);
  if (existing) return existing;

  const created = await chrome.tabs.create({ url: pageUrl, active: true, ...(windowId ? { windowId } : {}) });
  return waitForTabComplete(created.id, { timeoutMs: 30000 });
}

async function handleHighlight(payload) {
  const { pageUrl, elementId, contextId, path, tag, mode, label, tabId, windowId, marks } = payload || {};
  if (!pageUrl || (!path && !elementId)) throw createError(ERR.INVALID_REQUEST, 'Missing element locator.');

  const tab = await findOrOpenPageTab({ tabId, windowId, pageUrl });
  // The user asked to see the element, so (unlike scanning) bringing the tab forward is intended.
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  const widthMarks = marks ? sanitizeWidthQuery(marks) : null; // never forward an unchecked payload
  return highlightInTab(tab.id, { elementId, contextId, path, tag, label, ...(widthMarks ? { marks: widthMarks } : {}) }, mode);
}

async function handleImageInspect({ tabId, enabled, options, sessionId } = {}) {
  if (!Number.isInteger(tabId)) throw createError(ERR.INVALID_REQUEST, 'Missing tab.');
  const settings = {
    backgrounds: options?.backgrounds !== false,
    outline: options?.outline !== false,
    preview: options?.preview !== false,
    language: normalizeLanguage(options?.language),
  };
  if (!enabled) {
    if (inspectors.get(sessionId) === tabId) inspectors.delete(sessionId);
    try {
      return await setImageInspector(tabId, false);
    } catch {
      return { running: false };
    }
  }
  const result = await setImageInspector(tabId, true, settings);
  if (typeof sessionId === 'string') {
    const previous = inspectors.get(sessionId);
    if (previous !== undefined && previous !== tabId) setImageInspector(previous, false).catch(() => {});
    inspectors.set(sessionId, tabId);
  }
  return result;
}

/* ------------------------------------------------------ Screenshot Taker */

const SHOT_MODES = ['area', 'current', 'full'];

/** sessionId -> tabId of a screenshot that panel started. */
const screenshotSessions = new Map();

function stopScreenshotOf(sessionId) {
  const tabId = screenshotSessions.get(sessionId);
  screenshotSessions.delete(sessionId);
  if (tabId !== undefined) handleScreenshotCancel({ tabId }).catch(() => {});
}

async function handleScreenshotStart({ tabId, mode, language, sessionId } = {}) {
  if (!Number.isInteger(tabId) || !SHOT_MODES.includes(mode)) throw createError(ERR.INVALID_REQUEST, 'Invalid screenshot request.');
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw createError(ERR.NO_TAB, 'The tab was closed.');
  const restriction = checkRestrictedUrl(tab.url);
  if (restriction.restricted) throw createError(ERR.RESTRICTED_PAGE, restriction.reason);
  // Chrome photographs the tab the user is looking at; never switch tabs on their behalf.
  if (!tab.active) throw createError(ERR.TAB_NOT_ACTIVE, 'Switch to the tab you want to capture and try again.');
  await markScreenshotTab(tabId, true);
  try {
    const result = await controlScreenshot(tabId, 'start', { mode, language: normalizeLanguage(language) });
    await injectEditorKeyHook(tabId);
    if (typeof sessionId === 'string') {
      const previous = screenshotSessions.get(sessionId);
      if (previous !== undefined && previous !== tabId) handleScreenshotCancel({ tabId: previous }).catch(() => {});
      screenshotSessions.set(sessionId, tabId);
    }
    return result;
  } catch (error) {
    await markScreenshotTab(tabId, false);
    throw error;
  }
}

async function handleScreenshotCancel({ tabId } = {}) {
  if (!Number.isInteger(tabId)) return { cancelled: false };
  await markScreenshotTab(tabId, false);
  try {
    return await controlScreenshot(tabId, 'cancel');
  } catch {
    return { cancelled: false };
  }
}

/** A saved shortcut on the page: Select Area on this tab, no side panel. */
async function handleScreenshotHotkey(_payload, { sender } = {}) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) throw createError(ERR.INVALID_REQUEST, 'Invalid screenshot request.');
  const settings = await loadSettings();
  if (!settings.screenshot.shortcut) throw createError(ERR.INVALID_REQUEST, 'No screenshot shortcut is set.');
  return handleScreenshotStart({ tabId, mode: 'area', language: settings.language, sessionId: 'hotkey' });
}

async function handleScreenshotSetHotkey({ shortcut } = {}) {
  return syncScreenshotHotkey(sanitizeCombo(shortcut));
}

async function handleScreenshotEditor({ tabId, action } = {}) {
  if (!Number.isInteger(tabId) || (action !== 'copy' && action !== 'save')) {
    throw createError(ERR.INVALID_REQUEST, 'Invalid screenshot request.');
  }
  return controlScreenshot(tabId, action);
}

/**
 * Chrome handles ⌘S / ⌘C in the browser UI. A listener in the page's own
 * world can cancel that and tell the editor (isolated world) to copy or save.
 */
function injectEditorKeyHook(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        if (window.__witShotEditorKeys) return;
        window.__witShotEditorKeys = true;
        const activate = () => {
          const host = document.getElementById('wit-screenshot-editor');
          if (!host || document.activeElement === host) return;
          host.tabIndex = -1;
          try {
            window.focus();
          } catch {
            /* the tab may not take focus */
          }
          host.focus({ preventScroll: true });
        };
        window.addEventListener('pointermove', activate, true);
        window.addEventListener('pointerdown', activate, true);
        window.addEventListener(
          'keydown',
          (event) => {
            if (!document.getElementById('wit-screenshot-editor')) return;
            activate();
            if (event.repeat || !(event.ctrlKey || event.metaKey)) return;
            const code = event.code || '';
            const letter =
              code.startsWith('Key') && code.length === 4
                ? code.slice(3).toLowerCase()
                : event.key && event.key.length === 1
                  ? event.key.toLowerCase()
                  : '';
            if (letter !== 's' && letter !== 'c') return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            window.dispatchEvent(new CustomEvent('wit-screenshot-key', { bubbles: true, detail: { letter } }));
          },
          true,
        );
      },
    })
    .catch(() => {});
}

async function focusEditorTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        window.focus();
        const host = document.getElementById('wit-screenshot-editor');
        if (!host) return;
        host.tabIndex = -1;
        host.focus({ preventScroll: true });
      },
    })
    .catch(() => {});
}

onEvent(MSG.SCREENSHOT_EVENT, (event, { sender } = {}) => {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) return;
  if (event?.state === 'editing') {
    focusEditorTab(tabId).catch(() => {});
    return;
  }
  if (!['done', 'cancelled', 'error'].includes(event.state)) return;
  markScreenshotTab(tabId, false);
  for (const [sessionId, id] of screenshotSessions) {
    if (id === tabId) screenshotSessions.delete(sessionId);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => markScreenshotTab(tabId, false));

async function handleClearMarks({ tabId } = {}) {
  if (!Number.isInteger(tabId)) return { cleared: false };
  try {
    return await clearMarksInTab(tabId);
  } catch {
    return { cleared: false }; // the tab is gone, restricted or was never scanned
  }
}

/* ------------------------------------------------------------- Register */

registerHandlers({
  [MSG.GET_TAB_CONTEXT]: (payload) => getTabContext(payload),
  [MSG.CHECK_ACCESS]: async ({ tabId }) => probeAccess(tabId),
  [MSG.SCAN_PAGE]: handleScanPage,
  [MSG.SCAN_SITE]: handleScanSite,
  [MSG.CANCEL_SCAN]: handleCancel,
  [MSG.HIGHLIGHT]: handleHighlight,
  [MSG.CLEAR_MARKS]: handleClearMarks,
  [MSG.IMAGE_INSPECT]: handleImageInspect,
  [MSG.SCREENSHOT_START]: handleScreenshotStart,
  [MSG.SCREENSHOT_CANCEL]: handleScreenshotCancel,
  [MSG.SCREENSHOT_EDITOR]: handleScreenshotEditor,
  [MSG.SCREENSHOT_HOTKEY]: handleScreenshotHotkey,
  [MSG.SCREENSHOT_SET_HOTKEY]: handleScreenshotSetHotkey,
  [MSG.SCREENSHOT_CAPTURE]: (_payload, { sender }) => captureForSender(sender),
});
