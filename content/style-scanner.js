/**
 * Computed-style color scanner.
 *
 * Reads the *resolved* values from getComputedStyle(), so CSS variables,
 * inheritance, shorthands and the cascade are already applied by the browser.
 * One computed-style object is fetched per element and cached.
 *
 * To avoid reporting properties that merely default to `currentcolor` or are
 * inherited unchanged, descriptors in COLOR_PROPERTIES carry gates (see
 * shared/constants.js). Only properties that actually paint are reported.
 */

import { COLOR_PROPERTIES, SVG_NS } from '../shared/constants.js';

const NON_COLOR_KEYWORDS = new Set(['', 'none', 'auto', 'initial', 'inherit', 'unset']);

const isSvgElement = (element) => element.namespaceURI === SVG_NS;

/** Editable elements are the only ones that ever paint a caret. */
const isEditable = (element) =>
  element.isContentEditable === true || element.localName === 'input' || element.localName === 'textarea';

function passesGate(gate, style, element) {
  if (!gate) return true;
  if (gate.type === 'nonNone') {
    const value = style.getPropertyValue(gate.property).trim();
    return value !== '' && value !== 'none';
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

  function styleOf(element) {
    let style = styleCache.get(element);
    if (!style) {
      style = view.getComputedStyle(element);
      styleCache.set(element, style);
    }
    return style;
  }

  /** Does this descriptor apply to this element at all? */
  function applicable(descriptor, element) {
    if (descriptor.svgOnly) return isSvgElement(element);
    if (descriptor.svgTags) {
      return isSvgElement(element) && descriptor.svgTags.includes(element.localName.toLowerCase());
    }
    return true;
  }

  return {
    styleOf,

    /**
     * Find every color property of `element` that matches the target.
     * @returns {{ property:string, group:string, computed:string, matches:{raw:string,color:object}[] }[]}
     */
    scanElement(element) {
      const style = styleOf(element);
      const parent = element.parentElement;
      const results = [];

      for (const descriptor of COLOR_PROPERTIES) {
        if (!applicable(descriptor, element)) continue;

        const value = style.getPropertyValue(descriptor.property).trim();
        if (NON_COLOR_KEYWORDS.has(value)) continue;

        const { matches } = matcher.matchValue(value);
        if (matches.length === 0) continue;

        if (!passesGate(descriptor.gate, style, element)) continue;

        if (descriptor.inherited && !includeInherited && parent) {
          const parentValue = styleOf(parent).getPropertyValue(descriptor.property).trim();
          if (parentValue === value) continue;
        }

        results.push({
          property: descriptor.property,
          group: descriptor.group,
          computed: value,
          matches,
        });
      }
      return results;
    },
  };
}
