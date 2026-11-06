/**
 * Screenshot Taker: taking the pictures.
 *
 * Chrome can only photograph what is visible in the tab, and only the service
 * worker may ask for it (tabs.captureVisibleTab). So:
 *   - Current Screen: one photo, trimmed to the page area (no scrollbars).
 *   - Select Area:    production freezes the whole screen (see screenshot-area-service);
 *                     tests still crop one tab photo to the rectangle.
 *   - Full Page:      the page is scrolled one screen at a time, a photo is
 *     taken at each stop and they are stitched together here.
 *
 * Nothing is sent anywhere: the pictures stay in this page's memory.
 */

import { MSG } from '../shared/constants.js';
import { sendToBackground } from '../services/message-service.js';
import { cropRegion, outputScale, planSlices } from '../services/screenshot-geometry.js';
import { EDITOR_HOST_ID } from './screenshot-editor.js';
import { SELECTOR_HOST_ID } from './screenshot-selector.js';
import { nextPaint } from './screenshot-ui.js';

export const CAPTURE_ERR = Object.freeze({
  CANCELLED: 'CANCELLED',
  HIDDEN: 'TAB_HIDDEN',
  FAILED: 'CAPTURE_FAILED',
  TOO_BIG: 'TOO_BIG',
});

export class CaptureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
  }
}

/** A `data:image/png;base64,...` string to a Blob (no fetch(): a page's CSP may forbid data: URLs). */
export function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) throw new CaptureError(CAPTURE_ERR.FAILED, 'Chrome returned an unreadable picture.');
  const type = /^data:([^;,]+)/.exec(dataUrl)?.[1] || 'image/png';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

const throwIfCancelled = (job) => {
  if (job.cancelled) throw new CaptureError(CAPTURE_ERR.CANCELLED, 'Cancelled.');
};

/** Photograph the visible part of the tab. `ratio*` are photo pixels per CSS pixel. */
async function grabViewport(job) {
  throwIfCancelled(job);
  if (document.visibilityState !== 'visible') {
    throw new CaptureError(CAPTURE_ERR.HIDDEN, 'The tab is in the background. Switch back to it and try again.');
  }
  let result;
  try {
    result = await sendToBackground(MSG.SCREENSHOT_CAPTURE, null, { timeoutMs: 20000 });
  } catch (error) {
    throw new CaptureError(error?.code || CAPTURE_ERR.FAILED, error?.message || 'The screenshot could not be taken.');
  }
  throwIfCancelled(job);
  const bitmap = await createImageBitmap(dataUrlToBlob(result.dataUrl));
  return { bitmap, ratioX: bitmap.width / window.innerWidth, ratioY: bitmap.height / window.innerHeight };
}

function newCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The part of a photo that shows the page (scrollbars cut off). */
function pageRegion(shot) {
  const root = document.documentElement;
  return cropRegion({ x: 0, y: 0, w: root.clientWidth, h: root.clientHeight }, shot.ratioX, shot.ratioY, shot.bitmap.width, shot.bitmap.height);
}

/* ---------------------------------------------------------- Current screen */

export async function captureCurrent(job) {
  const shot = await grabViewport(job);
  const { sx, sy, sw, sh } = pageRegion(shot);
  const canvas = newCanvas(sw, sh);
  canvas.getContext('2d').drawImage(shot.bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  shot.bitmap.close?.();
  return { canvas, pixelRatio: shot.ratioX, notes: [] };
}

/* ------------------------------------------------------------- Select area */

/** @param {{x:number,y:number,w:number,h:number}} rect in CSS px, relative to the window */
export async function captureArea(job, rect) {
  const shot = await grabViewport(job);
  const { sx, sy, sw, sh } = cropRegion(rect, shot.ratioX, shot.ratioY, shot.bitmap.width, shot.bitmap.height);
  const canvas = newCanvas(sw, sh);
  canvas.getContext('2d').drawImage(shot.bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  shot.bitmap.close?.();
  return { canvas, pixelRatio: shot.ratioX, notes: [] };
}

/* --------------------------------------------------------------- Full page */

/** Blocks clicks, wheel and touch for the time of the capture. It is see-through, so the photos do not show it. */
function createShield(job) {
  const shield = document.createElement('div');
  shield.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483646; cursor: progress; background: transparent;';
  const block = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  for (const type of ['click', 'mousedown', 'pointerdown', 'contextmenu']) shield.addEventListener(type, block);
  for (const type of ['wheel', 'touchmove']) shield.addEventListener(type, block, { passive: false });
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      job.cancel();
    } else if (['PageDown', 'PageUp', 'Home', 'End', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); // the keyboard must not scroll the page under the capture
    }
  };
  window.addEventListener('keydown', onKey, true);
  document.documentElement.append(shield);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    shield.remove();
  };
}

/** Hide everything that is stuck to the screen (fixed / sticky), so it is not repeated in every slice. Returns the undo. */
function hideFloatingElements() {
  const hidden = [];
  for (const element of document.querySelectorAll('body *')) {
    if (element.id === EDITOR_HOST_ID || element.id === SELECTOR_HOST_ID) continue;
    const position = getComputedStyle(element).position;
    if (position === 'fixed' || position === 'sticky') hidden.push(element);
  }
  const saved = hidden.map((element) => [element, element.style.getPropertyValue('visibility'), element.style.getPropertyPriority('visibility')]);
  for (const element of hidden) element.style.setProperty('visibility', 'hidden', 'important');
  return () => {
    for (const [element, value, priority] of saved) {
      if (value) element.style.setProperty('visibility', value, priority);
      else element.style.removeProperty('visibility');
    }
  };
}

/** A big scrolling box inside the page (a page that scrolls in a panel, not the window). */
function hasInnerScroller() {
  const area = document.documentElement.clientWidth * document.documentElement.clientHeight;
  for (const element of document.querySelectorAll('body *')) {
    if (element.scrollHeight <= element.clientHeight + 40 || element.clientHeight === 0) continue;
    if (element.clientWidth * element.clientHeight < area * 0.4) continue;
    const overflow = getComputedStyle(element).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return true;
  }
  return false;
}

/**
 * @param {{ cancelled: boolean, cancel: () => void }} job
 * @param {(progress: { current: number, total: number }) => void} [onProgress]
 */
export async function captureFullPage(job, onProgress = () => {}) {
  const root = document.documentElement;
  const origin = { x: window.scrollX, y: window.scrollY };
  const viewportHeight = root.clientHeight;
  const totalHeight = Math.max(root.scrollHeight, document.body?.scrollHeight || 0);
  const plan = planSlices({ totalHeight, viewportHeight });
  const total = plan.positions.length;

  const releaseShield = createShield(job);
  let restoreFloating = () => {};
  let canvas = null;
  let ctx = null;
  let scale = 1;
  let ratio = 1;
  let covered = 0; // CSS px of the page already in the picture (from the top)
  try {
    for (let index = 0; index < total; index += 1) {
      throwIfCancelled(job);
      onProgress({ current: index + 1, total });
      window.scrollTo({ left: origin.x, top: plan.positions[index], behavior: 'instant' });
      await nextPaint(index === 0 ? 0 : 120); // lets lazy images and scroll effects settle
      throwIfCancelled(job);
      const actualY = window.scrollY;

      const shot = await grabViewport(job);
      const { sx, sy, sw, sh } = pageRegion(shot);
      if (!canvas) {
        ratio = shot.ratioY;
        scale = outputScale({ width: sw, height: plan.height * ratio });
        canvas = newCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(plan.height * ratio * scale)));
        ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        restoreFloating = hideFloatingElements(); // the first screen keeps them, as the visitor first sees it
      }

      // Only the part below what is already in the picture is new.
      const skip = Math.max(0, covered - actualY); // CSS px of this photo already covered
      const sourceTop = sy + Math.round(skip * shot.ratioY);
      const sourceHeight = sh - (sourceTop - sy);
      const destTop = Math.round(Math.max(covered, actualY) * ratio * scale);
      const sliceEnd = Math.min(plan.height, actualY + viewportHeight);
      const destBottom = Math.min(canvas.height, Math.round(sliceEnd * ratio * scale));
      if (sourceHeight > 0 && destBottom > destTop) {
        ctx.drawImage(shot.bitmap, sx, sourceTop, sw, sourceHeight, 0, destTop, canvas.width, destBottom - destTop);
      }
      shot.bitmap.close?.();
      covered = Math.max(covered, sliceEnd);
    }
  } finally {
    restoreFloating();
    releaseShield();
    window.scrollTo({ left: origin.x, top: origin.y, behavior: 'instant' });
  }

  const notes = [];
  if (plan.truncated) notes.push('This page is very long, so the picture stops at 24,000 px.'); // = MAX_PAGE_HEIGHT
  if (scale < 1) notes.push('The picture was reduced in size because the page is very large.');
  if (total === 1 && hasInnerScroller()) notes.push('This page scrolls inside a panel, so only the visible part was captured.');
  return { canvas, pixelRatio: ratio * scale, notes };
}
