/**
 * Text Find results view: coverage + summary, grouping / sorting / filtering
 * toolbar and the incrementally rendered list of cards. Mirrors the Color Find
 * view so both tools behave the same way.
 */

import { el, pluralize, setChildren } from '../../../shared/helpers.js';
import { displayPath } from '../../../services/url-normalizer.js';
import { icon } from '../../components/icons.js';
import { collectFacets, filterItems, groupByPage } from '../color-find/color-find-utils.js';
import { coverageBanner, pageNotices, scopeLabel } from '../color-find/color-results.js';
import { createTextResultCard } from './text-result-card.js';
import { buildTextSummary, flattenTextResult, groupTextItems, sortTextItems } from './text-find-utils.js';

const RENDER_STEP = 60;
const MAX_CLASS_OPTIONS = 150;

/**
 * @param {HTMLElement} root
 * @param {{ onAction: (action: string, item: object) => void, groupMode?: string, onGroupModeChange?: (mode: string) => void }} options
 */
export function createTextResults(root, { onAction, groupMode = 'section', onGroupModeChange, emptyState, copyLabel, subject = 'text' }) {
  let scan = null;
  let items = [];
  let view = { groupMode, sortMode: 'dom', tag: '', cls: '', limit: RENDER_STEP };
  let listEl = null;
  let countEl = null;
  const expanded = new Set();

  const noticeOptions = { truncatedHint: 'Try a longer or more specific text, Match case or Whole word.' };

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

  const option = (value, label, selected) => el('option', { value, selected }, label);

  function toolbar(facets) {
    const seg = (mode, label) =>
      el(
        'button',
        {
          class: 'seg__btn',
          type: 'button',
          'aria-pressed': String(view.groupMode === mode),
          onClick: (event) => {
            view.groupMode = mode;
            onGroupModeChange?.(mode);
            event.currentTarget.parentElement.querySelectorAll('.seg__btn').forEach((b) => b.setAttribute('aria-pressed', String(b === event.currentTarget)));
            view.limit = RENDER_STEP;
            renderList();
          },
        },
        label,
      );
    const select = (label, options, onChange) =>
      el('label', { class: 'tb-field' }, el('span', {}, label), el('select', { class: 'select', onChange: (e) => onChange(e.target.value) }, options));

    return el(
      'div',
      { class: 'toolbar' },
      el('div', { class: 'toolbar__row' }, el('span', { class: 'toolbar__label' }, 'Group by'), el('div', { class: 'seg', role: 'group', 'aria-label': 'Group by' }, seg('section', 'Section'), seg('tag', 'Tag'), seg('none', 'None'))),
      el(
        'div',
        { class: 'toolbar__grid' },
        select('Sort', [option('dom', 'DOM order', view.sortMode === 'dom'), option('tag', 'Tag', view.sortMode === 'tag')], (value) => {
          view.sortMode = value;
          renderList();
        }),
        select('Tag', [option('', `All tags (${facets.tags.length})`, view.tag === ''), ...facets.tags.map((t) => option(t.value, `${t.value} (${t.count})`, view.tag === t.value))], (value) => {
          view.tag = value;
          view.limit = RENDER_STEP;
          renderList();
        }),
        select('Class', [option('', `All classes (${facets.classes.length})`, view.cls === ''), ...facets.classes.slice(0, MAX_CLASS_OPTIONS).map((c) => option(c.value, `.${c.value} (${c.count})`, view.cls === c.value))], (value) => {
          view.cls = value;
          view.limit = RENDER_STEP;
          renderList();
        }),
      ),
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
        el('div', { class: 'empty empty--inline' }, 'No results match these filters.', el('button', { class: 'btn btn--sm', type: 'button', onClick: () => { view.tag = ''; view.cls = ''; build(); } }, 'Clear filters')),
      );
      return;
    }

    if (scan.scope === 'site' && scan.pages.length > 1) {
      for (const bucket of groupByPage(filtered)) {
        const groups = groupTextItems(bucket.items, view.groupMode).map((g) => groupBlock(g, budget)).filter(Boolean);
        if (!groups.length) continue;
        blocks.push(
          el(
            'section',
            { class: 'page-block' },
            el('header', { class: 'page-block__head' }, icon('file', { size: 14 }), el('span', { class: 'page-block__path', title: bucket.page.url }, displayPath(bucket.page.url)), el('span', { class: 'badge badge--accent' }, String(bucket.items.length))),
            el('div', { class: 'page-block__title' }, bucket.page.title || bucket.page.url),
            ...groups,
          ),
        );
      }
    } else {
      for (const group of groupTextItems(filtered, view.groupMode)) {
        const block = groupBlock(group, budget);
        if (block) blocks.push(block);
      }
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
    const facets = collectFacets(items);
    countEl = el('span', { class: 'toolbar__count' });
    listEl = el('div', { class: 'cf-list' });
    setChildren(
      root,
      scopeLabel(scan),
      coverageBanner(scan.coverage, scan.failures || [], { subject }),
      ...pageNotices(scan.pages, noticeOptions),
      summaryTiles(buildTextSummary(items), scan.scope === 'site'),
      toolbar(facets),
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
        view = { ...view, sortMode: 'dom', tag: '', cls: '', limit: RENDER_STEP };
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
