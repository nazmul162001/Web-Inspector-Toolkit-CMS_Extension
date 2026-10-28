/**
 * Font Find scan: which elements ask for a given font family.
 *
 * Reads the computed `font-family` list of every element (the browser has
 * already applied the cascade, inheritance, shorthands and variables), keeps
 * the elements whose list contains the typed family, and enriches each with
 * its position in the list, the web font behind it (@font-face / Google
 * Fonts, when readable) and the CSS declaration that asks for it.
 *
 * By default an element is reported where the font is APPLIED: its list differs
 * from its parent's. "Also elements that inherit it" additionally reports
 * every element that has its own text and inherits the same list.
 *
 * What it cannot know: whether the visitor's browser really had the font (a
 * page cannot see that). The result says what the CSS asks for.
 */

import { ERR, HIGHLIGHT_HOST_ID, SCAN_LIMITS, SKIPPED_TAGS } from '../shared/constants.js';
import { createError, throttle, yieldToMain } from '../shared/helpers.js';
import { createFontMatcher, foldFamily, googleFontFamilies, splitFontStack } from '../services/font-matcher.js';
import { stylesheetSignature } from './dom-scanner.js';
import { buildElementRecord, createPathBuilder } from './element-info.js';
import { CONTEXT_ID, registerElement } from './element-registry.js';
import { createFontSourceResolver, fontCovered } from './font-source.js';
import { buildStylesheetIndex, resolveSourceLines } from './stylesheet-scanner.js';

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', 'emoji', 'math', 'fangsong',
]);
const CONTROLS = new Set(['input', 'textarea', 'select', 'button', 'option']);
const MAX_STACK_NAMES = 20;
const MAX_FACE_FILES = 6;

/** Does the element show text of its own (not just through its children)? */
function hasOwnText(element) {
  if (CONTROLS.has(element.localName)) return true;
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 && child.nodeValue.trim()) return true;
  }
  return false;
}

/**
 * @param {object} params
 * @param {Document} [params.doc]
 * @param {Element}  [params.root]
 * @param {object}   params.target a sanitized font query (services/font-matcher.js)
 * @param {{ withSources?: boolean }} [params.options]
 * @param {() => boolean} [params.isCancelled]
 * @param {(progress: {scanned:number,total:number,matches:number}) => void} [params.onProgress]
 * @param {object} [params.shared] caches reused between the pages of one crawl (see scanDocument)
 * @param {number} [params.budgetMs]
 */
export async function scanFontDocument({
  doc = document,
  root = doc.documentElement,
  target,
  options = {},
  isCancelled = () => false,
  onProgress = () => {},
  shared = null,
  budgetMs = SCAN_LIMITS.BATCH_BUDGET_MS,
}) {
  const startedAt = performance.now();
  const timings = {};
  const { withSources = true } = options;
  const checkCancelled = () => {
    if (isCancelled()) throw createError(ERR.CANCELLED, 'Scan cancelled');
  };

  const matcher = createFontMatcher(target);
  const view = doc.defaultView;
  const buildPath = createPathBuilder(doc);
  const total = root.querySelectorAll('*').length + 1;

  let mark = performance.now();
  const lap = (name) => {
    const now = performance.now();
    timings[name] = Math.round(now - mark);
    mark = now;
  };

  /* ---- stylesheets: rules (sources) and @font-face (files) */
  const indexOptions = { isCancelled, covered: fontCovered, fontFaces: true };
  let index;
  if (shared) {
    const signature = `font|${stylesheetSignature(doc)}`;
    if (!shared.indexes.has(signature)) shared.indexes.set(signature, buildStylesheetIndex(doc, indexOptions));
    try {
      index = await shared.indexes.get(signature);
    } catch (error) {
      shared.indexes.delete(signature);
      throw error;
    }
  } else {
    index = await buildStylesheetIndex(doc, indexOptions);
  }
  checkCancelled();
  lap('indexMs');

  const googleFamilies = new Set();
  for (const node of doc.querySelectorAll('link[href], style[data-wit-href]')) {
    for (const name of googleFontFamilies(node.getAttribute('data-wit-href') || node.getAttribute('href'))) googleFamilies.add(foldFamily(name));
  }

  const styleCache = new WeakMap();
  const styleOf = (element) => {
    let style = styleCache.get(element);
    if (!style) {
      style = view.getComputedStyle(element);
      styleCache.set(element, style);
    }
    return style;
  };
  const resolver = withSources ? createFontSourceResolver({ index, styleOf, matcher }) : null;

  /** One answer per distinct font-family value: most elements share a handful of lists. */
  const byValue = new Map();
  function analyse(value) {
    let entry = byValue.get(value);
    if (!entry) {
      const stack = splitFontStack(value);
      entry = { stack: stack.slice(0, MAX_STACK_NAMES), hit: matcher.match(stack) };
      byValue.set(value, entry);
    }
    return entry;
  }

  /** Where the matched font comes from, as far as the readable CSS tells. */
  const faceCache = new Map();
  function faceOf(name) {
    const key = foldFamily(name);
    if (faceCache.has(key)) return faceCache.get(key);
    const rules = index.fontFaces.get(key) || [];
    const files = [];
    for (const rule of rules) {
      for (const file of rule.files) {
        if (files.length < MAX_FACE_FILES && !files.some((known) => known.url === file.url)) {
          files.push({ url: file.url, format: file.format, weight: rule.weight, style: rule.style });
        }
      }
    }
    let status;
    if (rules.length) status = 'font-face';
    else if (googleFamilies.has(key)) status = 'google-fonts';
    else if (GENERIC_FAMILIES.has(key)) status = 'generic';
    else status = index.inaccessible.length > 0 ? 'unreadable' : 'none';
    const face = {
      name,
      status,
      google: googleFamilies.has(key),
      files,
      stylesheetLabel: rules[0]?.stylesheetLabel || null,
    };
    faceCache.set(key, face);
    return face;
  }

  const elements = [];
  const matches = [];
  let truncated = false;
  let scanned = 0;
  let domIndex = 0;

  const reportProgress = throttle(() => onProgress({ scanned, total, matches: matches.length }), 300);

  function handleElement(element) {
    domIndex += 1;
    scanned += 1;
    const value = styleOf(element).getPropertyValue('font-family').trim();
    if (!value) return;
    const { stack, hit } = analyse(value);
    if (!hit) return;

    const parent = element.parentElement;
    const inherited = !!parent && styleOf(parent).getPropertyValue('font-family').trim() === value;
    if (inherited && !(target.includeInherited && hasOwnText(element))) return;

    if (matches.length >= SCAN_LIMITS.MAX_MATCHES_PER_PAGE) {
      truncated = true;
      return;
    }
    const elementId = registerElement(element);
    elements.push(buildElementRecord(element, { buildPath, elementId, domIndex }));
    const resolved = resolver ? resolver.resolve(element) : { source: null, status: 'not-found' };
    matches.push({
      elementId,
      kind: 'font',
      property: 'font-family',
      computed: value,
      families: stack,
      matched: hit.matched,
      position: hit.position,
      inherited,
      face: faceOf(hit.matched[0]),
      source: resolved.source,
      sourceStatus: resolved.status,
    });
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => (SKIPPED_TAGS.has(node.localName) || node.id === HIGHLIGHT_HOST_ID ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });

  let sliceStart = performance.now();
  if (!SKIPPED_TAGS.has(root.localName)) handleElement(root);
  let node = walker.nextNode();
  while (node && !truncated) {
    handleElement(node);
    node = walker.nextNode();
    if (performance.now() - sliceStart > budgetMs) {
      reportProgress();
      await yieldToMain();
      checkCancelled();
      sliceStart = performance.now();
    }
  }
  lap('walkMs');

  if (resolver?.pendingLines.length) {
    await resolveSourceLines(resolver.pendingLines, {
      isCancelled,
      texts: shared?.lineTexts,
      results: shared?.lineResults,
      ...(shared?.fetchText ? { fetchText: shared.fetchText } : {}),
    });
  }
  checkCancelled();
  lap('linesMs');

  return {
    contextId: CONTEXT_ID,
    elements,
    matches,
    truncated,
    stats: {
      elementsScanned: scanned,
      durationMs: Math.round(performance.now() - startedAt),
      timings,
      stylesheets: {
        scanned: index.sheetCount,
        inaccessible: [...index.inaccessible],
        rules: index.ruleCount,
      },
    },
  };
}
