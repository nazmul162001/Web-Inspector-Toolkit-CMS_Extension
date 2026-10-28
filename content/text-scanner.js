/**
 * Rendered-DOM text scan (Text Find and Telephone Number).
 *
 * Walks the DOM and searches the TEXT the user reads, not the HTML source:
 *
 *  - Text is searched per "flow": all text of a block element, joined across
 *    inline elements (<b>, <a>, <span> ...). "Hello <b>world</b>" therefore
 *    matches "Hello world", while text in different blocks never merges.
 *  - Each match is attributed to the deepest element that contains all of it.
 *  - Optionally the human-readable attributes (alt, title, placeholder,
 *    aria-label, button values) are searched too.
 *  - Optionally only text that is actually visible is reported. That needs
 *    layout (computed style), so it is only done on request.
 *
 * Works on live documents and on inert parsed documents (Entire Site), because
 * nothing here depends on layout unless `visibleOnly` is on.
 */

import { ERR, HIGHLIGHT_HOST_ID, SCAN_LIMITS, SKIPPED_TAGS } from '../shared/constants.js';
import { createError, throttle, yieldToMain } from '../shared/helpers.js';
import { collapseWhitespace, createTextMatcher } from '../services/text-matcher.js';
import { buildElementRecord, createPathBuilder } from './element-info.js';
import { CONTEXT_ID, registerElement } from './element-registry.js';

/** Elements whose text continues the surrounding sentence. Everything else starts a new flow. */
const INLINE_TAGS = new Set([
  'a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins',
  'kbd', 'label', 'mark', 'q', 'ruby', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt',
  'u', 'var',
]);

/** Furigana and fallback text are not part of the sentence. */
const SKIPPED_IN_FLOW = new Set(['rt', 'rp']);

const BREAK = Symbol('break');
const CONTEXT_CHARS = 48;

const ATTRIBUTES = ['alt', 'title', 'placeholder', 'aria-label'];
const BUTTON_INPUTS = new Set(['button', 'submit', 'reset']);

/** Visible = rendered with a box and not hidden through display / visibility / content-visibility. */
function createVisibilityCheck() {
  const cache = new WeakMap();
  return (element) => {
    if (cache.has(element)) return cache.get(element);
    let visible;
    if (typeof element.checkVisibility === 'function') {
      visible = element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
    } else {
      visible = element.getClientRects().length > 0;
    }
    cache.set(element, visible);
    return visible;
  };
}

/** Text nodes (and breaks) of one flow, in document order. */
function collectFlow(container, out) {
  for (let child = container.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) {
      out.push(child);
    } else if (child.nodeType === 1) {
      const tag = child.localName;
      if (SKIPPED_TAGS.has(tag) || SKIPPED_IN_FLOW.has(tag) || child.id === HIGHLIGHT_HOST_ID) continue;
      if (INLINE_TAGS.has(tag)) collectFlow(child, out);
      else out.push(BREAK); // a block / replaced / form element: handled as its own flow
    }
  }
  return out;
}

/** The text of a flow with collapsed whitespace plus which text node owns which characters. */
function buildFlowText(items) {
  let text = '';
  const segments = []; // { start, end, node }
  for (const item of items) {
    if (item === BREAK) {
      if (text && !text.endsWith(' ')) text += ' ';
      continue;
    }
    let piece = collapseWhitespace(item.nodeValue);
    if (text.endsWith(' ') || text === '') piece = piece.replace(/^ /, '');
    if (!piece) continue;
    segments.push({ start: text.length, end: text.length + piece.length, node: item });
    text += piece;
  }
  return { text, segments };
}

function segmentAt(segments, index) {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (index < segments[mid].start) high = mid - 1;
    else if (index >= segments[mid].end) low = mid + 1;
    else return segments[mid];
  }
  return null;
}

function commonAncestor(a, b) {
  if (a === b) return a;
  const chain = new Set();
  for (let node = a; node; node = node.parentNode) chain.add(node);
  for (let node = b; node; node = node.parentNode) if (chain.has(node)) return node;
  return null;
}

const asElement = (node) => (node && node.nodeType === 1 ? node : node?.parentElement || null);

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
 * Generic flow scan used by Text Find and Telephone Number.
 *
 * @param {object} params
 * @param {Document} [params.doc]
 * @param {Element}  [params.root]
 * @param {() => boolean} [params.isCancelled]
 * @param {(progress: {scanned:number,total:number,matches:number}) => void} [params.onProgress]
 * @param {number} [params.budgetMs]
 * @param {object} spec what to look for
 * @param {{ find: (text: string, limit: number) => {start:number,end:number}[] }} spec.finder
 *        ranges of a (whitespace-collapsed) string
 * @param {(element: Element) => string[]} [spec.attributes] attribute names to search on an element
 * @param {(element: Element) => string|null} [spec.linkValue] a value to search that is not text (tel: links)
 * @param {boolean} [spec.visibleOnly] report only matches inside visible elements
 */
export async function scanFlows(
  {
    doc = document,
    root = doc.documentElement,
    isCancelled = () => false,
    onProgress = () => {},
    budgetMs = SCAN_LIMITS.BATCH_BUDGET_MS,
  },
  { finder, attributes = () => [], linkValue = () => null, visibleOnly = false },
) {
  const startedAt = performance.now();
  const checkCancelled = () => {
    if (isCancelled()) throw createError(ERR.CANCELLED, 'Scan cancelled');
  };

  const buildPath = createPathBuilder(doc);
  const isVisible = visibleOnly ? createVisibilityCheck() : null;
  const total = root.querySelectorAll('*').length + 1;

  const elements = [];
  const matches = [];
  const recordOf = new Map(); // element -> element record
  const textOwners = []; // elements that own a text match (a tel: link whose text already matched is not repeated)
  let scanned = 0;
  let truncated = false;
  let sequence = 0;

  const reportProgress = throttle(() => onProgress({ scanned, total, matches: matches.length }), 300);

  function recordFor(element, domIndex) {
    let record = recordOf.get(element);
    if (!record) {
      record = buildElementRecord(element, { buildPath, elementId: registerElement(element), domIndex });
      // Parsed (never rendered) documents have no layout, so "not rendered" would be a false claim.
      if (!doc.defaultView) record.rendered = null;
      recordOf.set(element, record);
      elements.push(record);
    }
    return record;
  }

  function addMatch(element, domIndex, kind, attribute, shown) {
    if (matches.length >= SCAN_LIMITS.MAX_MATCHES_PER_PAGE) {
      truncated = true;
      return;
    }
    if (isVisible && !isVisible(element)) return;
    const record = recordFor(element, domIndex);
    sequence += 1;
    matches.push({ elementId: record.elementId, seq: sequence, kind, attribute: attribute || null, ...shown });
    if (kind === 'text') textOwners.push(element);
  }

  const room = () => SCAN_LIMITS.MAX_MATCHES_PER_PAGE - matches.length + 1;

  function searchFlow(container, domIndex) {
    const { text, segments } = buildFlowText(collectFlow(container, []));
    if (!text) return;
    for (const { start, end } of finder.find(text, room())) {
      if (truncated) return;
      const first = segmentAt(segments, start) || segments[0];
      const last = segmentAt(segments, end - 1) || first;
      const owner = asElement(commonAncestor(first.node, last.node)) || container;
      addMatch(owner, domIndex, 'text', null, snippet(text, start, end));
    }
  }

  function searchAttributes(element, domIndex) {
    for (const name of attributes(element)) {
      const raw = element.getAttribute(name);
      if (!raw) continue;
      const value = collapseWhitespace(raw).trim();
      for (const { start, end } of finder.find(value, 20)) {
        if (truncated) return;
        addMatch(element, domIndex, 'attribute', name, snippet(value, start, end));
      }
    }
  }

  function searchLink(element, domIndex) {
    const value = linkValue(element);
    if (!value) return;
    // The visible text of this link already matched: one result per place is enough.
    if (textOwners.some((owner) => element.contains(owner) || owner.contains(element))) return;
    for (const { start, end } of finder.find(value, 5)) {
      if (truncated) return;
      addMatch(element, domIndex, 'link', 'href', snippet(value, start, end));
    }
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      return SKIPPED_TAGS.has(node.localName) || node.id === HIGHLIGHT_HOST_ID ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });

  function handle(element) {
    scanned += 1;
    searchAttributes(element, scanned);
    searchLink(element, scanned);
    if (!INLINE_TAGS.has(element.localName)) searchFlow(element, scanned);
  }

  let sliceStart = performance.now();
  if (!SKIPPED_TAGS.has(root.localName)) handle(root);
  let node = walker.nextNode();
  while (node && !truncated) {
    handle(node);
    node = walker.nextNode();
    if (performance.now() - sliceStart > budgetMs) {
      reportProgress();
      await yieldToMain();
      checkCancelled();
      sliceStart = performance.now();
    }
  }
  checkCancelled();

  return {
    contextId: CONTEXT_ID,
    elements,
    matches,
    truncated,
    stats: {
      elementsScanned: scanned,
      durationMs: Math.round(performance.now() - startedAt),
      timings: { walkMs: Math.round(performance.now() - startedAt) },
      stylesheets: { scanned: 0, inaccessible: [], rules: 0 },
    },
  };
}

/**
 * Text Find: `target` is a sanitized text query (see services/text-matcher.js).
 * @param {object} params see scanFlows, plus `target`
 */
export function scanTextDocument({ target, options: _options, ...params }) {
  const matcher = createTextMatcher(target);
  return scanFlows(params, {
    finder: { find: (text, limit) => matcher.find(matcher.fold(text), limit) },
    attributes: target.includeAttributes
      ? (element) =>
          element.localName === 'input' && BUTTON_INPUTS.has((element.getAttribute('type') || '').toLowerCase())
            ? [...ATTRIBUTES, 'value']
            : ATTRIBUTES
      : () => [],
    visibleOnly: target.visibleOnly,
  });
}
