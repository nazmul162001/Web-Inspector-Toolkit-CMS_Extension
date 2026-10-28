/**
 * Half/Full Width Text scan: finds runs of full-width (or half-width)
 * characters in the text of a page.
 *
 * Every text node is searched on its own (a character run never needs to join
 * text across tags), so the result points at the element that holds the text.
 * Works on live documents and on inert parsed documents (Entire Site), because
 * nothing here needs layout. On the live page the found characters can also be
 * marked in red (see width-marks.js) without changing the page.
 */

import { ERR, SCAN_LIMITS } from '../shared/constants.js';
import { createError, throttle, yieldToMain } from '../shared/helpers.js';
import { MAX_CONTEXT_CODES, codeOf, convertWidth, createWidthMatcher } from '../services/width-matcher.js';
import { buildElementRecord, createPathBuilder } from './element-info.js';
import { CONTEXT_ID, registerElement } from './element-registry.js';
import { clearMarks, createTextWalker, marksSupported, showMarks } from './width-marks.js';

const CONTEXT_CHARS = 48;

/** The text of a node as one line, without changing any offset. */
const oneLine = (text) => text.replace(/[\r\n\t\f\v]/g, ' ');

function snippet(text, start, end) {
  const from = Math.max(0, start - CONTEXT_CHARS);
  const to = Math.min(text.length, end + CONTEXT_CHARS);
  return {
    before: text.slice(from, start),
    text: text.slice(start, end),
    after: text.slice(end, to),
    moreBefore: from > 0,
    moreAfter: to < text.length,
  };
}

/**
 * @param {object} params
 * @param {Document} [params.doc]
 * @param {Element}  [params.root]
 * @param {object}   params.target a sanitized width query (services/width-matcher.js)
 * @param {() => boolean} [params.isCancelled]
 * @param {(progress: {scanned:number,total:number,matches:number}) => void} [params.onProgress]
 * @param {number} [params.budgetMs]
 */
export async function scanWidthDocument({
  doc = document,
  root = doc.documentElement,
  target,
  isCancelled = () => false,
  onProgress = () => {},
  budgetMs = SCAN_LIMITS.BATCH_BUDGET_MS,
}) {
  const startedAt = performance.now();
  const checkCancelled = () => {
    if (isCancelled()) throw createError(ERR.CANCELLED, 'Scan cancelled');
  };

  const live = doc === document && !!doc.defaultView;
  if (live) clearMarks(); // a new search replaces the marks of the last one

  const matcher = createWidthMatcher(target);
  const suggestion = target.mode === 'half' ? 'full' : 'half';
  const buildPath = createPathBuilder(doc);
  const total = root.querySelectorAll('*').length + 1;

  const elements = [];
  const matches = [];
  const ranges = [];
  const recordOf = new Map();
  let scanned = 0;
  let truncated = false;
  let sequence = 0;

  const reportProgress = throttle(() => onProgress({ scanned, total, matches: matches.length }), 300);

  function recordFor(element) {
    let record = recordOf.get(element);
    if (!record) {
      record = buildElementRecord(element, { buildPath, elementId: registerElement(element), domIndex: scanned });
      if (!doc.defaultView) record.rendered = null; // parsed documents have no layout
      recordOf.set(element, record);
      elements.push(record);
    }
    return record;
  }

  let lastElement = null;
  function handle(node) {
    const element = node.parentElement;
    if (element !== lastElement) {
      lastElement = element;
      scanned = Math.min(scanned + 1, total); // progress counts elements, like the other tools
    }
    const line = oneLine(node.nodeValue);
    for (const run of matcher.find(line)) {
      if (matches.length >= SCAN_LIMITS.MAX_MATCHES_PER_PAGE) {
        truncated = true;
        return;
      }
      const record = recordFor(element);
      const shown = snippet(line, run.start, run.end);
      const codes = Array.from(new Set(shown.text)).slice(0, MAX_CONTEXT_CODES).map((ch) => `${ch === '\u3000' ? '(ideographic space)' : ch} ${codeOf(ch)}`);
      sequence += 1;
      matches.push({
        elementId: record.elementId,
        seq: sequence,
        kind: 'width',
        kinds: run.kinds,
        ...shown,
        codes,
        replacement: convertWidth(shown.text, suggestion),
        replacementForm: suggestion,
      });
      if (live && target.highlightOnPage && marksSupported()) {
        const range = doc.createRange();
        range.setStart(node, run.start);
        range.setEnd(node, run.end);
        ranges.push(range);
      }
    }
  }

  const walker = createTextWalker(doc, root);
  let sliceStart = performance.now();
  for (let node = walker.nextNode(); node && !truncated; node = walker.nextNode()) {
    handle(node);
    if (performance.now() - sliceStart > budgetMs) {
      reportProgress();
      await yieldToMain();
      checkCancelled();
      sliceStart = performance.now();
    }
  }
  checkCancelled();

  const marked = live && target.highlightOnPage ? showMarks(ranges) : 0;

  return {
    contextId: CONTEXT_ID,
    elements,
    matches,
    truncated,
    marked,
    stats: {
      elementsScanned: scanned,
      durationMs: Math.round(performance.now() - startedAt),
      timings: { walkMs: Math.round(performance.now() - startedAt) },
      stylesheets: { scanned: 0, inaccessible: [], rules: 0 },
    },
  };
}
