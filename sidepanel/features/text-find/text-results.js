/**
 * Text Find results view: coverage + summary, grouping / sorting / filtering
 * toolbar and the incrementally rendered list of cards. Mirrors the Color Find
 * view so both tools behave the same way.
 */

import { el, pluralize, setChildren } from '../../../shared/helpers.js';
import { icon } from '../../components/icons.js';
import { filterItems } from '../color-find/color-find-utils.js';
import { coverageBanner, pageNotices, scopeLabel } from '../color-find/color-results.js';
import { createPageBlock, isSitePageList, pageFilterField, renderSectionGroups } from '../page-groups.js';
import { createTextResultCard } from './text-result-card.js';
import { buildTextSummary, flattenTextResult, groupTextItems, sortTextItems } from './text-find-utils.js';

const RENDER_STEP = 60;

/**
 * @param {HTMLElement} root
 * @param {{ onAction: (action: string, item: object) => void, groupMode?: string, onGroupModeChange?: (mode: string) => void }} options
 */
export function createTextResults(root, { onAction, groupMode = 'section', onGroupModeChange, emptyState, copyLabel, subject = 'text', truncatedHint = 'Try a longer or more specific text, Match case or Whole word.' }) {
  let scan = null;
  let items = [];
  let view = { groupMode, sortMode: 'dom', tag: '', cls: '', section: '', limit: RENDER_STEP };
  let listEl = null;
  let countEl = null;
  const expanded = new Set();
  const openSections = new Set();
  const openSubpages = new Set();

  const noticeOptions = { truncatedHint };

  function summaryTiles(summary, isSite) {
    const tile = (label, value) =>
      el('div', { class: 'tile' }, el('span', { class: 'tile__value' }, value.toLocaleString()), el('span', { class: 'tile__label' }, label));
    return el(
      'div',
      { class: `tiles${isSite ? ' tiles--5' : ''}` },
      tile('Matches', summary.matches),
      tile('Elements', summary.elements),
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
      cards.push(
        createTextResultCard(item, {
          onAction,
          copyLabel,
          expanded: expanded.has(item.key),
          onToggle: (key, open) => (open ? expanded.add(key) : expanded.delete(key)),
        }),
      );
    }
    if (cards.length === 0) return null;
    return el(
      'section',
      { class: 'group' },
      el('header', { class: 'group__head' }, el('span', { class: 'group__label' }, group.label), el('span', { class: 'badge' }, pluralize(group.items.length, 'match', 'matches'))),
      el('div', { class: 'group__cards' }, cards),
    );
  }

  function renderList() {
    const filtered = sortTextItems(filterItems(items, view), view.sortMode);
    countEl.textContent =
      filtered.length === items.length
        ? pluralize(items.length, 'match', 'matches')
        : `Showing ${filtered.length.toLocaleString()} of ${items.length.toLocaleString()} matches`;

    const budget = { remaining: view.limit };
    const blocks = [];

    if (filtered.length === 0) {
      listEl.replaceChildren(
        el('div', { class: 'empty empty--inline' }, 'No results match these filters.', el('button', { class: 'btn btn--sm', type: 'button', onClick: () => { view.section = ''; build(); } }, 'Clear filters')),
      );
      return;
    }

    if (isSitePageList(scan)) {
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
              groupTextItems(bucket.items, view.groupMode).map((g) => groupBlock(g, pageBudget)).filter(Boolean),
            ),
        }),
      );
      return;
    }

    for (const group of groupTextItems(filtered, view.groupMode)) {
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

  function build() {
    countEl = el('span', { class: 'toolbar__count' });
    listEl = el('div', { class: 'cf-list' });
    setChildren(
      root,
      scopeLabel(scan),
      coverageBanner(scan.coverage, scan.failures || [], { subject }),
      ...pageNotices(scan.pages, noticeOptions),
      summaryTiles(buildTextSummary(items), scan.scope === 'site'),
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

    /** Live update while a site scan runs: keeps sorting, filters and open cards. */
    showPartial(scanResult) {
      scan = scanResult;
      items = flattenTextResult(scanResult);
      if (items.length === 0) return;
      build();
    },

    show(scanResult, { query, keepView = false }) {
      scan = scanResult;
      items = flattenTextResult(scanResult);
      if (!keepView) {
        expanded.clear();
        openSections.clear();
        openSubpages.clear();
        view = { ...view, sortMode: 'dom', tag: '', cls: '', section: '', limit: RENDER_STEP };
      }

      if (items.length === 0) {
        const empty = emptyState(query, scan);
        setChildren(
          root,
          scopeLabel(scan),
          coverageBanner(scan.coverage, scan.failures || [], { subject }),
          ...pageNotices(scan.pages, noticeOptions),
          el(
            'div',
            { class: 'empty' },
            icon('search', { size: 22 }),
            el('h3', {}, empty.title),
            el('p', {}, empty.message),
            el('ul', { class: 'plain-list' }, empty.hints.filter(Boolean).map((hint) => el('li', {}, hint))),
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
          el('h3', {}, 'Could not complete the search'),
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
