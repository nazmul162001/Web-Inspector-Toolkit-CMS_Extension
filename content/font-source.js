/**
 * CSS source of a font family (Font Find): which declaration asks for it.
 *
 * Truthfulness rules (same spirit as the color source resolver)
 *   - Every declaration that targets font-family on the element (inline and
 *     rules, `font-family` and the `font` shorthand) is ranked by !important,
 *     inline, cascade layer, specificity and order. Only the WINNER can be the
 *     source, and it is only reported when, after var() is resolved against the
 *     element, its list really contains the matched font. Otherwise nothing is
 *     reported - a source is never guessed.
 *   - If the element only inherits the font, the nearest ancestor whose winning
 *     declaration verifies is reported as "inherited from".
 *   - Line numbers are filled by resolveSourceLines() (stylesheet-scanner.js)
 *     and only when the declaration is found exactly once.
 */

import { familiesOfDeclaration } from '../services/font-matcher.js';
import { parseDeclarations } from './css-utils.js';
import { getReadableSelector } from './element-info.js';
import { bucketEntries, pickWinner, safeMatches, substituteVariables } from './stylesheet-scanner.js';

const MAX_INHERIT_DEPTH = 60;
const MAX_PENDING_LINES = 20000;

/** Declaration names the font index needs: font-family, and the `font` shorthand that sets it. */
export const fontCovered = (name) => (name === 'font-family' || name === 'font' ? ['font-family'] : []);

/**
 * @param {object} config
 * @param {Awaited<ReturnType<typeof import('./stylesheet-scanner.js').buildStylesheetIndex>>} config.index
 * @param {(el: Element) => CSSStyleDeclaration} config.styleOf
 * @param {ReturnType<import('../services/font-matcher.js').createFontMatcher>} config.matcher
 */
export function createFontSourceResolver({ index, styleOf, matcher }) {
  const inlineCache = new WeakMap();
  const pendingLines = [];

  function inlineDeclarations(element) {
    let list = inlineCache.get(element);
    if (!list) {
      list = element.style ? parseDeclarations(element.style.cssText) : [];
      inlineCache.set(element, list);
    }
    return list;
  }

  /** Every declaration that targets `property` on `element` (inline + rules). */
  function candidatesFor(element, property) {
    const list = [];
    for (const decl of inlineDeclarations(element)) {
      const covers = decl.name.startsWith('--') ? decl.name === property : fontCovered(decl.name).includes(property);
      if (covers) {
        list.push({
          inline: true, declName: decl.name, value: decl.value, important: decl.important,
          specificity: Infinity, order: Infinity, conditions: [], sheet: null,
        });
      }
    }
    for (const entry of bucketEntries(index, property, element)) {
      if (safeMatches(element, entry.selector)) list.push(entry);
    }
    return list;
  }

  /** The families a declaration asks for once its variables are resolved against `node`, or null. */
  function resolveDeclared(candidate, node) {
    const used = [];
    const text = substituteVariables(candidate.value, styleOf(node), used);
    if (text === null) return null;
    return { families: familiesOfDeclaration(candidate.declName, text), vars: used };
  }

  /** The winning declaration on `node`, if it verifiably asks for the matched font. */
  function lookupOn(node) {
    const winner = pickWinner(candidatesFor(node, 'font-family'));
    if (!winner) return null;
    const resolution = resolveDeclared(winner, node);
    if (!resolution || !matcher.match(resolution.families)) return null;
    return { candidate: winner, resolution, node };
  }

  function lookupWithInheritance(element) {
    const direct = lookupOn(element);
    if (direct) return { ...direct, inheritedFrom: null };
    let node = element.parentElement;
    for (let depth = 0; node && depth < MAX_INHERIT_DEPTH; depth += 1, node = node.parentElement) {
      const found = lookupOn(node);
      if (found) return { ...found, inheritedFrom: getReadableSelector(node) };
    }
    return null;
  }

  /** Nearest ancestor-or-self declaration of the custom property `name`. */
  function findVariableDefinition(name, start) {
    for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
      const winner = pickWinner(candidatesFor(node, name));
      if (winner) {
        return {
          name,
          value: winner.value,
          selector: winner.inline ? 'element.style' : winner.selectorText,
          stylesheetUrl: winner.sheet?.href || null,
          stylesheetLabel: winner.sheet?.label || null,
          definedOn: getReadableSelector(node),
        };
      }
    }
    return null;
  }

  function buildSource({ candidate, resolution, node, inheritedFrom }) {
    const source = {
      origin: candidate.inline ? 'inline' : 'stylesheet',
      stylesheetUrl: candidate.sheet?.href || null,
      stylesheetLabel: candidate.sheet?.label || null,
      selector: candidate.inline ? 'element.style' : candidate.selectorText,
      property: candidate.declName,
      value: candidate.value,
      important: candidate.important,
      declaration: `${candidate.declName}: ${candidate.value}${candidate.important ? ' !important' : ''}`,
      conditions: candidate.conditions || [],
      cssVariable: null,
      inheritedFrom,
      via: null,
      line: null,
      lineBase: null,
    };

    // Report a variable only if its own value really lists the matched font.
    const verifiedVar = resolution.vars.find((v) => matcher.match(familiesOfDeclaration('font-family', v.value)));
    if (verifiedVar) {
      source.cssVariable = {
        name: verifiedVar.name,
        value: verifiedVar.value,
        definition: findVariableDefinition(verifiedVar.name, node),
      };
    }

    if (!candidate.inline && candidate.sheet && pendingLines.length < MAX_PENDING_LINES) {
      pendingLines.push({ source, entry: candidate });
    }
    return source;
  }

  return {
    pendingLines,

    /** @returns {{ source: object|null, status: 'found'|'unavailable'|'not-found' }} */
    resolve(element) {
      const found = lookupWithInheritance(element);
      if (found) return { source: buildSource(found), status: 'found' };
      return { source: null, status: index.inaccessible.length > 0 ? 'unavailable' : 'not-found' };
    },
  };
}
