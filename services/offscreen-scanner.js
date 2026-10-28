/**
 * Service-worker side of the invisible crawl: owns the offscreen document and
 * asks it to scan URLs. No tab or window is created.
 */

import { ERR, MSG } from '../shared/constants.js';
import { createError, sleep, uid } from '../shared/helpers.js';
import { sendToOffscreen } from './message-service.js';

const PAGE = 'offscreen/offscreen.html';
let creating = null;

async function hasDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(PAGE)],
  });
  return contexts.length > 0;
}

/** Create the hidden document if needed and wait until it answers. */
export async function ensureOffscreen() {
  if (!(await hasDocument())) {
    creating ||= chrome.offscreen
      .createDocument({
        url: PAGE,
        reasons: ['IFRAME_SCRIPTING'],
        justification:
          'Render pages of the current website invisibly (sandboxed, without scripts) so their colors can be inspected without opening tabs.',
      })
      .finally(() => {
        creating = null;
      });
    await creating;
  }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      await sendToOffscreen(MSG.OFFSCREEN_PING, null, { timeoutMs: 1000 });
      return;
    } catch {
      await sleep(80);
    }
  }
  throw createError(ERR.UNKNOWN, 'The background renderer did not start.');
}

export async function closeOffscreen() {
  try {
    if (await hasDocument()) await chrome.offscreen.closeDocument();
  } catch {
    /* already gone */
  }
}

/**
 * Scan one URL invisibly.
 * @param {string} url
 * @param {{ scanId?: string, origin: string, target: object, options?: object, signal?: AbortSignal, timeoutMs?: number }} params
 */
export async function scanUrl(url, { origin, target, options = {}, signal, timeoutMs = 20000 }) {
  if (signal?.aborted) throw createError(ERR.CANCELLED, 'Scan cancelled');
  await ensureOffscreen();

  const jobId = uid('job');
  const cancelRemote = () => {
    sendToOffscreen(MSG.OFFSCREEN_CANCEL, { jobId }, { timeoutMs: 2000 }).catch(() => {});
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
    const job = sendToOffscreen(
      MSG.OFFSCREEN_SCAN_URL,
      { jobId, url, origin, target, options, timeoutMs },
      { timeoutMs: timeoutMs + 20000 },
    );
    return await (aborted ? Promise.race([job, aborted]) : job);
  } catch (error) {
    if (error?.code === ERR.TIMEOUT) cancelRemote();
    throw error;
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}
