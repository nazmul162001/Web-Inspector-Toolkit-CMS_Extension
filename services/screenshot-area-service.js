/**
 * Select Area on the whole screen (page, DevTools, this side panel, anything
 * that is visible). Chrome's share picker chooses a screen; one frame is
 * grabbed in the hidden offscreen document; a fullscreen picker then lets the
 * user crop that frozen picture.
 */

import { ERR, MSG } from '../shared/constants.js';
import { createError } from '../shared/helpers.js';
import { broadcast, sendToOffscreen, sendToTab } from './message-service.js';
import { ensureOffscreen } from './offscreen-scanner.js';
import { normalizeLanguage } from './i18n.js';

const PICKER_PAGE = 'screenshot/area-picker.html';

/** pickerTabId -> session */
const byPickerTab = new Map();
/** source website tabId -> pickerTabId */
const pickerBySource = new Map();
/** picker windowId -> pickerTabId */
const pickerByWindow = new Map();
/** chrome.desktopCapture.chooseDesktopMedia request id, or null */
let chooseRequestId = null;

function emit(sourceTabId, event) {
  broadcast(MSG.SCREENSHOT_EVENT, { ...event, sourceTabId, surface: 'screen' });
}

function pickDesktopStream(tab) {
  return new Promise((resolve, reject) => {
    if (!chrome.desktopCapture?.chooseDesktopMedia) {
      reject(createError(ERR.CAPTURE_FAILED, 'Chrome could not capture the screen.'));
      return;
    }
    const target = tab && Number.isInteger(tab.id) ? tab : undefined;
    const onPick = (streamId) => {
      chooseRequestId = null;
      if (!streamId) reject(createError(ERR.CANCELLED, 'Screen capture was cancelled.'));
      else resolve(streamId);
    };
    chooseRequestId = target
      ? chrome.desktopCapture.chooseDesktopMedia(['screen'], target, onPick)
      : chrome.desktopCapture.chooseDesktopMedia(['screen'], onPick);
  });
}

function cancelScreenPick() {
  if (chooseRequestId == null || !chrome.desktopCapture?.cancelChooseDesktopMedia) return;
  chrome.desktopCapture.cancelChooseDesktopMedia(chooseRequestId);
  chooseRequestId = null;
}

async function openPickerWindow() {
  const url = chrome.runtime.getURL(PICKER_PAGE);
  let win;
  try {
    win = await chrome.windows.create({ url, type: 'popup', state: 'fullscreen', focused: true });
  } catch {
    win = await chrome.windows.create({ url, type: 'popup', focused: true, left: 0, top: 0, width: 1200, height: 800 });
  }
  const tab = win?.tabs?.[0];
  if (!Number.isInteger(win?.id) || !Number.isInteger(tab?.id)) {
    if (Number.isInteger(win?.id)) chrome.windows.remove(win.id).catch(() => {});
    throw createError(ERR.CAPTURE_FAILED, 'Chrome could not capture the screen.');
  }
  return { windowId: win.id, pickerTabId: tab.id };
}

function forgetPicker(pickerTabId, { closeWindow = false } = {}) {
  const session = byPickerTab.get(pickerTabId);
  if (!session) return null;
  byPickerTab.delete(pickerTabId);
  if (session.sourceTabId !== undefined) pickerBySource.delete(session.sourceTabId);
  if (session.windowId !== undefined) pickerByWindow.delete(session.windowId);
  if (closeWindow && Number.isInteger(session.windowId)) chrome.windows.remove(session.windowId).catch(() => {});
  return session;
}

/**
 * Share-picker -> freeze frame -> fullscreen crop window.
 * Resolves as soon as the crop window is open (or throws if the user cancels).
 */
export async function startScreenAreaCapture({ tabId, tab, language, pageUrl = '', sessionId } = {}) {
  emit(tabId, { state: 'selecting', phase: 'screen' });
  const streamId = await pickDesktopStream(tab || (Number.isInteger(tabId) ? { id: tabId } : undefined));
  emit(tabId, { state: 'capturing', mode: 'area' });
  await ensureOffscreen();
  const shot = await sendToOffscreen(MSG.OFFSCREEN_GRAB_SCREEN, { streamId }, { timeoutMs: 30000 });
  if (!shot?.buffer || !(shot.width > 0)) throw createError(ERR.CAPTURE_FAILED, 'Chrome could not capture the screen.');

  const previous = Number.isInteger(tabId) ? pickerBySource.get(tabId) : undefined;
  if (previous !== undefined) forgetPicker(previous, { closeWindow: true });

  const { windowId, pickerTabId } = await openPickerWindow();
  const session = {
    sourceTabId: tabId,
    sessionId,
    language: normalizeLanguage(language),
    pageUrl,
    windowId,
    pickerTabId,
    buffer: shot.buffer,
    mime: shot.mime || 'image/png',
    width: shot.width,
    height: shot.height,
  };
  byPickerTab.set(pickerTabId, session);
  pickerByWindow.set(windowId, pickerTabId);
  if (Number.isInteger(tabId)) pickerBySource.set(tabId, pickerTabId);
  return { started: true, mode: 'area', pickerTabId };
}

/** The crop window asks for the frozen picture once it has loaded. */
export function takeAreaSession(_payload, { sender } = {}) {
  const pickerTabId = sender?.tab?.id;
  const session = byPickerTab.get(pickerTabId);
  if (!session) throw createError(ERR.INVALID_REQUEST, 'No screenshot was requested for this tab.');
  const { buffer, mime, width, height, language, pageUrl, sourceTabId } = session;
  session.buffer = null; // one-shot: the picture lives in the picker from here
  return { buffer, mime, width, height, language, pageUrl, sourceTabId };
}

export function pickerTabForSource(tabId) {
  return pickerBySource.get(tabId);
}

export async function commandAreaPicker(tabId, action) {
  const pickerTabId = pickerBySource.get(tabId);
  if (!Number.isInteger(pickerTabId)) return null;
  return sendToTab(pickerTabId, MSG.CONTENT_SCREENSHOT, { action }, { timeoutMs: action === 'copy' || action === 'save' ? 20000 : 5000 });
}

export async function closeAreaPicker(tabId, { force = true } = {}) {
  cancelScreenPick();
  const pickerTabId = pickerBySource.get(tabId);
  if (!Number.isInteger(pickerTabId)) return { cancelled: false };
  const session = byPickerTab.get(pickerTabId);
  if (session?.editing && !force) return { cancelled: false, editing: true };
  forgetPicker(pickerTabId, { closeWindow: true });
  return { cancelled: true };
}

export function handlePickerWindowRemoved(windowId) {
  const pickerTabId = pickerByWindow.get(windowId);
  if (pickerTabId === undefined) return;
  const session = forgetPicker(pickerTabId);
  if (session) emit(session.sourceTabId, { state: 'cancelled', reason: 'window' });
}

export function handlePickerTabRemoved(tabId) {
  const session = byPickerTab.get(tabId);
  if (!session) return;
  forgetPicker(tabId);
  emit(session.sourceTabId, { state: 'cancelled', reason: 'window' });
}

/** Picker finished on its own: drop the session so closing the window is not a second cancel. */
export function noteAreaEvent(event, sender) {
  const pickerTabId = sender?.tab?.id;
  const session = Number.isInteger(pickerTabId) ? byPickerTab.get(pickerTabId) : null;
  if (event?.state === 'editing' && session) session.editing = true;
  if (!['done', 'cancelled', 'error'].includes(event?.state)) return;
  if (session) forgetPicker(pickerTabId);
}
