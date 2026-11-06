/**
 * Turn a desktopCapture stream into one PNG of the whole screen.
 * Runs in a document that can call getUserMedia (the hidden offscreen page).
 */

import { ERR } from '../shared/constants.js';
import { createError } from '../shared/helpers.js';

function waitVideoFrame(video) {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => resolve());
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function canvasToPayload(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(createError(ERR.CAPTURE_FAILED, 'Chrome could not capture the screen.'));
        return;
      }
      blob
        .arrayBuffer()
        .then((buffer) => resolve({ buffer, mime: blob.type || 'image/png', width: canvas.width, height: canvas.height }))
        .catch(reject);
    }, 'image/png');
  });
}

/**
 * Photograph the screen chosen in Chrome's share picker, then stop sharing.
 * @param {string} streamId from chrome.desktopCapture.chooseDesktopMedia
 */
export async function grabScreenPayload(streamId) {
  if (!streamId) throw createError(ERR.CANCELLED, 'Screen capture was cancelled.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: streamId,
        maxWidth: 16384,
        maxHeight: 16384,
      },
    },
  });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
    await waitVideoFrame(video);
    await waitVideoFrame(video);
    if (!(video.videoWidth > 0 && video.videoHeight > 0)) {
      throw createError(ERR.CAPTURE_FAILED, 'Chrome could not capture the screen.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0);
    return await canvasToPayload(canvas);
  } catch (error) {
    if (error?.code) throw error;
    throw createError(ERR.CAPTURE_FAILED, 'Chrome could not capture the screen.', { cause: String(error?.message || error) });
  } finally {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  }
}
