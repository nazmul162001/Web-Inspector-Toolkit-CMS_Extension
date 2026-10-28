/**
 * Content-script entry point: registers message handlers and delegates to the
 * scanners. Contains no scanning logic itself.
 */

import { ERR, MSG } from '../shared/constants.js';
import { createError } from '../shared/helpers.js';
import { isScanTarget } from '../shared/validators.js';
import { broadcast, registerHandlers } from '../services/message-service.js';
import { collectLinks } from './dom-scanner.js';
import { CONTEXT_ID, lookupRegisteredElement } from './element-registry.js';
import { runScan } from './run-scan.js';
import { clearHighlight, highlightElement } from './element-highlighter.js';

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
      links: options.collectLinks ? collectLinks(document) : undefined,
    };
  } finally {
    runningScans.delete(scanId);
  }
}

function handleHighlight({ elementId, contextId, path, tag, mode = 'highlight', label }) {
  // Prefer the exact element remembered from the scan (same content-script life)...
  let element = elementId && contextId === CONTEXT_ID ? lookupRegisteredElement(elementId) : null;
  // ...otherwise fall back to the unique path, accepted only if the tag still agrees.
  if (!element && path) {
    try {
      const candidate = document.querySelector(path);
      if (candidate && (!tag || candidate.localName === tag)) element = candidate;
    } catch {
      element = null;
    }
  }
  if (!element) throw createError(ERR.NOT_FOUND, 'The element is no longer on the page. Run Find again.');
  const outcome = highlightElement(element, { outline: mode !== 'scroll', label });
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
  });

  // Leaving the page aborts any scan and removes the overlay.
  window.addEventListener('pagehide', () => {
    runningScans.forEach((job) => {
      job.cancelled = true;
    });
    clearHighlight();
  });
}
