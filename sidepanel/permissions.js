/**
 * Host-access negotiation for the side panel.
 *
 * Why this exists: the toolbar click grants `activeTab`, but that grant is
 * temporary (tab/navigation scoped) and cannot be relied on for later panel
 * actions, nor does it cover the background tabs used by Entire Site. So:
 *
 *   1. If the extension already holds host permission for the site -> go.
 *   2. This Page only: if `activeTab` currently lets us run code -> go.
 *   3. Otherwise ask the user (once) for access to THIS site's origin only,
 *      via chrome.permissions.request, which must run inside a user gesture
 *      (the Find / Grant button click).
 */

import { ERR, MSG, SCOPE } from '../shared/constants.js';
import { createError } from '../shared/helpers.js';
import { sendToBackground } from '../services/message-service.js';

/**
 * @param {object} tabContext result of MSG.GET_TAB_CONTEXT
 * @param {string} scope SCOPE.PAGE | SCOPE.SITE
 * @returns {Promise<'host'|'activeTab'>}
 */
export async function ensureAccess(tabContext, scope) {
  if (!tabContext?.tab) throw createError(ERR.NO_TAB, 'No active tab was found.');
  if (tabContext.restricted) throw createError(ERR.RESTRICTED_PAGE, tabContext.restrictionReason);

  if (tabContext.fileUrl) {
    if (scope === SCOPE.SITE) {
      throw createError(ERR.RESTRICTED_PAGE, 'Entire Site scanning supports http(s) websites, not local files.');
    }
    const probe = await sendToBackground(MSG.CHECK_ACCESS, { tabId: tabContext.tab.id });
    if (probe.ok) return 'activeTab';
    throw createError(
      ERR.FILE_ACCESS,
      'To inspect local files, enable "Allow access to file URLs" for this extension on chrome://extensions.',
    );
  }

  const pattern = tabContext.originPattern;
  if (await chrome.permissions.contains({ origins: [pattern] })) return 'host';

  if (scope === SCOPE.PAGE) {
    const probe = await sendToBackground(MSG.CHECK_ACCESS, { tabId: tabContext.tab.id });
    if (probe.ok) return 'activeTab';
  }

  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    throw createError(
      ERR.PERMISSION_DENIED,
      `Access to ${tabContext.origin} was not granted, so the page cannot be inspected.`,
      { origin: tabContext.origin },
    );
  }
  return 'host';
}

/**
 * Chrome will only photograph a tab if the extension has `<all_urls>`, or if
 * the user just clicked the toolbar icon (`activeTab`). Access to this one
 * origin (enough for Find) is not enough. Asked from a click; nothing is uploaded.
 */
const CAPTURE_ORIGINS = ['<all_urls>'];

export async function ensureCaptureAccess(tabContext) {
  if (!tabContext?.tab) throw createError(ERR.NO_TAB, 'No active tab was found.');
  if (tabContext.restricted) throw createError(ERR.RESTRICTED_PAGE, tabContext.restrictionReason);

  if (tabContext.fileUrl) return ensureAccess(tabContext, SCOPE.PAGE);

  if (await chrome.permissions.contains({ origins: CAPTURE_ORIGINS })) return 'allHosts';

  const granted = await chrome.permissions.request({ origins: CAPTURE_ORIGINS });
  if (granted) return 'allHosts';

  // They refused the broader permission. Photographing can still work if they
  // opened the panel from the toolbar (activeTab) or already allowed this site.
  const probe = await sendToBackground(MSG.CHECK_ACCESS, { tabId: tabContext.tab.id });
  if (probe.ok) return 'activeTab';
  throw createError(ERR.PERMISSION_DENIED, 'Chrome needs permission to photograph the tab. Nothing is uploaded.', {
    origin: tabContext.origin,
  });
}

/** The Select Area shortcut listens on every website, so it needs `<all_urls>`. */
export async function ensureAllHostsAccess() {
  if (await chrome.permissions.contains({ origins: CAPTURE_ORIGINS })) return 'allHosts';
  const granted = await chrome.permissions.request({ origins: CAPTURE_ORIGINS });
  if (!granted) {
    throw createError(ERR.PERMISSION_DENIED, 'Allow access to websites first, then save the shortcut again.');
  }
  return 'allHosts';
}

/** Ask for access to one origin (used when a highlight action is denied). */
export async function requestOrigin(url) {
  try {
    const { origin } = new URL(url);
    return await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}
