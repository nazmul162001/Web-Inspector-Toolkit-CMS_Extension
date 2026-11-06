/**
 * Editor page for a crop taken by the macOS helper. The picture is not on a
 * website: this extension page hosts the same editor as page captures.
 */

import { MSG } from '../shared/constants.js';
import { sendToBackground } from '../services/message-service.js';
import { openEditor } from '../content/screenshot-editor.js';

function closeWindow() {
  chrome.windows.getCurrent((win) => {
    if (Number.isInteger(win?.id)) chrome.windows.remove(win.id).catch(() => {});
    else window.close();
  });
}

async function pngToCanvas(pngBase64) {
  const binary = atob(pngBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

const shotId = new URLSearchParams(location.search).get('id') || '';

sendToBackground(MSG.SCREENSHOT_SHOT, { shotId }, { timeoutMs: 8000 })
  .then(async (session) => {
    if (!session?.png) {
      closeWindow();
      return;
    }
    const canvas = await pngToCanvas(session.png);
    openEditor({
      canvas,
      pixelRatio: 1,
      mode: 'fit',
      language: session.language,
      pageUrl: session.pageUrl || '',
      onClose: closeWindow,
    });
  })
  .catch(() => closeWindow());
