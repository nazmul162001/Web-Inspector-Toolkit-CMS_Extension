/**
 * Pure data helpers for Text Find results: flattening a scan response into
 * items, summary numbers, sorting, grouping. No DOM.
 */

import { SECTION_LABELS, SECTION_ORDER } from '../../../shared/constants.js';

/** One item per match (a piece of text or an attribute value). */
export function flattenTextResult(scan) {
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
        order: [pageIndex, match.seq ?? matchIndex],
      });
    });
  });
  return items;
}

export function buildTextSummary(items) {
  const elements = new Set();
  const sections = new Set();
  const pages = new Set();
  let inAttributes = 0;
  for (const item of items) {
    elements.add(`${item.pageIndex}:${item.element.elementId}`);
    sections.add(item.element.location.section);
    pages.add(item.pageIndex);
    if (item.match.kind === 'attribute') inAttributes += 1;
  }
  return { matches: items.length, elements: elements.size, sections: sections.size, pages: pages.size, inAttributes };
}

const compareOrder = (a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1];

/** @param {'dom'|'tag'} mode */
export function sortTextItems(items, mode = 'dom') {
  const sorted = [...items];
  if (mode === 'tag') return sorted.sort((a, b) => a.element.tag.localeCompare(b.element.tag) || compareOrder(a, b));
  return sorted.sort(compareOrder);
}

/**
 * @param {object[]} items already filtered + sorted
 * @param {'section'|'tag'|'none'} mode
 */
export function groupTextItems(items, mode) {
  if (mode === 'none') return [{ id: 'all', label: 'All matches', items }];

  const groups = new Map();
  for (const item of items) {
    const id = mode === 'section' ? item.element.location.section : item.element.tag;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(item);
  }
  const ids = mode === 'section' ? SECTION_ORDER.filter((id) => groups.has(id)) : Array.from(groups.keys()).sort();
  return ids.map((id) => ({
    id,
    label: mode === 'section' ? SECTION_LABELS[id] || id : `<${id}>`,
    items: groups.get(id),
  }));
}

/** "…before **match** after…" as plain text, for copying. */
export function contextText(match) {
  return `${match.moreBefore ? '…' : ''}${match.before}${match.text}${match.after}${match.moreAfter ? '…' : ''}`;
}
