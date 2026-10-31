/**
 * Page-side listener for the saved Select Area shortcut. One listener per
 * tab. The side panel is not opened; the service worker starts the same
 * area capture that the panel's Select Area button uses.
 */

import { MSG, STORAGE_KEYS } from '../shared/constants.js';
import { sendToBackground } from '../services/message-service.js';
import { isTypingTarget, matchesCombo, sanitizeCombo } from '../services/screenshot-hotkey.js';

const OVERLAY_IDS = ['wit-screenshot-selector', 'wit-screenshot-editor'];

const SETTINGS_KEY = STORAGE_KEYS.SETTINGS;

let combo = null;
let starting = false;
let watching = false;

function readStored(raw) {
  combo = sanitizeCombo(raw && raw[SETTINGS_KEY] && raw[SETTINGS_KEY].screenshot && raw[SETTINGS_KEY].screenshot.shortcut);
}

function overlayOpen() {
  return OVERLAY_IDS.some((id) => document.getElementById(id));
}

function onKeyDown(event) {
  if (!combo || starting || overlayOpen() || isTypingTarget(event.target)) return;
  if (!matchesCombo(event, combo)) return;
  event.preventDefault();
  event.stopPropagation();
  starting = true;
  sendToBackground(MSG.SCREENSHOT_HOTKEY, {}, { timeoutMs: 10000 })
    .catch(() => {})
    .finally(() => {
      starting = false;
    });
}

export function initHotkey() {
  if (watching) return;
  watching = true;
  chrome.storage.local.get(SETTINGS_KEY, readStored);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    readStored({ [SETTINGS_KEY]: changes[SETTINGS_KEY].newValue });
  });
  document.addEventListener('keydown', onKeyDown, true);
}
