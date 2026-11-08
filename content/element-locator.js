/**
 * Find a scanned element in the live page. Entire Site paths come from fetched
 * HTML (no scripts), so `querySelector(path)` often misses the live DOM.
 * Fall back to a relaxed path, then to the match text / tel: link / href.
 */

import { HIGHLIGHT_HOST_ID, SKIPPED_TAGS } from '../shared/constants.js';
import { CONTEXT_ID, lookupRegisteredElement } from './element-registry.js';
import { classifySection } from './element-info.js';

function visible(element) {
  return !!element?.getClientRects?.().length;
}

function digitsOf(text) {
  let out = '';
  for (const ch of String(text || '')) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) out += ch;
    else if (code >= 0xff10 && code <= 0xff19) out += String(code - 0xff10);
  }
  return out;
}

function queryOne(selector, tag) {
  try {
    const node = document.querySelector(selector);
    if (node && (!tag || node.localName === tag) && node.id !== HIGHLIGHT_HOST_ID) return node;
  } catch {
    /* invalid selector */
  }
  return null;
}

/** Drop `:nth-of-type(n)` from the right until a unique (or tagged) node remains. */
function byRelaxedPath(path, tag) {
  if (!path) return null;
  const hit = queryOne(path, tag);
  if (hit) return hit;
  const parts = String(path).split(' > ');
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (!/:nth-of-type\(\d+\)$/.test(parts[i])) continue;
    const next = parts.slice();
    next[i] = next[i].replace(/:nth-of-type\(\d+\)$/, '');
    const selector = next.join(' > ');
    try {
      const nodes = [...document.querySelectorAll(selector)].filter(
        (node) => (!tag || node.localName === tag) && node.id !== HIGHLIGHT_HOST_ID,
      );
      if (nodes.length === 1) return nodes[0];
      const shown = nodes.filter(visible);
      if (shown.length === 1) return shown[0];
    } catch {
      /* keep relaxing */
    }
  }
  return null;
}

const esc = (value) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value));

function byReadableSelector(hint, tag) {
  const id = hint?.id ? `#${esc(hint.id)}` : '';
  const classes = (hint?.classes || []).slice(0, 3).map((name) => `.${esc(name)}`).join('');
  const selector = `${tag || ''}${id}${classes}`;
  if (!id && !classes) return null;
  try {
    const nodes = [...document.querySelectorAll(selector || tag)].filter((node) => node.id !== HIGHLIGHT_HOST_ID);
    if (!nodes.length) return null;
    if (nodes.length === 1) return nodes[0];
    const sectioned = hint?.section ? nodes.filter((node) => classifySection(node) === hint.section) : nodes;
    const pool = sectioned.length ? sectioned : nodes;
    const shown = pool.filter(visible);
    return (shown[0] || pool[0]) ?? null;
  } catch {
    return null;
  }
}

function pushUnique(list, seen, node) {
  if (!node || node.nodeType !== 1 || seen.has(node) || SKIPPED_TAGS.has(node.localName) || node.id === HIGHLIGHT_HOST_ID) return;
  seen.add(node);
  list.push(node);
}

function byHint(hint, tag) {
  if (!hint || typeof hint !== 'object') return null;
  const candidates = [];
  const seen = new WeakSet();
  const digits = hint.digits || (hint.kind === 'phone' ? digitsOf(hint.text) : '');
  const text = String(hint.text || '');

  if (digits.length >= 4) {
    let telLinks = [];
    try {
      telLinks = document.querySelectorAll('a[href^="tel:" i], area[href^="tel:" i]');
    } catch {
      telLinks = document.querySelectorAll('a[href^="tel:"], a[href^="TEL:"], area[href^="tel:"], area[href^="TEL:"]');
    }
    for (const link of telLinks) {
      if (digitsOf(link.getAttribute('href')).includes(digits)) pushUnique(candidates, seen, link);
    }
  }

  if (hint.resolved || hint.kind === 'href' || hint.attribute === 'href') {
    const wanted = hint.resolved || text;
    if (wanted) {
      for (const node of document.querySelectorAll('[href], [action], [formaction]')) {
        const raw = node.getAttribute('href') || node.getAttribute('action') || node.getAttribute('formaction') || '';
        if (raw === text || raw === wanted) {
          pushUnique(candidates, seen, node);
          continue;
        }
        try {
          if (hint.resolved && new URL(raw, document.baseURI).href === hint.resolved) pushUnique(candidates, seen, node);
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (text || digits.length >= 4) {
    const root = document.body || document.documentElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIPPED_TAGS.has(parent.localName) || parent.closest(`#${HIGHLIGHT_HOST_ID}`)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node = walker.nextNode();
    while (node) {
      const value = node.nodeValue || '';
      const parent = node.parentElement;
      if (text && value.includes(text)) pushUnique(candidates, seen, parent);
      else if (digits.length >= 4 && digitsOf(parent?.textContent).includes(digits)) pushUnique(candidates, seen, parent);
      node = walker.nextNode();
    }
  }

  if (!candidates.length) return null;

  const rank = (element) => {
    let score = 0;
    if (visible(element)) score += 8;
    if (tag && element.localName === tag) score += 4;
    if (hint.section && classifySection(element) === hint.section) score += 6;
    if (hint.id && element.id === hint.id) score += 5;
    if ((hint.classes || []).some((name) => element.classList.contains(name))) score += 2;
    if (digits.length >= 4 && (element.localName === 'a' || element.localName === 'area') && /^tel:/i.test(element.getAttribute('href') || '')) {
      score += 3;
    }
    const size = (element.textContent || '').length;
    score -= Math.min(6, Math.floor(Math.log10(size + 1)));
    return score;
  };

  candidates.sort((a, b) => rank(b) - rank(a) || (a.textContent?.length || 0) - (b.textContent?.length || 0));
  return candidates[0] || null;
}

/**
 * @param {{ elementId?: number, contextId?: string, path?: string, tag?: string, hint?: object }} locator
 * @returns {Element|null}
 */
export function locateElement({ elementId, contextId, path, tag, hint } = {}) {
  if (elementId && contextId === CONTEXT_ID) {
    const remembered = lookupRegisteredElement(elementId);
    if (remembered) return remembered;
  }
  return byRelaxedPath(path, tag) || byReadableSelector(hint, tag) || byHint(hint, tag);
}
