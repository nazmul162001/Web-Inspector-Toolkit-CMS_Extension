/**
 * Fullscreen crop window for Select Area: shows a frozen picture of the whole
 * screen so the user can include DevTools, the side panel and anything else
 * that was visible, then opens the same editor used for page captures.
 */

import { MSG } from '../shared/constants.js';
import { broadcast, registerHandlers, sendToBackground } from '../services/message-service.js';
import { cropRegion } from '../services/screenshot-geometry.js';
import { selectArea } from '../content/screenshot-selector.js';
import { openEditor } from '../content/screenshot-editor.js';

const shotEl = document.getElementById('shot');
let editor = null;
let sourceTabId = null;
let finished = false;

function emit(event) {
  broadcast(MSG.SCREENSHOT_EVENT, { ...event, sourceTabId, surface: 'screen' });
}

function closeWindow() {
  chrome.windows.getCurrent((win) => {
    if (Number.isInteger(win?.id)) chrome.windows.remove(win.id).catch(() => {});
    else window.close();
  });
}

function finish(event) {
  if (finished) return;
  finished = true;
  emit(event);
  closeWindow();
}

function cropCanvas(bitmap, rect, viewW, viewH) {
  const { sx, sy, sw, sh } = cropRegion(rect, bitmap.width / viewW, bitmap.height / viewH, bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext('2d', { alpha: false }).drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

async function run() {
  const session = await sendToBackground(MSG.SCREENSHOT_AREA_SESSION, null, { timeoutMs: 20000 });
  sourceTabId = session.sourceTabId;
  const blob = new Blob([session.buffer], { type: session.mime || 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  shotEl.src = url;
  shotEl.style.display = 'block';
  await shotEl.decode().catch(() => {});

  emit({ state: 'selecting', phase: 'screen' });
  const selector = selectArea({ language: session.language });
  const choice = await selector.promise;
  URL.revokeObjectURL(url);
  if (!choice || finished) {
    bitmap.close?.();
    finish({ state: 'cancelled', reason: 'user' });
    return;
  }

  emit({ state: 'capturing', mode: 'area' });
  const canvas = cropCanvas(bitmap, choice, window.innerWidth, window.innerHeight);
  bitmap.close?.();
  shotEl.remove();

  editor = openEditor({
    canvas,
    pixelRatio: canvas.width / Math.max(1, choice.w),
    mode: 'area',
    rect: choice,
    language: session.language,
    pageUrl: session.pageUrl || '',
    onClose: () => finish({ state: 'done' }),
  });
  emit({ state: 'editing', width: canvas.width, height: canvas.height });
  if (choice.tool) editor.setTool(choice.tool);
  if (choice.action === 'copy') editor.copy();
  if (choice.action === 'save') editor.save();
}

registerHandlers({
  [MSG.CONTENT_SCREENSHOT]: async ({ action } = {}) => {
    if (action === 'cancel') {
      editor?.close();
      finish({ state: 'cancelled', reason: 'panel' });
      return { cancelled: true };
    }
    if (!editor || editor.isClosed) return { ok: false };
    if (action === 'copy') {
      await editor.copy();
      return { ok: true };
    }
    if (action === 'save') {
      await editor.save();
      return { ok: true };
    }
    return { ok: false };
  },
});

window.addEventListener(
  'keydown',
  (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const letter = (event.code || '').startsWith('Key') ? event.code.slice(3).toLowerCase() : (event.key || '').toLowerCase();
    if (letter !== 's' && letter !== 'c') return;
    event.preventDefault();
  },
  true,
);

run().catch((error) => {
  finish({
    state: error?.code === 'CANCELLED' ? 'cancelled' : 'error',
    reason: 'user',
    code: error?.code || 'UNKNOWN',
    message: error?.message || 'The screenshot could not be taken.',
  });
});
