/**
 * Pieces every scanning tool shares: friendly error text, the progress/status
 * block, and the throttled live rendering of Entire Site results.
 */

import { ERR } from '../../shared/constants.js';
import { el } from '../../shared/helpers.js';
import { displayPath } from '../../services/url-normalizer.js';
import { createProgressBar, createSpinner } from '../components/loading.js';

/** Map a failure to a friendly message (and whether a Grant action fits). */
export function describeError(error) {
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

/** The busy/progress block shown while a scan runs. */
export function createStatus(container) {
  const status = {
    parts: null,
    show(label) {
      const bar = createProgressBar();
      const title = el('span', { class: 'status__title' }, label);
      const stats = el('div', { class: 'status__stats' });
      const active = el('ul', { class: 'status__active' });
      container.replaceChildren(
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
      container.replaceChildren(el('div', { class: `notice notice--${tone}` }, text));
    },
    clear() {
      status.parts = null;
      container.replaceChildren();
    },
  };
  return status;
}

const STREAM_RENDER_MS = 600;

/**
 * Entire Site streams every finished page. The first results (the page you are
 * on) show up almost immediately and the list grows while the crawl runs;
 * rendering is throttled so a fast crawl does not repaint on every page.
 *
 * @param {{ results: { showPartial: (scan: object) => void }, isBusy: () => boolean, getOrigin: () => string }} deps
 */
export function createStreamer({ results, isBusy, getOrigin }) {
  const state = { pages: [], discovered: 0, timer: null, lastRender: 0, active: false };

  function render() {
    state.timer = null;
    state.lastRender = Date.now();
    if (!isBusy() || state.pages.length === 0) return;
    results.showPartial({
      scope: 'site',
      pages: state.pages,
      failures: [],
      coverage: {
        scope: 'site',
        origin: getOrigin() || '',
        inProgress: true,
        scanned: state.pages.length,
        discovered: state.discovered,
      },
    });
    state.active = true;
  }

  return {
    /** True once at least one partial view was drawn (the final render then keeps the user's view). */
    get active() {
      return state.active;
    },
    reset() {
      clearTimeout(state.timer);
      Object.assign(state, { pages: [], discovered: 0, timer: null, lastRender: 0, active: false });
    },
    setDiscovered(count) {
      state.discovered = count;
    },
    push(page) {
      state.pages.push(page);
      if (state.timer) return;
      state.timer = setTimeout(render, Math.max(0, STREAM_RENDER_MS - (Date.now() - state.lastRender)));
    },
  };
}
