/**
 * Offscreen document: renders pages of a site crawl invisibly (no tabs).
 * The service worker sends one OFFSCREEN_SCAN_URL request per page; this
 * script answers with the scan result. See services/background-renderer.js.
 */

import { ERR, MSG } from '../shared/constants.js';
import { createError, isCancelled } from '../shared/helpers.js';
import { isCanonicalColor } from '../shared/validators.js';
import { registerHandlers } from '../services/message-service.js';
import { createBackgroundRenderer } from '../services/background-renderer.js';

const renderer = createBackgroundRenderer({ container: document.body });

/** jobId -> AbortController */
const jobs = new Map();

registerHandlers({
  [MSG.OFFSCREEN_PING]: () => ({ ready: true }),

  [MSG.OFFSCREEN_SCAN_URL]: async ({ jobId, url, origin, target, options, timeoutMs }) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw createError(ERR.INVALID_REQUEST, 'Invalid URL.');
    if (!isCanonicalColor(target)) throw createError(ERR.INVALID_REQUEST, 'Invalid target color.');
    const controller = new AbortController();
    jobs.set(jobId, controller);
    try {
      return await renderer.scanUrl(url, {
        target,
        origin,
        options,
        signal: controller.signal,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 20000,
      });
    } catch (error) {
      if (isCancelled(error)) throw createError(ERR.CANCELLED, 'Scan cancelled');
      throw error;
    } finally {
      jobs.delete(jobId);
    }
  },

  [MSG.OFFSCREEN_CANCEL]: ({ jobId }) => {
    const controller = jobs.get(jobId);
    controller?.abort();
    return { cancelled: !!controller };
  },
});
