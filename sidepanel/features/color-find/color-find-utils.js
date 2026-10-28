/**
 * Pure data helpers for Color Find results: flattening a scan response into
 * result items, summary statistics, grouping, sorting and filtering. No DOM.
 */

import {
  COLOR_PROPERTIES,
  PROPERTY_GROUP_LABELS,
  SECTION_LABELS,
  SECTION_ORDER,
} from '../../../shared/constants.js';

const PROPERTY_ORDER = new Map(COLOR_PROPERTIES.map((descriptor, index) => [descriptor.property, index]));

/**
 * One item per matching (element, property) declaration.
 * @returns {object[]}
 */
export function flattenScanResult(scan) {
  const items = [];
  scan.pages.forEach((page, pageIndex) => {
    const elements = new Map(page.elements.map((element) => [element.elementId, element]));
    page.matches.forEach((match, matchIndex) => {
      const element = elements.get(match.elementId);
      if (!element) return;
      items.push({
        key: `${pageIndex}:${matchIndex}`,
        pageIndex,
        page,
        element,
        match,
        order: [pageIndex, element.domIndex, PROPERTY_ORDER.get(match.property) ?? 99],
      });
    });
  });
  return items;
}

/** Totals shown in the summary tiles. */
export function buildSummary(items) {
  const elements = new Set();
  const selectors = new Set();
  const sections = new Set();
  const pages = new Set();
  let withSource = 0;
  for (const item of items) {
    elements.add(`${item.pageIndex}:${item.element.elementId}`);
    selectors.add(item.element.selector);
    sections.add(item.element.location.section);
    pages.add(item.pageIndex);
    if (item.match.source) withSource += 1;
  }
  return {
    elements: elements.size,
    declarations: items.length,
    selectors: selectors.size,
    sections: sections.size,
    pages: pages.size,
    withSource,
  };
}

/** Values for the tag / class filter dropdowns, most frequent first. */
export function collectFacets(items) {
  const tags = new Map();
  const classes = new Map();
  for (const item of items) {
    tags.set(item.element.tag, (tags.get(item.element.tag) || 0) + 1);
    for (const name of item.element.classes) classes.set(name, (classes.get(name) || 0) + 1);
  }
  const toList = (map) =>
    Array.from(map, ([value, count]) => ({ value, count })).sort(
      (a, b) => b.count - a.count || a.value.localeCompare(b.value),
    );
  return { tags: toList(tags), classes: toList(classes) };
}

export function filterItems(items, { tag = '', cls = '' } = {}) {
  if (!tag && !cls) return items;
  return items.filter(
    (item) => (!tag || item.element.tag === tag) && (!cls || item.element.classes.includes(cls)),
  );
}

const compareOrder = (a, b) => {
  for (let i = 0; i < a.order.length; i += 1) {
    if (a.order[i] !== b.order[i]) return a.order[i] - b.order[i];
  }
  return 0;
};

/** @param {'dom'|'property'|'tag'} mode */
export function sortItems(items, mode = 'dom') {
  const sorted = [...items];
  switch (mode) {
    case 'property':
      return sorted.sort(
        (a, b) =>
          (PROPERTY_ORDER.get(a.match.property) ?? 99) - (PROPERTY_ORDER.get(b.match.property) ?? 99) ||
          compareOrder(a, b),
      );
    case 'tag':
      return sorted.sort((a, b) => a.element.tag.localeCompare(b.element.tag) || compareOrder(a, b));
    default:
      return sorted.sort(compareOrder);
  }
}

/**
 * @param {object[]} items already filtered + sorted
 * @param {'section'|'property'|'none'} mode
 * @returns {{ id: string, label: string, items: object[] }[]}
 */
export function groupItems(items, mode) {
  if (mode === 'none') return [{ id: 'all', label: 'All matches', items }];

  const groups = new Map();
  for (const item of items) {
    const id = mode === 'section' ? item.element.location.section : item.match.property;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(item);
  }

  let ids = Array.from(groups.keys());
  if (mode === 'section') {
    ids = SECTION_ORDER.filter((id) => groups.has(id));
  } else {
    ids.sort((a, b) => (PROPERTY_ORDER.get(a) ?? 99) - (PROPERTY_ORDER.get(b) ?? 99));
  }

  return ids.map((id) => ({
    id,
    label: mode === 'section' ? SECTION_LABELS[id] || id : id,
    sublabel:
      mode === 'property'
        ? PROPERTY_GROUP_LABELS[groups.get(id)[0].match.group] || ''
        : '',
    items: groups.get(id),
  }));
}

/** Split items into per-page buckets (used for Entire Site results). */
export function groupByPage(items) {
  const pages = new Map();
  for (const item of items) {
    if (!pages.has(item.pageIndex)) pages.set(item.pageIndex, { page: item.page, pageIndex: item.pageIndex, items: [] });
    pages.get(item.pageIndex).items.push(item);
  }
  return Array.from(pages.values()).sort((a, b) => a.pageIndex - b.pageIndex);
}

/** Human-readable "where is this declared" label. */
export function describeSourceLocation(source) {
  if (!source) return '';
  if (source.origin === 'inline') return 'Inline style attribute';
  const where = source.stylesheetLabel || 'stylesheet';
  if (!source.line) return where;
  return source.lineBase === 'style-element' ? `${where}, line ${source.line} of the block` : `${where}:${source.line}`;
}

/** Stable key to detect repeated declarations (same rule + property + value). */
export function declarationKey(item) {
  const { source } = item.match;
  if (!source) return null;
  if (source.origin === 'inline') return `inline:${item.pageIndex}:${item.element.elementId}:${item.match.property}`;
  return `${source.stylesheetUrl || source.stylesheetLabel}|${source.selector}|${source.property}|${source.value}`;
}

/** Descriptive text for the coverage banner of an Entire Site scan. */
export function describeCoverage(coverage) {
  if (!coverage || coverage.scope !== 'site') return null;
  const parts = [`Scanned ${coverage.scanned} of ${coverage.discovered} discovered ${coverage.discovered === 1 ? 'page' : 'pages'}`];
  if (coverage.failed) parts.push(`${coverage.failed} could not be inspected`);
  if (coverage.notScanned) parts.push(`${coverage.notScanned} not scanned`);
  const headline = parts.join(' · ');

  let state = 'complete';
  let detail = 'Every discovered internal page was inspected.';
  if (coverage.cancelled) {
    state = 'partial';
    detail = 'Scan cancelled - these results cover only the pages scanned before you stopped it.';
  } else if (coverage.limitReached) {
    state = 'partial';
    detail = `Page limit (${coverage.maxPages}) reached. ${coverage.notScanned} discovered ${coverage.notScanned === 1 ? 'page was' : 'pages were'} not scanned, so results are incomplete.`;
  } else if (coverage.failed) {
    state = 'partial';
    detail = 'Some pages could not be inspected, so results may be incomplete.';
  }
  const note =
    coverage.mode === 'background'
      ? 'Other pages were read invisibly as HTML + CSS without running their scripts, so colors added by JavaScript are not included. Choose "Temporary background tabs" in Crawl options to include them.'
      : null;
  return { state, headline, detail, note };
}
