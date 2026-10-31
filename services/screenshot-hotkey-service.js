/**
 * Install or remove the Select Area shortcut listener on websites.
 * The listener is a content script: Chrome commands cannot record a key in
 * our panel and then bind it. Registration needs the same `<all_urls>` grant
 * as photographing a tab.
 */

import { checkRestrictedUrl } from '../shared/validators.js';
import { sanitizeCombo } from './screenshot-hotkey.js';

export const SCREENSHOT_HOTKEY_SCRIPT_ID = 'wit-screenshot-hotkey';

const MATCHES = ['http://*/*', 'https://*/*'];

async function hasWebsiteAccess() {
  try {
    if (await chrome.permissions.contains({ origins: ['<all_urls>'] })) return true;
    return await chrome.permissions.contains({ origins: MATCHES });
  } catch {
    return false;
  }
}

async function registered() {
  try {
    return await chrome.scripting.getRegisteredContentScripts({ ids: [SCREENSHOT_HOTKEY_SCRIPT_ID] });
  } catch {
    return [];
  }
}

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: MATCHES }).catch(() => []);
  await Promise.all(
    tabs.map((tab) => {
      if (!Number.isInteger(tab?.id) || checkRestrictedUrl(tab.url || '').restricted) return undefined;
      return chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/screenshot-hotkey.js'] }).catch(() => {});
    }),
  );
}

/**
 * When `shortcut` is set and host access exists, keep the listener on http(s)
 * pages (including tabs that are already open). Otherwise remove it.
 */
export async function syncScreenshotHotkey(shortcut) {
  const combo = sanitizeCombo(shortcut);
  const allowed = combo && (await hasWebsiteAccess());
  const existing = await registered();

  if (!allowed) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCREENSHOT_HOTKEY_SCRIPT_ID] }).catch(() => {});
    return { registered: false };
  }

  const spec = {
    id: SCREENSHOT_HOTKEY_SCRIPT_ID,
    js: ['content/screenshot-hotkey.js'],
    matches: MATCHES,
    runAt: 'document_idle',
    persistAcrossSessions: true,
    allFrames: false,
  };
  if (existing.length) await chrome.scripting.updateContentScripts([spec]);
  else await chrome.scripting.registerContentScripts([spec]);
  await injectIntoOpenTabs();
  return { registered: true };
}
