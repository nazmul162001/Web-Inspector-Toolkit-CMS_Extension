/**
 * Controller shared by the "find something in the page text" tools (Text Find,
 * Telephone Number): validates input, negotiates access, starts This Page /
 * Entire Site searches through the service worker, shows progress and results,
 * and performs result actions (copy, highlight, scroll).
 *
 * A tool only supplies a config (see text-find.js / telephone.js):
 *   id, prefix        feature id and the prefix of its element ids (`${prefix}-form`, ...)
 *   htmlUrl, styleUrls
 *   settingsKey       key under which its options are saved
 *   buildQuery(text, options) -> { ok, query } | { ok: false, error }
 *   createResults(root, handlers) -> results view
 *   copyValue(match) / copyLabel   what "Copy" puts on the clipboard
 *   siteNotice        sentence appended to the Entire Site explanation
 *   words             { busy, page, siteStart, site(done, total), searched, cancelled, found }
 *
 * The markup needs `${prefix}-` ids: form, text, error, find, cancel, status, results,
 * site-panel, site-notice, plus any checkboxes or <select>s marked with data-opt="optionName".
 * Optional: `${prefix}-preview` (a line under the input) filled by config.preview(text, options) -> string | null.
 * Optional hooks: config.onOptionsChanged({ container, options }), config.onMount({ container, refs, ctx, update }),
 * config.onUnmount({ ctx }), config.locateExtras(query) -> object merged into highlight requests.
 * A tool without a text field can use a hidden input for `${prefix}-text`.
 */

import { ERR, MSG, SCOPE } from '../../shared/constants.js';
import { copyToClipboard, el, pluralize, uid } from '../../shared/helpers.js';
import { onEvent, sendToBackground } from '../../services/message-service.js';
import { loadSettings, saveSettings } from '../../services/settings-service.js';
import { createSpinner } from '../components/loading.js';
import { ensureAccess, requestOrigin } from '../permissions.js';
import { createStatus, createStreamer, describeError } from './scan-ui.js';

async function ensureStyles(urls) {
  await Promise.all(
    urls.map((href) => {
      if (document.querySelector(`link[href="${href}"]`)) return null;
      return new Promise((resolve) => {
        const link = el('link', { rel: 'stylesheet', href });
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
        document.head.append(link);
      });
    }),
  );
}

export function createSearchFeature(ctx, config) {
  let refs = null;
  let results = null;
  let status = null;
  let streamer = null;
  let busy = false;
  let currentScanId = null;
  let lastScan = null;
  let lastQuery = null;
  const disposers = [];

  /* ------------------------------------------------------------- Helpers */

  function setBusy(value) {
    busy = value;
    refs.find.disabled = value;
    refs.find.replaceChildren(...(value ? [createSpinner(), config.words.busy] : ['Find']));
    refs.cancel.hidden = !value;
    refs.cancel.disabled = false;
    refs.text.disabled = value;
    for (const box of Object.values(refs.options)) box.disabled = value;
  }

  function readOptions() {
    return Object.fromEntries(Object.entries(refs.options).map(([name, box]) => [name, box.type === 'checkbox' ? box.checked : box.value]));
  }

  function updatePreview() {
    config.onOptionsChanged?.({ container: refs.container, options: readOptions() });
    if (!refs.preview || !config.preview) return;
    const line = refs.text.value.trim() || config.alwaysPreview ? config.preview(refs.text.value, readOptions()) : null;
    refs.preview.textContent = line || '';
    refs.preview.hidden = !line;
  }

  /** @returns {{ ok: true, query: object } | { ok: false, error: string }} */
  function readQuery() {
    return config.buildQuery(refs.text.value, readOptions());
  }

  function showInputError(message) {
    refs.error.hidden = !message;
    refs.error.textContent = message || '';
    refs.text.setAttribute('aria-invalid', String(!!message));
  }

  function renderSiteNotice() {
    const tabContext = ctx.getTabContext();
    const box = refs.siteNotice;
    if (!tabContext?.origin) {
      box.textContent = 'Open a website in the active tab to search its pages.';
      return;
    }
    box.replaceChildren(
      el('strong', {}, tabContext.hasHostAccess ? `Access to ${tabContext.origin} is granted. ` : `Permission needed for ${tabContext.origin}. `),
      tabContext.hasHostAccess
        ? ''
        : 'Chrome will ask once when you click Find. Only this website is requested, and nothing leaves your device. ',
      `Every internal page is searched invisibly in the background - no tabs or windows are opened. Results appear as pages finish. ${config.siteNotice}`,
    );
  }

  function applyScope() {
    const site = ctx.getScope() === SCOPE.SITE;
    refs.sitePanel.hidden = !site;
    if (site) renderSiteNotice();
  }

  /* ---------------------------------------------------------------- Scan */

  function handleProgress(progress) {
    if (!busy || progress.scanId !== currentScanId) return;
    if (progress.phase === 'page') {
      status.update({
        title: config.words.page,
        fraction: progress.total ? progress.scanned / progress.total : null,
        stats: `${progress.scanned.toLocaleString()} of ${progress.total.toLocaleString()} elements · ${pluralize(progress.matches, 'match', 'matches')}`,
      });
      return;
    }
    const done = progress.scanned + progress.failed;
    const total = Math.max(1, progress.discovered);
    streamer.setDiscovered(progress.discovered);
    status.update({
      title: config.words.site(done, total),
      fraction: Math.min(1, done / total),
      stats: `${progress.scanned} ${config.words.searched} · ${progress.failed} failed · ${progress.queued} waiting · ${pluralize(progress.matches, 'match', 'matches')}`,
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

    const parsed = readQuery();
    if (!parsed.ok) {
      showInputError(parsed.error);
      refs.text.focus();
      return;
    }
    const { query } = parsed;
    lastQuery = query;
    showInputError('');

    const scope = ctx.getScope();
    let tabContext;
    try {
      tabContext = await ctx.refreshTabContext();
      await ensureAccess(tabContext, scope);
      tabContext = await ctx.refreshTabContext();
    } catch (error) {
      showFailure(error, find);
      return;
    }

    saveSettings({ [config.settingsKey]: { query: refs.text.value.trim(), ...readOptions() } }); // fire and forget - preferences are best effort

    const scanId = uid('scan');
    currentScanId = scanId;
    streamer.reset();
    setBusy(true);
    results.showIdle();
    status.show(scope === SCOPE.SITE ? config.words.siteStart : config.words.page);

    try {
      const response = await sendToBackground(
        scope === SCOPE.SITE ? MSG.SCAN_SITE : MSG.SCAN_PAGE,
        { scanId, sessionId: ctx.sessionId, tabId: tabContext.tab.id, target: query, options: {} },
        { timeoutMs: 0 },
      );
      if (scanId !== currentScanId) return;

      lastScan = response;
      const streamed = streamer.active;
      streamer.reset();
      status.clear();
      const outcome = results.show(response, { query, keepView: streamed });
      if (response.coverage?.cancelled) ctx.notify.info(`${config.words.cancelled} Showing partial results.`);
      else if (!outcome.empty) {
        ctx.notify.success(`Found ${pluralize(response.pages.reduce((n, p) => n + p.matches.length, 0), 'match', 'matches')}.`);
      }
    } catch (error) {
      if (scanId !== currentScanId) return;
      streamer.reset();
      if (error?.code === ERR.CANCELLED) {
        status.message(config.words.cancelled);
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
    if (await copyToClipboard(text)) ctx.notify.success(`${label} copied`);
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
      ...(config.locateExtras && lastQuery ? config.locateExtras(lastQuery) : {}),
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
        case 'copy-text':
          return await copy(config.copyValue(item.match), config.copyNoun);
        case 'copy-selector':
          return await copy(item.element.selector, 'Selector');
        case 'copy-classes':
          return await copy(item.element.classes.join(' '), 'Class names');
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
    id: config.id,

    async mount(container) {
      const [html] = await Promise.all([fetch(config.htmlUrl).then((r) => r.text()), ensureStyles(config.styleUrls)]);
      container.innerHTML = html; // packaged, trusted markup
      const $ = (name) => container.querySelector(`#${config.prefix}-${name}`);

      refs = {
        container,
        form: $('form'),
        text: $('text'),
        error: $('error'),
        sitePanel: $('site-panel'),
        siteNotice: $('site-notice'),
        find: $('find'),
        cancel: $('cancel'),
        status: $('status'),
        results: $('results'),
        preview: $('preview'),
        options: Object.fromEntries(
          Array.from(container.querySelectorAll('input[type="checkbox"][data-opt], select[data-opt]'), (box) => [box.dataset.opt, box]),
        ),
      };

      const saved = (await loadSettings())[config.settingsKey];
      refs.text.value = ''; // always start with an empty field
      for (const [name, box] of Object.entries(refs.options)) {
        if (box.type === 'checkbox') box.checked = !!saved[name];
        else if (typeof saved[name] === 'string') box.value = saved[name];
      }

      status = createStatus(refs.status);
      results = config.createResults(refs.results, {
        onAction: handleAction,
        groupMode: saved.groupMode,
        onGroupModeChange: (groupMode) => saveSettings({ [config.settingsKey]: { groupMode } }),
      });
      streamer = createStreamer({ results, isBusy: () => busy, getOrigin: () => ctx.getTabContext()?.origin });

      refs.form.addEventListener('submit', (event) => {
        event.preventDefault();
        find();
      });
      refs.text.addEventListener('input', () => {
        showInputError('');
        updatePreview();
      });
      for (const box of Object.values(refs.options)) box.addEventListener('change', updatePreview);
      updatePreview();
      refs.cancel.addEventListener('click', cancel);

      disposers.push(onEvent(MSG.SCAN_PROGRESS, handleProgress));
      disposers.push(onEvent(MSG.SCAN_PAGE_RESULT, handlePageResult));
      config.onMount?.({ container, refs, ctx, update: updatePreview });
      applyScope();
      refs.text.focus();
    },

    unmount() {
      if (currentScanId) cancel();
      streamer?.reset();
      config.onUnmount?.({ ctx });
      disposers.splice(0).forEach((dispose) => dispose());
    },

    onScopeChange: () => applyScope(),
    onTabContextChange: () => {
      if (refs && ctx.getScope() === SCOPE.SITE) renderSiteNotice();
    },
  };
}
