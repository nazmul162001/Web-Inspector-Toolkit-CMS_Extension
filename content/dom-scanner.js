/**
 * Rendered-DOM color scan.
 *
 * Walks the live DOM with a TreeWalker (never the raw HTML), asks the style
 * scanner which color properties match, and enriches each match with element
 * details and CSS source information.
 *
 * Performance notes
 *  - Work is time-sliced: after BATCH_BUDGET_MS the scanner yields through a
 *    MessageChannel task (not throttled in background tabs) so the page stays
 *    responsive and cancellation can be observed.
 *  - One getComputedStyle() per element (cached in the style scanner), colors
 *    parsed once per distinct value (cached in the matcher).
 *  - Element records are built once per matched element and shared by all of
 *    its matches; the result is {elements[], matches[]} instead of repeating
 *    element data per property.
 */

import { COLOR_PROPERTIES, ERR, HIGHLIGHT_HOST_ID, SCAN_LIMITS, SKIPPED_TAGS } from '../shared/constants.js';
import { createError, throttle, uid, yieldToMain } from '../shared/helpers.js';
import { alphaToNumber, toHex } from '../services/color-normalizer.js';
import { createColorMatcher } from '../services/color-matcher.js';
import { buildElementRecord, createPathBuilder } from './element-info.js';
import { createStyleScanner } from './style-scanner.js';
import { buildStylesheetIndex, createSourceResolver, resolveSourceLines } from './stylesheet-scanner.js';

const DESCRIPTORS = new Map(COLOR_PROPERTIES.map((d) => [d.property, d]));

/** Registry so highlight requests can find elements again (WeakRefs: no leaks). */
/** Identifies this content-script lifetime; element ids are only valid within it. */
export const CONTEXT_ID = uid('ctx');

const elementRegistry = new Map();
let nextElementId = 1;

export function lookupRegisteredElement(elementId) {
  const element = elementRegistry.get(elementId)?.deref();
  return element && element.isConnected ? element : null;
}

/**
 * @param {object} params
 * @param {Document} [params.doc]
 * @param {Element}  [params.root]      subtree to scan (default: <html>)
 * @param {{r:number,g:number,b:number,a:number}} params.target
 * @param {{ tolerance?: number, includeInherited?: boolean, collectLinks?: boolean, withSources?: boolean }} [params.options]
 * @param {() => boolean} [params.isCancelled]
 * @param {(progress: {scanned:number,total:number,matches:number}) => void} [params.onProgress]
 */
export async function scanDocument({
  doc = document,
  root = doc.documentElement,
  target,
  options = {},
  isCancelled = () => false,
  onProgress = () => {},
}) {
  const startedAt = performance.now();
  const { tolerance = 0, includeInherited = false, withSources = true } = options;
  const checkCancelled = () => {
    if (isCancelled()) throw createError(ERR.CANCELLED, 'Scan cancelled');
  };

  const matcher = createColorMatcher(target, { tolerance });
  const styleScanner = createStyleScanner({ matcher, includeInherited, view: doc.defaultView });
  const buildPath = createPathBuilder(doc);
  const total = root.querySelectorAll('*').length + 1;

  const index = withSources
    ? await buildStylesheetIndex(doc, { isCancelled })
    : { byProperty: new Map(), inaccessible: [], sheetCount: 0, ruleCount: 0 };
  checkCancelled();
  const resolver = createSourceResolver({ index, styleOf: styleScanner.styleOf, matcher });

  const elements = [];
  const matches = [];
  let truncated = false;
  let scanned = 0;
  let domIndex = 0;

  const reportProgress = throttle(() => onProgress({ scanned, total, matches: matches.length }), 300);

  function handleElement(element) {
    domIndex += 1;
    scanned += 1;
    const hits = styleScanner.scanElement(element);
    if (hits.length === 0) return;

    const elementId = nextElementId;
    nextElementId += 1;
    elementRegistry.set(elementId, new WeakRef(element));
    elements.push(buildElementRecord(element, { buildPath, elementId, domIndex }));

    for (const hit of hits) {
      if (matches.length >= SCAN_LIMITS.MAX_MATCHES_PER_PAGE) {
        truncated = true;
        return;
      }
      const resolved = withSources
        ? resolver.resolve(element, DESCRIPTORS.get(hit.property))
        : { source: null, status: 'not-found' };
      const first = hit.matches[0].color;
      matches.push({
        elementId,
        property: hit.property,
        group: hit.group,
        computed: hit.computed,
        color: { hex: toHex(first), alpha: alphaToNumber(first.a), rgba: first },
        matchedValues: hit.matches.map((m) => m.raw),
        source: resolved.source,
        sourceStatus: resolved.status,
      });
    }
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      return SKIPPED_TAGS.has(node.localName) || node.id === HIGHLIGHT_HOST_ID
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  let sliceStart = performance.now();
  if (!SKIPPED_TAGS.has(root.localName)) handleElement(root);
  let node = walker.nextNode();
  while (node && !truncated) {
    handleElement(node);
    node = walker.nextNode();
    if (performance.now() - sliceStart > SCAN_LIMITS.BATCH_BUDGET_MS) {
      reportProgress();
      await yieldToMain();
      checkCancelled();
      sliceStart = performance.now();
    }
  }

  if (withSources && resolver.pendingLines.length) {
    await resolveSourceLines(resolver.pendingLines, { isCancelled });
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
      stylesheets: {
        scanned: index.sheetCount,
        inaccessible: index.inaccessible,
        rules: index.ruleCount,
      },
    },
  };
}

/**
 * Collect hrefs of anchors in the rendered DOM (including JS-generated ones).
 * Returns absolute URLs; the service worker normalizes and filters them.
 */
export function collectLinks(doc = document, limit = SCAN_LIMITS.MAX_LINKS_PER_PAGE) {
  const hrefs = new Set();
  for (const anchor of doc.querySelectorAll('a[href], area[href]')) {
    if (anchor.hasAttribute('download')) continue;
    const raw = anchor.getAttribute('href');
    if (!raw) continue;
    try {
      hrefs.add(new URL(raw, doc.baseURI).href);
    } catch {
      /* ignore unparsable href */
    }
    if (hrefs.size >= limit) break;
  }
  return Array.from(hrefs);
}
