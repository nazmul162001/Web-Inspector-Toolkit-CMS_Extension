/**
 * Computed-style color scanner.
 *
 * Reads the *resolved* values from getComputedStyle(), so CSS variables,
 * inheritance, shorthands and the cascade are already applied by the browser.
 * The originating element is scanned, then ::before / ::after when they
 * generate a box (gradients and decorative colors live there often).
 *
 * To avoid reporting properties that merely default to `currentcolor` or are
 * inherited unchanged, descriptors in COLOR_PROPERTIES carry gates (see
 * shared/constants.js). Only properties that actually paint are reported.
 */

import { COLOR_PROPERTIES, SVG_NS } from '../shared/constants.js';

const NON_COLOR_KEYWORDS = new Set(['', 'none', 'auto', 'initial', 'inherit', 'unset']);
const PSEUDOS = Object.freeze(['::before', '::after']);
const NO_PSEUDO_TAGS = new Set([
  'img', 'br', 'hr', 'input', 'textarea', 'select', 'option', 'svg', 'path', 'rect',
  'circle', 'line', 'polyline', 'polygon', 'ellipse', 'canvas', 'video', 'audio',
  'iframe', 'embed', 'object', 'source', 'track', 'wbr', 'col', 'area',
]);

const isSvgElement = (element) => element.namespaceURI === SVG_NS;

/** Editable elements are the only ones that ever paint a caret. */
const isEditable = (element) =>
  element.isContentEditable === true || element.localName === 'input' || element.localName === 'textarea';

/**
 * Quoted empty `content` (`""`) still creates a box; `none` / `normal` do not.
 * Opacity / visibility are ignored: the color is still on the pseudo.
 */
function pseudoGeneratesBox(style) {
  const content = (style.getPropertyValue('content') || '').trim();
  if (!content || content === 'none' || content === 'normal') return false;
  return (style.getPropertyValue('display') || '').trim() !== 'none';
}

function passesGate(gate, style, element, value) {
  if (!gate) return true;
  if (gate.type === 'nonNone') {
    const other = style.getPropertyValue(gate.property).trim();
    return other !== '' && other !== 'none';
  }
  if (gate.type === 'line') {
    const lineStyle = style.getPropertyValue(gate.style).trim();
    if (lineStyle === '' || lineStyle === 'none' || lineStyle === 'hidden') return false;
    return parseFloat(style.getPropertyValue(gate.width)) > 0;
  }
  if (gate.type === 'caret') {
    // `caret-color: auto` computes to the text color, which would report every
    // colored text element. Keep it for editable elements or an explicit,
    // different caret color.
    return isEditable(element) || style.getPropertyValue('caret-color').trim() !== style.getPropertyValue('color').trim();
  }
  return true;
}

/**
 * @param {object} config
 * @param {ReturnType<import('../services/color-matcher.js').createColorMatcher>} config.matcher
 * @param {boolean} [config.includeInherited]
 * @param {Window} [config.view]
 */
export function createStyleScanner({ matcher, includeInherited = false, view = window }) {
  const styleCache = new WeakMap();

  function styleOf(element, pseudo = '') {
    if (!element) return null;
    let map = styleCache.get(element);
    if (!map) {
      map = Object.create(null);
      styleCache.set(element, map);
    }
    const key = pseudo || '';
    if (!map[key]) {
      map[key] = key ? view.getComputedStyle(element, key) : view.getComputedStyle(element);
    }
    return map[key];
  }

  /** Does this descriptor apply to this element at all? */
  function applicable(descriptor, element, pseudo) {
    if (pseudo && descriptor.gate?.type === 'caret') return false;
    if (descriptor.svgOnly) return isSvgElement(element);
    if (descriptor.svgTags) {
      return isSvgElement(element) && descriptor.svgTags.includes(element.localName.toLowerCase());
    }
    return true;
  }

  function scanStyle(element, style, inheritFrom, pseudo) {
    const results = [];
    for (const descriptor of COLOR_PROPERTIES) {
      if (!applicable(descriptor, element, pseudo)) continue;

      const value = style.getPropertyValue(descriptor.property).trim();
      if (NON_COLOR_KEYWORDS.has(value)) continue;

      const { matches } = matcher.matchValue(value);
      if (matches.length === 0) continue;

      if (!passesGate(descriptor.gate, style, element, value)) continue;

      if (descriptor.inherited && !includeInherited && inheritFrom) {
        const parentValue = inheritFrom.getPropertyValue(descriptor.property).trim();
        if (parentValue === value) continue;
      }

      results.push({
        property: descriptor.property,
        group: descriptor.group,
        computed: value,
        matches,
        pseudo,
      });
    }
    return results;
  }

  return {
    styleOf,

    /**
     * Find every color property of `element` (and its ::before / ::after) that
     * matches the target.
     * @returns {{ property:string, group:string, computed:string, matches:{raw:string,color:object}[], pseudo:string }[]}
     */
    scanElement(element) {
      const style = styleOf(element);
      const parent = element.parentElement;
      const results = scanStyle(element, style, parent ? styleOf(parent) : null, '');
      if (!NO_PSEUDO_TAGS.has(element.localName)) {
        for (const pseudo of PSEUDOS) {
          const pseudoStyle = styleOf(element, pseudo);
          if (!pseudoGeneratesBox(pseudoStyle)) continue;
          results.push(...scanStyle(element, pseudoStyle, style, pseudo));
        }
      }
      return results;
    },
  };
}
