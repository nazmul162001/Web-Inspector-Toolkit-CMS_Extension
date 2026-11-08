/**
 * Entire Site: when a page answers HTTP 401, show the password dialog and
 * send the details back so the crawl can continue.
 */

import { MSG } from '../../shared/constants.js';
import { promptSitePassword } from '../components/auth-dialog.js';

export function bindScanAuth({ getScanId, isBusy, onEvent, sendToBackground, onPrompt }) {
  return onEvent(MSG.SCAN_AUTH_REQUIRED, async (payload) => {
    if (!isBusy() || payload?.scanId !== getScanId()) return;
    onPrompt?.(payload);
    const creds = await promptSitePassword(payload);
    try {
      await sendToBackground(MSG.SCAN_AUTH_PROVIDE, {
        scanId: payload.scanId,
        cancelled: !creds,
        username: creds?.username || '',
        password: creds?.password || '',
      });
    } catch {
      /* the scan may already have finished */
    }
  });
}
