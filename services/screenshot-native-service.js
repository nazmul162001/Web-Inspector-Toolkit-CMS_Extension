/**
 * Select Area on the whole display via the macOS native helper
 * (ScreenCaptureKit). Chrome cannot draw over DevTools, the Dock or other
 * apps; the helper can. Copy and Save run in the helper. Enter sends the
 * crop back so the existing editor can open.
 */

import { ERR } from '../shared/constants.js';
import { createError } from '../shared/helpers.js';

export const NATIVE_HOST = 'com.webinspectortoolkit.screenshot';

let activePort = null;

function hostMissingMessage() {
  return 'Select Area needs a one-time macOS helper. In Terminal run native/screenshot-helper/install.sh, reload this extension, then allow Screen Recording for “Web Inspector Screenshot” in System Settings → Privacy & Security.';
}

function mapDisconnectError(text) {
  if (/native messaging host not found|specified native messaging host/i.test(text)) {
    return createError(ERR.NATIVE_HOST, hostMissingMessage());
  }
  if (/forbidden|not allowed|allowed_origins/i.test(text)) {
    return createError(ERR.NATIVE_HOST, hostMissingMessage());
  }
  if (/access denied|not authorized|screen recording/i.test(text)) {
    return createError(
      ERR.CAPTURE_FAILED,
      'Allow Screen Recording for Web Inspector Screenshot in System Settings → Privacy & Security → Screen Recording, then try again.',
    );
  }
  return createError(ERR.CAPTURE_FAILED, text || 'Chrome could not capture the screen.');
}

/**
 * Show the full-display overlay. Resolves with { action: 'copy'|'save'|'edit'|'cancel', png? }.
 */
export function startNativeAreaCapture({ language = 'en', pageUrl = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.connectNative) {
      reject(createError(ERR.NATIVE_HOST, hostMissingMessage()));
      return;
    }
    if (activePort) {
      try {
        activePort.postMessage({ type: 'cancel' });
        activePort.disconnect();
      } catch {
        /* already gone */
      }
      activePort = null;
    }

    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (error) {
      reject(mapDisconnectError(String(error?.message || error)));
      return;
    }
    activePort = port;
    let settled = false;

    const done = (fn) => {
      if (settled) return;
      settled = true;
      if (activePort === port) activePort = null;
      try {
        port.disconnect();
      } catch {
        /* closed */
      }
      fn();
    };

    port.onMessage.addListener((message) => {
      if (!message || typeof message !== 'object') return;
      if (message.ok === false) {
        done(() => reject(createError(message.code || ERR.CAPTURE_FAILED, message.message || 'Chrome could not capture the screen.')));
        return;
      }
      const action = message.action || 'cancel';
      done(() => resolve({ action, png: typeof message.png === 'string' ? message.png : '' }));
    });

    port.onDisconnect.addListener(() => {
      const text = chrome.runtime.lastError?.message || '';
      if (settled) return;
      if (text) done(() => reject(mapDisconnectError(text)));
      else done(() => resolve({ action: 'cancel', png: '' }));
    });

    try {
      port.postMessage({ type: 'capture', language, pageUrl });
    } catch (error) {
      done(() => reject(mapDisconnectError(String(error?.message || error))));
    }
  });
}

export function cancelNativeAreaCapture() {
  if (!activePort) return false;
  try {
    activePort.postMessage({ type: 'cancel' });
  } catch {
    /* ignore */
  }
  try {
    activePort.disconnect();
  } catch {
    /* ignore */
  }
  activePort = null;
  return true;
}
