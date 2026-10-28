/**
 * Applies the interface language to what the side panel shows.
 *
 * Text and a few attributes (placeholder, title, aria-label) are translated in
 * place, and the English original is remembered per node, so switching back to
 * English is exact and nothing has to be rebuilt: search results, scroll
 * position and typed text stay as they are. A MutationObserver translates what
 * the tools add later (results, notices, errors).
 *
 * Page data is never translated: code, snippets and anything marked
 * `data-i18n-skip` are left alone.
 */

import { getLanguage, normalizeLanguage, setLanguage, translate } from '../services/i18n.js';

const ATTRIBUTES = ['placeholder', 'title', 'aria-label'];
// What is never translated: code, snippets of the page, and the places where the tools show the page's own data
// (tag and class names, selectors, CSS property names, page titles and addresses, image names).
const SKIP = [
  'code, pre, textarea, script, style, [data-i18n-skip], .mono, .tsnip, .tmark',
  '.tag-chip, .rcard__selector:not(.rcard__selector--none), .prop, .hex, .page-block__title, .page-block__path',
  '.context-bar__title, .context-bar__host, .ir-last__name, .ir-url, .kv__code, .chip',
].join(', ');

/** Text node -> { orig, shown } ; element -> Map(attribute -> { orig, shown }) */
const texts = new WeakMap();
const attributes = new WeakMap();

function skipped(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  return !element || !!element.closest(SKIP);
}

function applyText(node) {
  if (skipped(node)) return;
  const entry = texts.get(node);
  const orig = entry && node.nodeValue === entry.shown ? entry.orig : node.nodeValue; // changed by the code: a new original
  const shown = getLanguage() === 'ja' ? translate(orig) : orig;
  if (shown !== node.nodeValue) node.nodeValue = shown;
  if (shown !== orig || entry) texts.set(node, { orig, shown });
}

function applyAttributes(element) {
  if (skipped(element)) return;
  let known = attributes.get(element);
  for (const name of ATTRIBUTES) {
    if (!element.hasAttribute(name)) continue;
    const value = element.getAttribute(name);
    const entry = known?.get(name);
    const orig = entry && value === entry.shown ? entry.orig : value;
    const shown = getLanguage() === 'ja' ? translate(orig) : orig;
    if (shown !== value) element.setAttribute(name, shown);
    if (shown !== orig || entry) {
      if (!known) attributes.set(element, (known = new Map()));
      known.set(name, { orig, shown });
    }
  }
}

function applyTree(root) {
  if (root.nodeType === 3) return applyText(root);
  if (root.nodeType !== 1) return undefined;
  if (skipped(root)) return undefined;
  applyAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) applyText(node);
    else applyAttributes(node);
  }
  return undefined;
}

/**
 * @param {HTMLElement} root the part of the page to keep translated
 * @returns {{ setLanguage: (language: string) => void }}
 */
export function createDomTranslator(root) {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') applyText(record.target);
      else if (record.type === 'attributes') applyAttributes(record.target);
      else record.addedNodes.forEach(applyTree);
    }
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });

  return {
    /** Switch language and re-translate everything already on screen. */
    setLanguage(language) {
      const next = setLanguage(normalizeLanguage(language));
      document.documentElement.lang = next;
      observer.disconnect();
      applyTree(root);
      observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
      return next;
    },
  };
}
