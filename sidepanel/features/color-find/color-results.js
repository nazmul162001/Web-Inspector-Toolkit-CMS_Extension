/**
 * Results view: coverage + summary, grouping / sorting / filtering toolbar,
 * and the (incrementally rendered) list of result cards. Also owns the empty
 * and error states.
 */

import { pluralize, el, setChildren } from '../../../shared/helpers.js';
import { displayPath } from '../../../services/url-normalizer.js';
import { icon } from '../../components/icons.js';
import { createSpinner } from '../../components/loading.js';
import { createPageBlock, isSitePageList, pageFilterField, renderSectionGroups } from '../page-groups.js';
import { createResultCard } from './color-result-card.js';
import {
  buildSummary,
  describeCoverage,
  filterItems,
  flattenScanResult,
  groupItems,
  sortItems,
} from './color-find-utils.js';

const RENDER_STEP = 60;

/** Which scope/page a result set belongs to (results outlive tab switches). */
export function scopeLabel(result) {
  if (result.scope === 'site') {
    return el('div', { class: 'cf-scanned' }, icon('globe', { size: 13 }), `Entire Site · ${result.coverage?.origin || ''}`);
  }
  const page = result.pages[0];
  return el('div', { class: 'cf-scanned', title: page.url }, icon('file', { size: 13 }), `This Page · ${displayPath(page.url)}`);
}

export function coverageBanner(coverage, failures, { subject } = {}) {
  const info = describeCoverage(coverage, { subject });
  if (!info) return null;
  const tone = info.state === 'complete' ? 'success' : info.state === 'progress' ? 'info' : 'warn';
  return el(
    'div',
    { class: `notice notice--${tone}` },
    el(
      'div',
      { class: 'notice__row' },
      info.state === 'progress' ? createSpinner() : icon(tone === 'success' ? 'check' : 'alert', { size: 15 }),
      el('strong', {}, info.headline),
    ),
    el('div', { class: 'notice__text' }, info.detail),
    info.note ? el('div', { class: 'notice__text' }, info.note) : null,
    failures.length
      ? el(
          'details',
          { class: 'cf-details' },
          el('summary', {}, `${pluralize(failures.length, 'page')} could not be inspected`),
          el(
            'ul',
            { class: 'plain-list plain-list--tight' },
            failures.map((failure) =>
              el('li', {}, el('code', { title: failure.url }, displayPath(failure.url)), el('span', { class: 'kv__dim' }, ` - ${failure.reason}`)),
            ),
          ),
        )
      : null,
  );
}

export function pageNotices(pages, { truncatedHint = 'Try a more specific color or Exact match.' } = {}) {
  const blocked = new Map();
  let truncated = false;
  for (const page of pages) {
    truncated ||= !!page.truncated;
    for (const sheet of page.stats?.stylesheets?.inaccessible || []) blocked.set(sheet.href || sheet.label, sheet);
  }
  const notices = [];
  if (truncated) {
    notices.push(
      el(
        'div',
        { class: 'notice notice--warn' },
        `The per-page result limit was reached, so some matches are not listed. ${truncatedHint}`,
      ),
    );
  }
  if (blocked.size) {
    notices.push(
      el(
        'details',
        { class: 'notice notice--info' },
        el('summary', {}, `${pluralize(blocked.size, 'stylesheet')} could not be read (cross-origin)`),
        el('div', { class: 'notice__text' }, 'Matches that come only from these files show computed values, but no CSS source details.'),
        el('ul', { class: 'plain-list plain-list--tight' }, Array.from(blocked.values()).slice(0, 8).map((s) => el('li', {}, el('code', {}, s.label)))),
      ),
    );
  }
  return notices;
}


/**
 * @param {HTMLElement} root
 * @param {{ onAction: (action: string, item: object) => void, groupMode?: string, onGroupModeChange?: (mode: string) => void }} options
 */
export function createResults(root, { onAction, groupMode = 'section', onGroupModeChange }) {
  let scan = null;
  let items = [];
  let view = { groupMode, sortMode: 'dom', tag: '', cls: '', section: '', limit: RENDER_STEP };
  let listEl = null;
  let countEl = null;

  const expanded = new Set();
  const openSections = new Set();
  const openSubpages = new Set();

  /* ------------------------------------------------------------- Pieces */

  function summaryTiles(summary, isSite) {
    const tile = (label, value) =>
      el('div', { class: 'tile' }, el('span', { class: 'tile__value' }, value.toLocaleString()), el('span', { class: 'tile__label' }, label));
    return el(
      'div',
      { class: `tiles${isSite ? ' tiles--5' : ''}` },
      tile('Elements', summary.elements),
      tile('Declarations', summary.declarations),
      tile('Selectors', summary.selectors),
      tile('Sections', summary.sections),
      isSite ? tile('Pages', summary.pages) : null,
    );
  }

  function toolbar() {
    if (!isSitePageList(scan)) return null;
    return el(
      'div',
      { class: 'toolbar' },
      pageFilterField({
        items,
        section: view.section,
        onChange: (value) => {
          view.section = value;
          view.limit = RENDER_STEP;
          if (value) openSections.add(value);
          renderList();
        },
      }),
    );
  }

  function groupBlock(group, budget) {
    const cards = [];
    for (const item of group.items) {
      if (budget.remaining <= 0) break;
      budget.remaining -= 1;
      cards.push(createResultCard(item, {
        onAction,
        expanded: expanded.has(item.key),
        onToggle: (key, open) => (open ? expanded.add(key) : expanded.delete(key)),
      }));
    }
    if (cards.length === 0) return null;
    return el(
      'section',
      { class: 'group' },
      el('header', { class: 'group__head' }, el('span', { class: 'group__label' }, group.label), group.sublabel ? el('span', { class: 'group__sub' }, group.sublabel) : null, el('span', { class: 'badge' }, `${pluralize(group.items.length, 'match', 'matches')}`)),
      el('div', { class: 'group__cards' }, cards),
    );
  }

  function renderList() {
    const filtered = sortItems(filterItems(items, view), view.sortMode);
    countEl.textContent = filtered.length === items.length
      ? `${pluralize(items.length, 'match', 'matches')}`
      : `Showing ${filtered.length.toLocaleString()} of ${items.length.toLocaleString()} matches`;

    const budget = { remaining: view.limit };
    const blocks = [];
    const bySite = isSitePageList(scan);

    if (filtered.length === 0) {
      listEl.replaceChildren(
        el('div', { class: 'empty empty--inline' }, 'No results match these filters.', el('button', { class: 'btn btn--sm', type: 'button', onClick: () => { view.section = ''; build(); } }, 'Clear filters')),
      );
      return;
    }

    if (bySite) {
      listEl.replaceChildren(
        ...renderSectionGroups({
          items: filtered,
          openSections,
          openSubpages,
          cardLimit: view.limit,
          onToggleSection: (key) => {
            if (openSections.has(key)) openSections.delete(key);
            else openSections.add(key);
            renderList();
          },
          onShowAllSubpages: (key) => {
            openSubpages.add(key);
            openSections.add(key);
            renderList();
          },
          onShowMore: () => {
            view.limit += RENDER_STEP * 2;
            renderList();
          },
          renderPage: (bucket, pageBudget) =>
            createPageBlock(
              bucket,
              groupItems(bucket.items, view.groupMode).map((g) => groupBlock(g, pageBudget)).filter(Boolean),
            ),
        }),
      );
      return;
    }

    for (const group of groupItems(filtered, view.groupMode)) {
      const block = groupBlock(group, budget);
      if (block) blocks.push(block);
    }

    const rendered = view.limit - budget.remaining;
    if (rendered < filtered.length) {
      blocks.push(
        el('button', { class: 'btn btn--block', type: 'button', onClick: () => { view.limit += RENDER_STEP * 2; renderList(); } }, `Show more (${(filtered.length - rendered).toLocaleString()} remaining)`),
      );
    }
    listEl.replaceChildren(...blocks);
  }

  /* -------------------------------------------------------------- Public */

  function build() {
    const summary = buildSummary(items);
    countEl = el('span', { class: 'toolbar__count' });
    listEl = el('div', { class: 'cf-list' });

    setChildren(
      root,
      scopeLabel(scan),
      coverageBanner(scan.coverage, scan.failures || []),
      ...pageNotices(scan.pages),
      summaryTiles(summary, scan.scope === 'site'),
      toolbar(),
      el('div', { class: 'cf-list-head' }, countEl),
      listEl,
    );
    renderList();
  }

  return {
    clear() {
      scan = null;
      items = [];
      expanded.clear();
      openSections.clear();
      openSubpages.clear();
      root.replaceChildren();
    },

    /**
     * Live update while a site scan is still running: re-render with the pages
     * finished so far, keeping the user's sorting, filters and open cards.
     */
    showPartial(scanResult) {
      scan = scanResult;
      items = flattenScanResult(scanResult);
      if (items.length === 0) return;
      build();
    },

    /** Replace the view with a finished (or partial) scan response. */
    show(scanResult, { hex, keepView = false }) {
      scan = scanResult;
      items = flattenScanResult(scanResult);
      if (!keepView) {
        expanded.clear();
        openSections.clear();
        openSubpages.clear();
        view = { ...view, sortMode: 'dom', tag: '', cls: '', section: '', limit: RENDER_STEP };
      }

      if (items.length === 0) {
        setChildren(
          root,
          scopeLabel(scan),
          coverageBanner(scan.coverage, scan.failures || []),
          ...pageNotices(scan.pages),
          el(
            'div',
            { class: 'empty' },
            icon('search', { size: 22 }),
            el('h3', {}, `No elements use ${hex}`),
            el('p', {}, scan.scope === 'site' ? 'None of the scanned pages renders this color.' : 'Nothing on this page renders this color.'),
            el(
              'ul',
              { class: 'plain-list' },
              el('li', {}, 'Try Near match to allow tiny rounding differences.'),
              el('li', {}, 'Turn on "Include inherited values" to list every element that inherits it.'),
              el('li', {}, 'Colors on ::before / ::after, images, canvas or shadow DOM are not inspected.'),
            ),
          ),
        );
        return { empty: true };
      }
      build();
      return { empty: false };
    },

    showError(message, { actions = [] } = {}) {
      scan = null;
      items = [];
      setChildren(
        root,
        el(
          'div',
          { class: 'empty empty--error', role: 'alert' },
          icon('alert', { size: 22 }),
          el('h3', {}, 'Could not complete the scan'),
          el('p', {}, message),
          actions.length
            ? el('div', { class: 'cf-actions' }, actions.map((a) => el('button', { class: `btn btn--sm${a.primary ? ' btn--primary' : ''}`, type: 'button', onClick: a.onClick }, a.label)))
            : null,
        ),
      );
    },

    showIdle() {
      root.replaceChildren();
    },
  };
}
