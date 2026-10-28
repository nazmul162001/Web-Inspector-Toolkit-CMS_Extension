/**
 * Color Find controller: validates input, negotiates access, starts This Page /
 * Entire Site scans through the service worker, shows progress and results,
 * and performs result actions (copy, highlight, scroll).
 */

import { CRAWL_MODE, ERR, MATCH_MODE, MSG, NEAR_TOLERANCE, SCOPE } from '../../../shared/constants.js';
import { copyToClipboard, el, pluralize, uid } from '../../../shared/helpers.js';
import { onEvent, sendToBackground } from '../../../services/message-service.js';
import { loadSettings, saveSettings } from '../../../services/settings-service.js';
import { displayPath } from '../../../services/url-normalizer.js';
import { ensureAccess, requestOrigin } from '../../permissions.js';
import { createProgressBar, createSpinner } from '../../components/loading.js';
import { createColorInput } from './color-input.js';
import { createResults } from './color-results.js';

const CRAWL_FIELDS = ['maxPages', 'concurrency', 'pageTimeoutMs', 'retries'];

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

/** Map a failure to a friendly message (and whether a Grant action fits). */
function describeError(error) {
  switch (error?.code) {
    case ERR.PERMISSION_DENIED:
      return { message: error.message, canGrant: true, origin: error.details?.origin };
    case ERR.RESTRICTED_PAGE:
    case ERR.FILE_ACCESS:
    case ERR.NO_TAB:
      return { message: error.message };
    case ERR.TIMEOUT:
      return { message: 'The page took too long to scan. Try again, or reload the page first.' };
    case ERR.NO_RECEIVER:
    case ERR.INJECTION_FAILED:
    case ERR.PORT_CLOSED:
      return { message: 'The scanner could not run in this page. Reload the page and try again.' };
    default:
      return { message: error?.message || 'Something went wrong.' };
  }
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

  /* ----------------------------------------------------------- Status UI */

  const status = {
    parts: null,
    show(label) {
      const bar = createProgressBar();
      const title = el('span', { class: 'status__title' }, label);
      const stats = el('div', { class: 'status__stats' });
      const active = el('ul', { class: 'status__active' });
      refs.status.replaceChildren(
        el('div', { class: 'status status--busy' }, el('div', { class: 'status__row' }, createSpinner(), title), bar.element, stats, active),
      );
      status.parts = { bar, title, stats, active };
    },
    update({ title, fraction, stats, active }) {
      if (!status.parts) return;
      if (title) status.parts.title.textContent = title;
      if (fraction !== undefined) status.parts.bar.set(fraction);
      if (stats !== undefined) status.parts.stats.textContent = stats;
      if (active) {
        status.parts.active.replaceChildren(...active.slice(0, 3).map((url) => el('li', {}, el('code', { title: url }, displayPath(url)))));
      }
    },
    message(text, tone = 'info') {
      status.parts = null;
      refs.status.replaceChildren(el('div', { class: `notice notice--${tone}` }, text));
    },
    clear() {
      status.parts = null;
      refs.status.replaceChildren();
    },
  };

  /* ------------------------------------------------------------- Helpers */

  function readCrawlOptions() {
    const crawl = { mode: refs.crawlMode.value };
    for (const key of CRAWL_FIELDS) {
      const value = Number(refs.crawl[key].value);
      if (Number.isFinite(value)) crawl[key] = key === 'pageTimeoutMs' ? value * 1000 : value;
    }
    return crawl;
  }

  function writeCrawlOptions(crawl) {
    refs.crawlMode.value = crawl.mode;
    for (const key of CRAWL_FIELDS) {
      refs.crawl[key].value = key === 'pageTimeoutMs' ? Math.round(crawl[key] / 1000) : crawl[key];
    }
  }

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
    const { maxPages, mode } = readCrawlOptions();
    const how =
      mode === CRAWL_MODE.TABS
        ? 'are opened one by one in short-lived background tabs (your active tab is never switched) and inspected as rendered, with their scripts running.'
        : 'are checked invisibly in the background - no tabs or windows are opened. They are read as HTML + CSS; scripts are not run.';
    box.replaceChildren(
      el('strong', {}, tabContext.hasHostAccess ? `Access to ${tabContext.origin} is granted. ` : `Permission needed for ${tabContext.origin}. `),
      tabContext.hasHostAccess
        ? ''
        : 'Chrome will ask once when you click Find. Only this website is requested, and nothing leaves your device. ',
      `Up to ${maxPages ?? 50} internal pages ${how}`,
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
    const target = Math.max(1, Math.min(progress.maxPages, progress.discovered));
    status.update({
      title: `Scanning site: ${progress.attempted} of ${target} pages`,
      fraction: Math.min(1, progress.attempted / target),
      stats: `${progress.scanned} scanned · ${progress.failed} failed · ${progress.queued} queued · ${pluralize(progress.matches, 'match', 'matches')}`,
      active: progress.active,
    });
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
    const crawl = readCrawlOptions();

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
      crawl,
    }); // fire and forget - preferences are best effort

    const scanId = uid('scan');
    currentScanId = scanId;
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
          crawl,
        },
        { timeoutMs: 0 }, // long jobs are bounded by cancellation, not a message timeout
      );
      if (scanId !== currentScanId) return; // a newer scan or a cancel superseded this one

      lastScan = response;
      status.clear();
      const outcome = results.show(response, { hex: validation.hex });
      if (response.coverage?.cancelled) ctx.notify.info('Scan cancelled - showing partial results.');
      else if (!outcome.empty) {
        ctx.notify.success(`Found ${pluralize(response.pages.reduce((n, p) => n + p.matches.length, 0), 'match', 'matches')}.`);
      }
    } catch (error) {
      if (scanId !== currentScanId) return;
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
        crawlMode: $('cf-crawl-mode'),
        crawl: Object.fromEntries(CRAWL_FIELDS.map((key) => [key, $(`cf-crawl-${key}`)])),
        find: $('cf-find'),
        cancel: $('cf-cancel'),
        status: $('cf-status'),
        results: $('cf-results'),
      };

      settings = await loadSettings();
      refs.text.value = settings.color;
      refs.matchMode.value = settings.matchMode;
      refs.inherited.checked = settings.includeInherited;
      writeCrawlOptions(settings.crawl);

      input = createColorInput({
        textInput: refs.text,
        picker: refs.picker,
        preview: refs.preview,
        errorEl: refs.error,
        helpEl: refs.help,
        pickerIcon: refs.pickerIcon,
        onSubmit: find,
      });

      results = createResults(refs.results, {
        onAction: handleAction,
        groupMode: settings.groupMode,
        onGroupModeChange: (groupMode) => saveSettings({ groupMode }),
      });

      refs.form.addEventListener('submit', (event) => {
        event.preventDefault();
        find();
      });
      refs.cancel.addEventListener('click', cancel);
      refs.crawl.maxPages.addEventListener('input', renderSiteNotice);
      refs.crawlMode.addEventListener('change', renderSiteNotice);

      disposers.push(onEvent(MSG.SCAN_PROGRESS, handleProgress));
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
