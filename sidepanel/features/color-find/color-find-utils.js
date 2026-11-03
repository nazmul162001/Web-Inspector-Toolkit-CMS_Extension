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
import { isSectionIndex, sectionPath } from '../../../services/url-normalizer.js';

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

export function filterItems(items, { tag = '', cls = '', section = '' } = {}) {
  if (!tag && !cls && !section) return items;
  return items.filter((item) => {
    if (tag && item.element.tag !== tag) return false;
    if (cls && !item.element.classes.includes(cls)) return false;
    if (section && sectionPath(item.page.url) !== section) return false;
    return true;
  });
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

const compareSection = (a, b) => {
  if (a === '/') return -1;
  if (b === '/') return 1;
  return a.localeCompare(b);
};

/** Values for the Entire Site page filter, home first then A–Z. */
export function collectSectionFacets(items) {
  const counts = new Map();
  for (const item of items) {
    const key = sectionPath(item.page.url);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => compareSection(a.value, b.value));
}

/**
 * Group matches by first path segment (`/`, `/blog`, `/menu`).
 * Listing pages (`/blog`) sort ahead of article URLs (`/blog/id`).
 */
export function groupBySection(items) {
  const sections = new Map();
  for (const item of items) {
    const key = sectionPath(item.page.url);
    let group = sections.get(key);
    if (!group) {
      group = { section: key, pages: new Map(), itemCount: 0 };
      sections.set(key, group);
    }
    group.itemCount += 1;
    let bucket = group.pages.get(item.pageIndex);
    if (!bucket) {
      bucket = {
        page: item.page,
        pageIndex: item.pageIndex,
        items: [],
        isIndex: isSectionIndex(item.page.url),
      };
      group.pages.set(item.pageIndex, bucket);
    }
    bucket.items.push(item);
  }

  return Array.from(sections.values())
    .map((group) => {
      const pages = Array.from(group.pages.values()).sort((a, b) => {
        if (a.isIndex !== b.isIndex) return a.isIndex ? -1 : 1;
        return a.pageIndex - b.pageIndex;
      });
      const indexCount = pages.reduce((count, page) => count + (page.isIndex ? 1 : 0), 0);
      return {
        section: group.section,
        pages,
        itemCount: group.itemCount,
        pageCount: pages.length,
        indexCount,
        subCount: pages.length - indexCount,
      };
    })
    .sort((a, b) => compareSection(a.section, b.section));
}

/**
 * Expanded listing: the section index plus the first article.
 * `showAllSubpages` reveals the rest of `/blog/id`, `/news/id`, …
 */
export function pagesShownInGroup(group, showAllSubpages = false) {
  if (showAllSubpages || group.subCount <= 1) {
    return { pages: group.pages, hidden: 0, subCount: group.subCount };
  }
  return {
    pages: group.pages.slice(0, group.indexCount + 1),
    hidden: group.subCount - 1,
    subCount: group.subCount,
  };
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
export function describeCoverage(coverage, { subject = 'colors' } = {}) {
  if (!coverage || coverage.scope !== 'site') return null;
  if (coverage.inProgress) {
    return {
      state: 'progress',
      headline: `Still checking the site · ${coverage.scanned} ${coverage.scanned === 1 ? 'page' : 'pages'} done${coverage.discovered ? ` of ${coverage.discovered} found` : ''}`,
      detail: 'Results below update as each page finishes.',
      note: null,
    };
  }
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
      ? `Other pages were read invisibly without running their scripts, so ${subject} that only JavaScript adds on those pages are not included. The page you are viewing is always checked live.`
      : null;
  return { state, headline, detail, note };
}
