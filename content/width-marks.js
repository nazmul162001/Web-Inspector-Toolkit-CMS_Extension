/**
 * Marks the found characters on the page itself, in white on red.
 *
 * Uses the CSS Custom Highlight API: the page's DOM is NOT changed (no tags
 * are inserted around the text, so scripts, layout, forms and selection keep
 * working) and the marks disappear with one call. The style lives in a
 * constructed stylesheet that exists only while marks are shown.
 */

import { HIGHLIGHT_HOST_ID, SKIPPED_TAGS } from '../shared/constants.js';
import { createWidthMatcher } from '../services/width-matcher.js';

export const MARK_NAME = 'wit-width';
const MAX_RANGES = 20000;
const MARK_CSS = `::highlight(${MARK_NAME}) { background-color: #e11d1d; color: #ffffff; }`;

let sheet = null;

export const marksSupported = () => typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';

/** Remove every mark and the style that draws them. */
export function clearMarks() {
  if (!marksSupported()) return;
  CSS.highlights.delete(MARK_NAME);
  if (sheet) {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((known) => known !== sheet);
    sheet = null;
  }
}

/**
 * Show `ranges` as marks (replaces the previous ones).
 * @param {Range[]} ranges
 * @returns {number} how many ranges are marked
 */
export function showMarks(ranges) {
  clearMarks();
  if (!marksSupported() || ranges.length === 0) return 0;
  sheet = new CSSStyleSheet();
  sheet.replaceSync(MARK_CSS);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  CSS.highlights.set(MARK_NAME, new Highlight(...ranges));
  return ranges.length;
}

/** Text nodes of a document that are page text (not script, style, template or our own overlay). */
export function createTextWalker(doc, root) {
  return doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIPPED_TAGS.has(parent.localName) || parent.closest(`#${HIGHLIGHT_HOST_ID}`)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
}

/** One Range per found run of characters in `doc`. */
export function collectRanges(doc, query, { root = doc.documentElement, limit = MAX_RANGES } = {}) {
  const matcher = createWidthMatcher(query);
  const walker = createTextWalker(doc, root);
  const ranges = [];
  for (let node = walker.nextNode(); node && ranges.length < limit; node = walker.nextNode()) {
    for (const { start, end } of matcher.find(node.nodeValue)) {
      if (ranges.length >= limit) break;
      const range = doc.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      ranges.push(range);
    }
  }
  return ranges;
}

/** Find the characters of `query` in the live page and mark them. @returns {number} marked runs */
export function markPage(query) {
  return showMarks(collectRanges(document, query));
}
