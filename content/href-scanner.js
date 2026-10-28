/**
 * Link (href) scan: finds every element that points to a given address.
 *
 * Always read:
 *   - the `href` of anchors, image-map areas, SVG links and <link> elements
 * With "buttons, forms and click handlers" on:
 *   - `formaction` of buttons/inputs and `action` of forms
 *   - data-href / data-url / data-link ... attributes (what many button widgets use)
 *   - addresses written inside `onclick` (`location.href='/x'`, `window.open('https://...')`)
 *
 * Every value is resolved against the page it is on before it is compared, so
 * relative links work. Works on live documents and on inert parsed documents
 * (Entire Site), because nothing here needs layout.
 */

import { ERR, HIGHLIGHT_HOST_ID, SCAN_LIMITS } from '../shared/constants.js';
import { createError, throttle, yieldToMain } from '../shared/helpers.js';
import { collapseWhitespace } from '../services/text-matcher.js';
import { createHrefMatcher } from '../services/href-matcher.js';
import { buildElementRecord, createPathBuilder } from './element-info.js';
import { CONTEXT_ID, registerElement } from './element-registry.js';

const SKIPPED = new Set(['script', 'style', 'template', 'noscript', 'base']);
/** SVG elements whose href points at a resource inside the page, not at a link. */
const RESOURCE_HREF = new Set(['use', 'image', 'feimage', 'mpath', 'textpath', 'pattern', 'lineargradient', 'radialgradient', 'filter']);
const DATA_ATTRIBUTES = ['data-href', 'data-url', 'data-link', 'data-link-url', 'data-target-url', 'data-redirect-url'];

const MAX_VALUE_CHARS = 1500;
const CONTEXT_CHARS = 60;
const MAX_LABEL_CHARS = 80;

const ABSOLUTE_IN_CODE = /(?:https?:)?\/\/[^\s'"`<>\\)]+/g;
const NAVIGATION_IN_CODE = /(?:location(?:\.href)?\s*=\s*|location\.(?:assign|replace)\(\s*|window\.open\(\s*|open\(\s*)(['"`])(.+?)\1/g;

/** Addresses written inside a click handler. */
export function addressesInCode(code) {
  const found = new Set();
  const text = String(code).slice(0, 2000);
  for (const match of text.matchAll(NAVIGATION_IN_CODE)) found.add(match[2]);
  for (const match of text.matchAll(ABSOLUTE_IN_CODE)) found.add(match[0]);
  return Array.from(found);
}

/** Every link-like value of an element: [{ attribute, value }]. */
export function linkValues(element, includeButtons) {
  const out = [];
  const tag = element.localName;
  if (element.hasAttribute('href') && !RESOURCE_HREF.has(tag)) out.push({ attribute: 'href', value: element.getAttribute('href') });
  if (!includeButtons) return out;

  if (element.hasAttribute('formaction') && (tag === 'button' || tag === 'input')) out.push({ attribute: 'formaction', value: element.getAttribute('formaction') });
  if (tag === 'form' && element.hasAttribute('action')) out.push({ attribute: 'action', value: element.getAttribute('action') });
  for (const name of DATA_ATTRIBUTES) {
    if (element.hasAttribute(name)) out.push({ attribute: name, value: element.getAttribute(name) });
  }
  if (element.hasAttribute('onclick')) {
    for (const value of addressesInCode(element.getAttribute('onclick'))) out.push({ attribute: 'onclick', value });
  }
  return out;
}

/** What a person would call this link: its text, or aria-label / title / image alt / button value. */
function labelOf(element) {
  const text = collapseWhitespace(element.textContent || '').trim();
  const fallback =
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    element.querySelector?.('img[alt]')?.getAttribute('alt') ||
    (element.localName === 'input' ? element.getAttribute('value') : '') ||
    '';
  const label = collapseWhitespace(text || fallback).trim();
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS)}…` : label;
}

function snippet(value, start, end) {
  const from = Math.max(0, start - CONTEXT_CHARS);
  const to = Math.min(value.length, end + CONTEXT_CHARS);
  return {
    before: value.slice(from, start),
    text: value.slice(start, end),
    after: value.slice(end, to),
    moreBefore: from > 0,
    moreAfter: to < value.length,
  };
}

/**
 * @param {object} params
 * @param {Document} [params.doc]
 * @param {Element}  [params.root]
 * @param {object}   params.target a sanitized href query (services/href-matcher.js)
 * @param {() => boolean} [params.isCancelled]
 * @param {(progress: {scanned:number,total:number,matches:number}) => void} [params.onProgress]
 * @param {number} [params.budgetMs]
 */
export async function scanHrefDocument({
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

  const matcher = createHrefMatcher(target);
  const baseUrl = doc.baseURI || doc.URL;
  const buildPath = createPathBuilder(doc);
  const total = root.querySelectorAll('*').length + 1;

  const elements = [];
  const matches = [];
  const recordOf = new Map();
  let scanned = 0;
  let truncated = false;
  let sequence = 0;

  const reportProgress = throttle(() => onProgress({ scanned, total, matches: matches.length }), 300);

  function recordFor(element) {
    let record = recordOf.get(element);
    if (!record) {
      record = buildElementRecord(element, { buildPath, elementId: registerElement(element), domIndex: scanned });
      // Parsed (never rendered) documents have no layout, so "not rendered" would be a false claim.
      if (!doc.defaultView) record.rendered = null;
      recordOf.set(element, record);
      elements.push(record);
    }
    return record;
  }

  function handle(element) {
    scanned += 1;
    const seen = new Set();
    for (const { attribute, value } of linkValues(element, target.includeButtons)) {
      if (!value) continue;
      const raw = value.length > MAX_VALUE_CHARS ? value.slice(0, MAX_VALUE_CHARS) : value;
      const key = `${attribute}\n${raw}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const hit = matcher.test(raw, baseUrl);
      if (!hit) continue;
      if (matches.length >= SCAN_LIMITS.MAX_MATCHES_PER_PAGE) {
        truncated = true;
        return;
      }
      const record = recordFor(element);
      sequence += 1;
      matches.push({
        elementId: record.elementId,
        seq: sequence,
        kind: 'href',
        attribute,
        ...snippet(raw, hit.start, hit.end),
        resolved: hit.resolved,
        label: labelOf(element),
      });
    }
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => (SKIPPED.has(node.localName) || node.id === HIGHLIGHT_HOST_ID ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });

  let sliceStart = performance.now();
  if (!SKIPPED.has(root.localName)) handle(root);
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
