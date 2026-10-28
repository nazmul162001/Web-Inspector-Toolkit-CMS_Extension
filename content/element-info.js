/**
 * Element description for scan results: readable selector, unique path,
 * safe description, section classification and ancestry.
 *
 * Everything here reads the DOM only; nothing is modified.
 */

import { SCAN_LIMITS, SECTION } from '../shared/constants.js';
import { truncate } from '../shared/helpers.js';

const esc = (value) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value));

const MAX_CLASSES_IN_SELECTOR = 3;
const MAX_CLASS_LENGTH = 60;

/* ------------------------------------------------------------- Selectors */

export function getClasses(element) {
  const list = element.classList ? Array.from(element.classList) : [];
  return list.slice(0, 12).map((name) => truncate(name, MAX_CLASS_LENGTH));
}

/** `tag#id.class1.class2` - short and human friendly (not guaranteed unique). */
export function getReadableSelector(element) {
  let selector = element.localName;
  if (element.id) selector += `#${esc(element.id)}`;
  const classes = getClasses(element).slice(0, MAX_CLASSES_IN_SELECTOR);
  for (const name of classes) selector += `.${esc(name)}`;
  return selector;
}

/**
 * Creates a function producing a selector path that is unique in the document:
 * `#stable-id > div:nth-of-type(2) > a`. Sibling indexes are computed once per
 * parent so wide lists stay O(n), and duplicate ids are never trusted.
 */
export function createPathBuilder(doc = document) {
  const duplicateIds = new Set();
  const seenIds = new Set();
  for (const node of doc.querySelectorAll('[id]')) {
    if (seenIds.has(node.id)) duplicateIds.add(node.id);
    seenIds.add(node.id);
  }

  const indexCache = new WeakMap(); // element -> { n, total }

  function typeIndex(element) {
    let entry = indexCache.get(element);
    if (entry) return entry;
    const parent = element.parentElement;
    if (!parent) {
      entry = { n: 1, total: 1 };
      indexCache.set(element, entry);
      return entry;
    }
    const counters = new Map();
    const siblings = [];
    for (const sibling of parent.children) {
      const key = `${sibling.namespaceURI}|${sibling.localName}`;
      const n = (counters.get(key) || 0) + 1;
      counters.set(key, n);
      siblings.push({ sibling, key, n });
    }
    for (const { sibling, key, n } of siblings) {
      indexCache.set(sibling, { n, total: counters.get(key) });
    }
    return indexCache.get(element);
  }

  return function buildPath(element) {
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1) {
      if (node === doc.documentElement) {
        parts.unshift(node.localName);
        break;
      }
      if (node.id && !duplicateIds.has(node.id)) {
        parts.unshift(`#${esc(node.id)}`);
        break;
      }
      const { n, total } = typeIndex(node);
      parts.unshift(total > 1 ? `${node.localName}:nth-of-type(${n})` : node.localName);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
}

/* -------------------------------------------------------------- Describe */

const NO_TEXT_TAGS = new Set(['input', 'textarea', 'select', 'option']);

function ownTextSnippet(element) {
  if (NO_TEXT_TAGS.has(element.localName) || element.isContentEditable) return '';
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3) {
      text += node.nodeValue;
      if (text.length > 200) break;
    }
  }
  return truncate(text.replace(/\s+/g, ' ').trim(), SCAN_LIMITS.MAX_TEXT_SNIPPET_LENGTH);
}

function shortHref(element) {
  const raw = element.getAttribute('href');
  if (!raw) return '';
  try {
    const url = new URL(raw, element.ownerDocument.baseURI);
    const sameOrigin = url.origin === new URL(element.ownerDocument.baseURI).origin;
    return truncate(sameOrigin ? url.pathname : `${url.host}${url.pathname}`, 48);
  } catch {
    return '';
  }
}

/**
 * Privacy-conscious one-line description: tag plus a handful of structural
 * attributes. Form values, passwords and long attribute payloads are never
 * included; length is capped.
 */
export function describeElementSafely(element) {
  const attrs = [];
  const add = (name, value) => {
    if (value) attrs.push(`${name}="${truncate(String(value).replace(/"/g, "'"), 40)}"`);
  };
  add('id', element.id);
  const classes = getClasses(element);
  if (classes.length) add('class', classes.slice(0, 4).join(' '));
  add('role', element.getAttribute('role'));
  if (element.localName === 'input') add('type', element.getAttribute('type'));
  add('name', element.getAttribute('name'));
  add('aria-label', element.getAttribute('aria-label'));
  add('href', shortHref(element));

  const open = `<${element.localName}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
  const text = ownTextSnippet(element);
  return truncate(text ? `${open} ${text}` : open, SCAN_LIMITS.MAX_DESCRIPTION_LENGTH);
}

function descriptor(element) {
  return {
    tag: element.localName,
    id: element.id || '',
    classes: getClasses(element),
    selector: getReadableSelector(element),
  };
}

/* ---------------------------------------------------------------- Section */

const SECTION_CONTAINER = 'article,aside,main,nav,section,[role="main"]';

const NAME_HINTS = {
  [SECTION.HEADER]: new Set(['header', 'site-header', 'page-header', 'main-header', 'masthead', 'topbar', 'top-bar', 'navbar', 'top-nav']),
  [SECTION.FOOTER]: new Set(['footer', 'site-footer', 'page-footer', 'main-footer', 'colophon']),
  [SECTION.MAIN]: new Set(['main', 'content', 'main-content', 'page-content', 'site-content', 'primary']),
};

function landmarkOf(element) {
  const role = element.getAttribute('role');
  if (role === 'banner') return SECTION.HEADER;
  if (role === 'contentinfo') return SECTION.FOOTER;
  if (role === 'main') return SECTION.MAIN;
  switch (element.localName) {
    case 'main':
      return SECTION.MAIN;
    case 'header':
      // A <header> inside article/section/main is a heading, not the site banner.
      return element.parentElement && element.parentElement.closest(SECTION_CONTAINER) ? null : SECTION.HEADER;
    case 'footer':
      return element.parentElement && element.parentElement.closest(SECTION_CONTAINER) ? null : SECTION.FOOTER;
    default:
      return null;
  }
}

function hintOf(element) {
  const tokens = [element.id, ...(element.classList ? element.classList : [])]
    .filter(Boolean)
    .map((token) => token.toLowerCase());
  for (const kind of [SECTION.HEADER, SECTION.FOOTER, SECTION.MAIN]) {
    if (tokens.some((token) => NAME_HINTS[kind].has(token))) return kind;
  }
  return null;
}

/**
 * Header / Main Content / Footer / Other. Semantic landmarks win; the
 * outermost landmark decides (so an <article><header> inside <main> is Main).
 * Class/id name hints are a fallback for sites without landmarks.
 */
export function classifySection(element, doc = document) {
  let semantic = null;
  let hinted = null;
  for (let node = element; node && node !== doc.documentElement; node = node.parentElement) {
    const landmark = landmarkOf(node);
    if (landmark) semantic = landmark;
    else {
      const hint = hintOf(node);
      if (hint) hinted = hint;
    }
  }
  return semantic || hinted || SECTION.OTHER;
}

const NAMED_CONTAINERS = 'section,article,aside,nav,form,header,footer,main,[role="region"],[role="navigation"],[role="banner"],[role="contentinfo"]';
const headingCache = new WeakMap();

function containerLabel(container) {
  if (headingCache.has(container)) return headingCache.get(container);
  let label = container.getAttribute('aria-label') || '';
  if (!label) {
    const labelledBy = container.getAttribute('aria-labelledby');
    const source = labelledBy && container.ownerDocument.getElementById(labelledBy.split(/\s+/)[0]);
    label = source ? source.textContent : '';
  }
  if (!label) {
    const heading = container.querySelector('h1,h2,h3,h4');
    label = heading ? heading.textContent : '';
  }
  label = truncate(label.replace(/\s+/g, ' ').trim(), 48);
  headingCache.set(container, label);
  return label;
}

/** Nearest named structural container, e.g. `section#pricing - "Plans"`. */
export function getSectionName(element) {
  const container = element.closest(NAMED_CONTAINERS);
  if (!container) return '';
  const label = containerLabel(container);
  const id = container.id ? `#${container.id}` : '';
  const base = `${container.localName}${id}`;
  return label ? `${base} - "${label}"` : base;
}

/* -------------------------------------------------------------- Location */

const MEANINGFUL_TAGS = new Set([
  'header', 'footer', 'nav', 'main', 'section', 'article', 'aside', 'form',
  'ul', 'ol', 'dl', 'table', 'figure', 'dialog', 'button', 'a', 'li',
]);

/** Nearest ancestor that carries an id, classes or structural meaning. */
export function findMeaningfulParent(element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node.localName === 'html') break;
    if (node.id || node.classList.length || MEANINGFUL_TAGS.has(node.localName) || node.localName === 'body') {
      return descriptor(node);
    }
  }
  return null;
}

/** Up to `limit` nearest ancestors that have an id or classes. */
export function collectAncestors(element, limit = 5) {
  const result = [];
  for (let node = element.parentElement; node && result.length < limit; node = node.parentElement) {
    if (node.localName === 'html' || node.localName === 'body') break;
    if (node.id || node.classList.length) result.push(getReadableSelector(node));
  }
  return result;
}

/**
 * Whole element record for results. `rendered` is true/false for elements
 * that normally own a box, or null for non-rendered SVG resources.
 */
export function buildElementRecord(element, { buildPath, elementId, domIndex }) {
  const rects = element.getClientRects();
  const isSvgResource = element.namespaceURI?.endsWith('/svg') && !rects.length &&
    /^(stop|fe[a-z]+|lineargradient|radialgradient|filter|clippath|mask|pattern|symbol|marker)$/i.test(element.localName);
  return {
    elementId,
    domIndex,
    ...descriptor(element),
    path: buildPath(element),
    description: describeElementSafely(element),
    rendered: isSvgResource ? null : rects.length > 0,
    location: {
      section: classifySection(element),
      sectionName: getSectionName(element),
      parent: findMeaningfulParent(element),
      ancestors: collectAncestors(element),
    },
  };
}
