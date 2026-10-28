/**
 * Color Find controller: validates input, negotiates access, starts This Page /
 * Entire Site scans through the service worker, shows progress and results,
 * and performs result actions (copy, highlight, scroll).
 */

import { ERR, MATCH_MODE, MSG, NEAR_TOLERANCE, SCOPE } from '../../../shared/constants.js';
import { copyToClipboard, el, pluralize, uid } from '../../../shared/helpers.js';
import { onEvent, sendToBackground } from '../../../services/message-service.js';
import { loadSettings, saveSettings } from '../../../services/settings-service.js';
import { ensureAccess, requestOrigin } from '../../permissions.js';
import { createSpinner } from '../../components/loading.js';
import { createStatus, createStreamer, describeError } from '../scan-ui.js';
import { createColorInput } from './color-input.js';
import { createResults } from './color-results.js';

async function ensureStyles() {
  const href = new URL('./color-find.css', import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  await new Promise((resolve) => {
    const link = el('link', { rel: 'stylesheet', href });
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    document.head.append(link);
  });
}

export function createFeature(ctx) {
  let refs = null;
  let input = null;
  let results = null;
  let settings = null;
  let busy = false;
  let currentScanId = null;
  let lastScan = null;
  const disposers = [];

  let status = null; // progress block, created on mount
  let streamer = null; // live Entire Site results, created on mount

  /* ------------------------------------------------------------- Helpers */

  function setBusy(value) {
    busy = value;
    refs.find.disabled = value;
    refs.find.replaceChildren(...(value ? [createSpinner(), 'Scanning…'] : ['Find']));
    refs.cancel.hidden = !value;
    refs.cancel.disabled = false;
    input.setDisabled(value);
    refs.matchMode.disabled = value;
    refs.inherited.disabled = value;
  }

  function renderSiteNotice() {
    const tabContext = ctx.getTabContext();
    const box = refs.siteNotice;
    if (!tabContext?.origin) {
      box.textContent = 'Open a website in the active tab to scan its pages.';
      return;
    }
    box.replaceChildren(
      el('strong', {}, tabContext.hasHostAccess ? `Access to ${tabContext.origin} is granted. ` : `Permission needed for ${tabContext.origin}. `),
      tabContext.hasHostAccess
        ? ''
        : 'Chrome will ask once when you click Find. Only this website is requested, and nothing leaves your device. ',
      'Every internal page is checked invisibly in the background - no tabs or windows are opened. Results appear as pages finish; other pages are read as HTML + CSS, so colors only scripts add are not included.',
    );
  }

  function applyScope() {
    const site = ctx.getScope() === SCOPE.SITE;
    refs.sitePanel.hidden = !site;
    if (site) renderSiteNotice();
  }

  /* ---------------------------------------------------------------- Scan */

  function handleProgress(progress) {
    if (!busy || progress.scanId !== currentScanId) return; // stale event from an older scan
    if (progress.phase === 'page') {
      const fraction = progress.total ? progress.scanned / progress.total : null;
      status.update({
        title: 'Scanning the rendered page…',
        fraction,
        stats: `${progress.scanned.toLocaleString()} of ${progress.total.toLocaleString()} elements · ${pluralize(progress.matches, 'match', 'matches')}`,
      });
      return;
    }
    const done = progress.scanned + progress.failed;
    const total = Math.max(1, progress.discovered);
    streamer.setDiscovered(progress.discovered);
    status.update({
      title: `Checking the site: ${done} of ${total} pages`,
      fraction: Math.min(1, done / total),
      stats: `${progress.scanned} checked · ${progress.failed} failed · ${progress.queued} waiting · ${pluralize(progress.matches, 'match', 'matches')}`,
    });
  }

  function handlePageResult({ scanId, page }) {
    if (!busy || scanId !== currentScanId) return;
    streamer.push(page);
  }

  function showFailure(error, retry) {
    const info = describeError(error);
    const actions = [];
    if (info.canGrant) {
      actions.push({
        label: 'Grant access',
        primary: true,
        onClick: async () => {
          const tabContext = await ctx.refreshTabContext();
          if (tabContext?.tab && (await requestOrigin(tabContext.tab.url))) retry();
        },
      });
    }
    actions.push({ label: 'Try again', onClick: retry });
    status.clear();
    results.showError(info.message, { actions });
  }

  async function find() {
    if (busy) return;

    const validation = input.validateNow();
    if (!validation.ok) {
      input.focus();
      return;
    }

    const scope = ctx.getScope();
    const matchMode = refs.matchMode.value;
    const options = {
      tolerance: matchMode === MATCH_MODE.NEAR ? NEAR_TOLERANCE : 0,
      includeInherited: refs.inherited.checked,
    };
    // Steps 1-4: validate, normalize (done above), identify the tab, make sure we may inspect it.
    // Access is negotiated first, while the click's user gesture is still valid.
    let tabContext;
    try {
      tabContext = await ctx.refreshTabContext();
      await ensureAccess(tabContext, scope);
      tabContext = await ctx.refreshTabContext();
    } catch (error) {
      showFailure(error, find);
      return;
    }

    saveSettings({
      color: refs.text.value.trim(),
      matchMode,
      includeInherited: options.includeInherited,
    }); // fire and forget - preferences are best effort

    const scanId = uid('scan');
    currentScanId = scanId;
    streamer.reset();
    setBusy(true);
    results.showIdle();
    status.show(scope === SCOPE.SITE ? 'Starting site scan…' : 'Scanning the rendered page…');

    try {
      const response = await sendToBackground(
        scope === SCOPE.SITE ? MSG.SCAN_SITE : MSG.SCAN_PAGE,
        {
          scanId,
          sessionId: ctx.sessionId,
          tabId: tabContext.tab.id,
          target: validation.color,
          options,
        },
        { timeoutMs: 0 }, // long jobs are bounded by cancellation, not a message timeout
      );
      if (scanId !== currentScanId) return; // a newer scan or a cancel superseded this one

      lastScan = response;
      const streamed = streamer.active;
      streamer.reset();
      status.clear();
      const outcome = results.show(response, { hex: validation.hex, keepView: streamed });
      if (response.coverage?.cancelled) ctx.notify.info('Scan cancelled - showing partial results.');
      else if (!outcome.empty) {
        ctx.notify.success(`Found ${pluralize(response.pages.reduce((n, p) => n + p.matches.length, 0), 'match', 'matches')}.`);
      }
    } catch (error) {
      if (scanId !== currentScanId) return;
      streamer.reset();
      if (error?.code === ERR.CANCELLED) {
        status.message('Scan cancelled.');
        results.showIdle();
      } else {
        showFailure(error, find);
      }
    } finally {
      if (scanId === currentScanId) {
        currentScanId = null;
        setBusy(false);
      }
    }
  }

  async function cancel() {
    if (!currentScanId) return;
    refs.cancel.disabled = true;
    status.update({ title: 'Cancelling…' });
    try {
      await sendToBackground(MSG.CANCEL_SCAN, { scanId: currentScanId });
    } catch {
      /* the scan may already have finished */
    }
  }

  /* ------------------------------------------------------------- Actions */

  async function copy(text, label) {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) ctx.notify.success(`${label} copied`);
    else ctx.notify.error('Could not copy to the clipboard.');
  }

  async function locate(item, mode) {
    const payload = {
      pageUrl: item.page.url,
      tabId: lastScan?.tabId,
      windowId: ctx.windowId,
      elementId: item.element.elementId,
      contextId: item.page.contextId,
      path: item.element.path,
      tag: item.element.tag,
      label: item.element.selector,
      mode,
    };
    try {
      return await sendToBackground(MSG.HIGHLIGHT, payload, { timeoutMs: 40000 });
    } catch (error) {
      if (error.code === ERR.PERMISSION_DENIED && (await requestOrigin(item.page.url))) {
        return sendToBackground(MSG.HIGHLIGHT, payload, { timeoutMs: 40000 });
      }
      throw error;
    }
  }

  async function handleAction(action, item) {
    try {
      switch (action) {
        case 'copy-hex':
          return await copy(item.match.color.hex, 'HEX');
        case 'copy-selector':
          return await copy(item.element.selector, 'Selector');
        case 'copy-classes':
          return await copy(item.element.classes.join(' '), 'Class names');
        case 'copy-stylesheet':
          return await copy(item.match.source?.stylesheetUrl, 'Stylesheet URL');
        case 'highlight':
        case 'scroll': {
          const outcome = await locate(item, action);
          if (outcome?.note) ctx.notify.info(outcome.note);
          return undefined;
        }
        default:
          return undefined;
      }
    } catch (error) {
      ctx.notify.error(describeError(error).message);
      return undefined;
    }
  }

  /* --------------------------------------------------------------- Mount */

  return {
    id: 'color-find',

    async mount(container) {
      const [html] = await Promise.all([
        fetch(new URL('./color-find.html', import.meta.url)).then((r) => r.text()),
        ensureStyles(),
      ]);
      container.innerHTML = html; // packaged, trusted markup
      const $ = (id) => container.querySelector(`#${id}`);

      refs = {
        form: $('cf-form'),
        text: $('cf-color-text'),
        picker: $('cf-color-picker'),
        preview: $('cf-color-preview'),
        pickerIcon: $('cf-picker-icon'),
        error: $('cf-color-error'),
        help: $('cf-color-help'),
        matchMode: $('cf-match-mode'),
        inherited: $('cf-inherited'),
        sitePanel: $('cf-site-panel'),
        siteNotice: $('cf-site-notice'),
        find: $('cf-find'),
        cancel: $('cf-cancel'),
        status: $('cf-status'),
        results: $('cf-results'),
      };

      settings = await loadSettings();
      refs.text.value = ''; // always start with an empty field
      refs.matchMode.value = settings.matchMode;
      refs.inherited.checked = settings.includeInherited;

      input = createColorInput({
        textInput: refs.text,
        picker: refs.picker,
        preview: refs.preview,
        errorEl: refs.error,
        helpEl: refs.help,
        pickerIcon: refs.pickerIcon,
        onSubmit: find,
      });

      status = createStatus(refs.status);
      results = createResults(refs.results, {
        onAction: handleAction,
        groupMode: settings.groupMode,
        onGroupModeChange: (groupMode) => saveSettings({ groupMode }),
      });

      streamer = createStreamer({ results, isBusy: () => busy, getOrigin: () => ctx.getTabContext()?.origin });

      refs.form.addEventListener('submit', (event) => {
        event.preventDefault();
        find();
      });
      refs.cancel.addEventListener('click', cancel);

      disposers.push(onEvent(MSG.SCAN_PROGRESS, handleProgress));
      disposers.push(onEvent(MSG.SCAN_PAGE_RESULT, handlePageResult));
      applyScope();
    },

    unmount() {
      if (currentScanId) cancel();
      disposers.splice(0).forEach((dispose) => dispose());
    },

    onScopeChange: () => applyScope(), // switching scope never starts a scan
    onTabContextChange: () => {
      if (refs && ctx.getScope() === SCOPE.SITE) renderSiteNotice();
    },
  };
}
