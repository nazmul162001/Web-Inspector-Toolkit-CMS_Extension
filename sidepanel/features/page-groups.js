/**
 * Entire Site result list: accordion by first path segment, a page filter,
 * and a "show all subpages" control for article listings.
 */

import { el, pluralize } from '../../shared/helpers.js';
import { displayPath } from '../../services/url-normalizer.js';
import { icon } from '../components/icons.js';
import { collectSectionFacets, groupBySection, pagesShownInGroup } from './color-find/color-find-utils.js';

export function isSitePageList(scan) {
  return scan?.scope === 'site' && (scan.pages?.length || 0) > 1;
}

export function pageFilterField({ items, section, onChange }) {
  const facets = collectSectionFacets(items);
  return el(
    'label',
    { class: 'tb-field tb-field--page' },
    el('span', {}, 'Page'),
    el(
      'select',
      { class: 'select', onChange: (event) => onChange(event.target.value) },
      el('option', { value: '', selected: section === '' }, `All pages (${facets.length})`),
      ...facets.map((facet) =>
        el(
          'option',
          { value: facet.value, selected: section === facet.value, 'data-i18n-skip': true },
          `${facet.value} (${facet.count})`,
        ),
      ),
    ),
  );
}

export function createPageBlock(bucket, groupNodes) {
  if (!groupNodes.length) return null;
  return el(
    'section',
    { class: 'page-block' },
    el(
      'header',
      { class: 'page-block__head' },
      icon('file', { size: 14 }),
      el('span', { class: 'page-block__path', title: bucket.page.url }, displayPath(bucket.page.url)),
      el('span', { class: 'badge badge--accent' }, String(bucket.items.length)),
    ),
    el('div', { class: 'page-block__title' }, bucket.page.title || bucket.page.url),
    ...groupNodes,
  );
}

/**
 * @param {{
 *   items: object[],
 *   openSections: Set<string>,
 *   openSubpages: Set<string>,
 *   cardLimit: number,
 *   onToggleSection: (section: string) => void,
 *   onShowAllSubpages: (section: string) => void,
 *   onShowMore: () => void,
 *   renderPage: (bucket: object, budget: { remaining: number }) => HTMLElement | null,
 * }} options
 */
export function renderSectionGroups({
  items,
  openSections,
  openSubpages,
  cardLimit,
  onToggleSection,
  onShowAllSubpages,
  onShowMore,
  renderPage,
}) {
  return groupBySection(items).map((group) => {
    const open = openSections.has(group.section);
    const shown = open ? pagesShownInGroup(group, openSubpages.has(group.section)) : { pages: [], hidden: 0, subCount: group.subCount };
    const body = [];

    if (open) {
      const budget = { remaining: cardLimit };
      for (const page of shown.pages) {
        const block = renderPage(page, budget);
        if (block) body.push(block);
      }
      const rendered = cardLimit - budget.remaining;
      const total = shown.pages.reduce((sum, page) => sum + page.items.length, 0);
      if (rendered < total) {
        body.push(
          el(
            'button',
            { class: 'btn btn--block', type: 'button', onClick: onShowMore },
            `Show more (${(total - rendered).toLocaleString()} remaining)`,
          ),
        );
      }
      if (shown.hidden > 0) {
        body.push(
          el(
            'button',
            { class: 'btn btn--block page-group__more', type: 'button', onClick: () => onShowAllSubpages(group.section) },
            `Show all ${shown.subCount.toLocaleString()} subpages`,
          ),
        );
      }
    }

    return el(
      'section',
      { class: `page-group${open ? ' page-group--open' : ''}`, 'data-section': group.section },
      el(
        'button',
        {
          class: 'page-group__toggle',
          type: 'button',
          'aria-expanded': String(open),
          onClick: () => onToggleSection(group.section),
        },
        icon('chevron', { size: 14, className: 'page-group__chevron' }),
        el('span', { class: 'page-group__path', title: group.section, 'data-i18n-skip': true }, group.section),
        group.pageCount > 1 ? el('span', { class: 'page-group__meta' }, pluralize(group.pageCount, 'page')) : null,
        el('span', { class: 'badge badge--accent' }, String(group.itemCount)),
      ),
      open && body.length ? el('div', { class: 'page-group__body' }, body) : null,
    );
  });
}
