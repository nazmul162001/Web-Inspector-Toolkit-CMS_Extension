/**
 * Content-script entry point: registers message handlers and delegates to the
 * scanners. Contains no scanning logic itself.
 */

import { ERR, MSG } from '../shared/constants.js';
import { createError } from '../shared/helpers.js';
import { isScanTarget } from '../shared/validators.js';
import { broadcast, registerHandlers } from '../services/message-service.js';
import { collectLinks } from './dom-scanner.js';
import { runScan } from './run-scan.js';
import { locateElement } from './element-locator.js';
import { revealPopup } from './popup-reveal.js';
import { clearHighlight, highlightElement } from './element-highlighter.js';
import { sanitizeWidthQuery } from '../services/width-matcher.js';
import { clearMarks, markPage } from './width-marks.js';
import { inspectedImageSource, startInspector, stopInspector } from './image-inspector.js';
import { startSnsChecker, stopSnsChecker } from './sns-checker.js';
import { startOverflowFinder, stopOverflowFinder } from './overflow-finder.js';
import { cancelScreenshot, commandScreenshot, startScreenshot } from './screenshot.js';

/** scanId -> { cancelled } for scans currently running in this page. */
const runningScans = new Map();
let initialised = false;

function navigationInfo() {
  const entry = performance.getEntriesByType?.('navigation')?.[0];
  return {
    httpStatus: typeof entry?.responseStatus === 'number' && entry.responseStatus > 0 ? entry.responseStatus : null,
    contentType: document.contentType,
    readyState: document.readyState,
  };
}

async function handleScan({ scanId, target, options = {} }) {
  if (!isScanTarget(target)) throw createError(ERR.INVALID_REQUEST, 'Invalid search target.');
  const job = { cancelled: false };
  runningScans.set(scanId, job);
  try {
    const result = await runScan({
      target,
      options,
      isCancelled: () => job.cancelled,
      onProgress: (progress) => {
        if (options.reportProgress) broadcast(MSG.CONTENT_PROGRESS, { scanId, ...progress });
      },
    });
    return {
      url: location.href,
      title: document.title,
      scannedAt: Date.now(),
      ...navigationInfo(),
      ...result,
      links: options.collectLinks ? collectLinks(document, undefined, location.href) : undefined,
    };
  } finally {
    runningScans.delete(scanId);
  }
}

async function handleHighlight({ elementId, contextId, path, tag, mode = 'highlight', label, marks, hint }) {
  // Half/Full Width Text: also mark the found characters when this page was opened from a result.
  const widthQuery = marks ? sanitizeWidthQuery(marks) : null;
  if (widthQuery) markPage(widthQuery);

  const element = locateElement({ elementId, contextId, path, tag, hint });
  if (!element) throw createError(ERR.NOT_FOUND, 'The element is no longer on the page. Run Find again.');
  const popup = await revealPopup(element);
  const outcome = highlightElement(element, { outline: mode !== 'scroll', label, keepScroll: !!popup });
  if (!outcome.ok) {
    throw createError(ERR.NOT_VISIBLE, 'The element is hidden (display: none or zero size), so it cannot be shown.');
  }
  return { note: outcome.note || null };
}

/** Safe to call repeatedly (re-injection); handlers are registered once. */
export function init() {
  if (initialised) return;
  initialised = true;

  registerHandlers({
    [MSG.CONTENT_PING]: () => ({ ready: true, url: location.href, title: document.title }),
    [MSG.CONTENT_SCAN]: handleScan,
    [MSG.CONTENT_CANCEL]: ({ scanId }) => {
      const job = runningScans.get(scanId);
      if (job) job.cancelled = true;
      return { cancelled: !!job };
    },
    [MSG.CONTENT_HIGHLIGHT]: handleHighlight,
    [MSG.CONTENT_IMAGE_INSPECT]: ({ enabled, options } = {}) => (enabled ? startInspector(options) : stopInspector()),
    [MSG.CONTENT_IMAGE_SOURCE]: () => inspectedImageSource(),
    [MSG.CONTENT_SNS_CHECK]: ({ enabled, options } = {}) => (enabled ? startSnsChecker(options) : stopSnsChecker()),
    [MSG.CONTENT_OVERFLOW_FIND]: ({ enabled, options } = {}) => (enabled ? startOverflowFinder(options) : stopOverflowFinder()),
    [MSG.CONTENT_SCREENSHOT]: ({ action, mode, language } = {}) => {
      if (action === 'start') return startScreenshot({ mode, language });
      if (action === 'copy' || action === 'save') return commandScreenshot(action);
      return cancelScreenshot();
    },
    [MSG.CONTENT_CLEAR_MARKS]: () => {
      clearMarks();
      return { cleared: true };
    },
  });

  // Leaving the page aborts any scan and removes the overlay.
  window.addEventListener('pagehide', () => {
    runningScans.forEach((job) => {
      job.cancelled = true;
    });
    clearHighlight();
    stopInspector();
    stopSnsChecker();
    stopOverflowFinder();
    cancelScreenshot({ force: true });
  });
}
