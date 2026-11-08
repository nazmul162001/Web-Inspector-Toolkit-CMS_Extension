/**
 * Fast Entire Site color scan: HTML + CSS text only. No iframe, no
 * getComputedStyle. Finds authored colors (including gradients, shadows and
 * ::before / ::after) by matching stylesheet selectors against the parsed DOM.
 *
 * Used for pages fetched in the background. The live tab still uses the
 * computed-style scanner.
 */

import { COLOR_PROPERTIES, SCAN_LIMITS, SKIPPED_TAGS, SVG_NS } from '../shared/constants.js';
import { alphaToNumber, extractColors, toHex } from '../services/color-normalizer.js';
import { createColorMatcher } from '../services/color-matcher.js';
import {
  coveredProperties,
  maskComments,
  parseDeclarations,
  selectorPseudoElement,
  splitTopLevel,
  stripPseudoElement,
  findDeclarationLine,
  mediaAppliesToScreen,
} from './css-utils.js';
import { substituteVariables } from './stylesheet-scanner.js';
import { buildElementRecord, createPathBuilder } from './element-info.js';

const GROUP_OF = new Map(COLOR_PROPERTIES.map((d) => [d.property, d.group]));
const SVG_ONLY = new Set(COLOR_PROPERTIES.filter((d) => d.svgOnly).map((d) => d.property));
const SVG_TAGS = new Map(COLOR_PROPERTIES.filter((d) => d.svgTags).map((d) => [d.property, new Set(d.svgTags)]));
const SKIP_AT = new Set([
  'keyframes', '-webkit-keyframes', 'font-face', 'charset', 'namespace', 'import',
  'counter-style', 'property', 'page', 'viewport', 'font-feature-values',
]);

function matchingBrace(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Walk raw CSS into `{ selectorText, declarations, conditions }[]`.
 * Nested rules, @media (except print), @layer and @supports are entered.
 */
export function collectCssRules(css, conditions = []) {
  const rules = [];
  const text = maskComments(css || '');
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;
    if (text[i] === '@') {
      i += 1;
      let name = '';
      while (i < text.length && /[A-Za-z0-9_-]/.test(text[i])) name += text[i++];
      name = name.toLowerCase();
      const preludeStart = i;
      while (i < text.length && text[i] !== '{' && text[i] !== ';') i += 1;
      const prelude = text.slice(preludeStart, i).trim();
      if (i < text.length && text[i] === ';') {
        i += 1;
        continue;
      }
      if (i >= text.length || text[i] !== '{') break;
      const close = matchingBrace(text, i);
      if (close === -1) break;
      const body = text.slice(i + 1, close);
      i = close + 1;
      if (SKIP_AT.has(name)) continue;
      if (name === 'media' && !mediaAppliesToScreen(prelude)) continue;
      const next = name === 'media' || name === 'layer' || name === 'supports' || name === 'container'
        ? [...conditions, `@${name} ${prelude}`.trim()]
        : conditions;
      rules.push(...collectCssRules(body, next));
      continue;
    }
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const close = matchingBrace(text, open);
    if (close === -1) break;
    const selectorText = text.slice(i, open).trim();
    const declarations = parseDeclarations(text.slice(open + 1, close));
    i = close + 1;
    if (selectorText && declarations.length) rules.push({ selectorText, declarations, conditions });
  }
  return rules;
}

function varMapFromRules(rules) {
  const vars = new Map();
  const defs = new Map();
  for (const rule of rules) {
    for (const decl of rule.declarations) {
      if (!decl.name.startsWith('--')) continue;
      vars.set(decl.name, decl.value);
      defs.set(decl.name, { value: decl.value, selector: rule.selectorText, sheet: rule.sheet });
    }
  }
  return { vars, defs };
}

function resolveValue(value, vars) {
  if (!value || !/var\(/i.test(value)) return value;
  const seen = new Set();
  const style = {
    getPropertyValue(name) {
      if (seen.has(name) || seen.size > 8) return '';
      seen.add(name);
      const raw = vars.get(name);
      if (!raw) return '';
      if (!/var\(/i.test(raw)) return raw;
      return substituteVariables(raw, style, []) || raw;
    },
  };
  return substituteVariables(value, style, []) || value;
}

function querySafe(doc, selector) {
  try {
    return doc.querySelectorAll(selector);
  } catch {
    return [];
  }
}

/**
 * @param {Document} doc parsed HTML (no layout required)
 * @param {{ href: string|null, css: string, label: string }[]} sheets
 * @param {{ r:number, g:number, b:number, a:number }} target
 * @param {{ tolerance?: number, collectLinks?: boolean }} [options]
 */
export function scanColorMarkup(doc, sheets, target, options = {}) {
  const matcher = createColorMatcher(target, { tolerance: options.tolerance || 0 });
  const buildPath = createPathBuilder(doc);
  const allRules = [];
  const ruleCache = options.ruleCache;
  for (const sheet of sheets) {
    const cacheKey = sheet.href || sheet.css;
    let rules = ruleCache?.get(cacheKey);
    if (!rules) {
      rules = collectCssRules(sheet.css);
      ruleCache?.set(cacheKey, rules);
    }
    for (const rule of rules) allRules.push({ ...rule, sheet });
  }
  const { vars, defs } = varMapFromRules(allRules);
  const hiddenSelectors = [];
  for (const rule of allRules) {
    if (rule.declarations.some((d) => d.name === 'display' && /^\s*none\s*$/i.test(d.value))) {
      hiddenSelectors.push(rule.selectorText);
    }
  }

  const elements = [];
  const matches = [];
  const byElement = new Map();
  const seenHit = new WeakMap();
  let nextId = 1;
  let truncated = false;
  let domIndex = 0;

  function recordElement(element) {
    let rec = byElement.get(element);
    if (rec) return rec;
    if (SKIPPED_TAGS.has(element.localName)) return null;
    domIndex += 1;
    const elementId = nextId;
    nextId += 1;
    const hidden = element.hasAttribute('hidden')
      || hiddenSelectors.some((sel) => {
        try {
          return element.matches(stripPseudoElement(sel));
        } catch {
          return false;
        }
      });
    rec = buildElementRecord(element, { buildPath, elementId, domIndex });
    rec.rendered = hidden ? false : true;
    byElement.set(element, rec);
    elements.push(rec);
    return rec;
  }

  function addMatch(element, hit) {
    if (SVG_ONLY.has(hit.property) && element.namespaceURI !== SVG_NS) return;
    const tagLimit = SVG_TAGS.get(hit.property);
    if (tagLimit && !tagLimit.has(element.localName.toLowerCase())) return;
    let keys = seenHit.get(element);
    if (!keys) {
      keys = new Set();
      seenHit.set(element, keys);
    }
    const key = `${hit.property}|${hit.pseudo || ''}`;
    if (keys.has(key)) return;
    keys.add(key);
    if (matches.length >= SCAN_LIMITS.MAX_MATCHES_PER_PAGE) {
      truncated = true;
      return;
    }
    const rec = recordElement(element);
    if (!rec) return;
    const first = hit.color;
    matches.push({
      elementId: rec.elementId,
      property: hit.property,
      group: GROUP_OF.get(hit.property) || 'background',
      computed: hit.computed,
      color: { hex: toHex(first), alpha: alphaToNumber(first.a), rgba: first },
      matchedValues: hit.matchedValues,
      pseudo: hit.pseudo || '',
      source: hit.source,
      sourceStatus: hit.source ? 'found' : 'not-found',
    });
  }

  function hitsFromDecl(decl, varsMap) {
    const properties = coveredProperties(decl.name);
    if (!properties.length) return [];
    const used = [];
    const resolved = /var\(/i.test(decl.value)
      ? (substituteVariables(decl.value, {
          getPropertyValue(name) {
            return resolveValue(varsMap.get(name) || '', varsMap);
          },
        }, used) || decl.value)
      : decl.value;
    const { matches: found } = matcher.matchValue(resolved);
    if (!found.length) return [];
    const cssVariable = used.find((v) => matcher.matchValue(v.value).matches.length);
    return properties.map((property) => ({
      property,
      computed: resolved,
      color: found[0].color,
      matchedValues: found.map((m) => m.raw),
      cssVariable: cssVariable ? { name: cssVariable.name, value: cssVariable.value } : null,
      authored: decl,
    }));
  }

  for (const rule of allRules) {
    if (truncated) break;
    const colorHits = [];
    for (const decl of rule.declarations) colorHits.push(...hitsFromDecl(decl, vars));
    if (!colorHits.length) continue;
    for (const selector of splitTopLevel(rule.selectorText)) {
      const pseudo = selectorPseudoElement(selector);
      const nodes = querySafe(doc, stripPseudoElement(selector));
      if (!nodes.length) continue;
      for (const hit of colorHits) {
        const source = {
          origin: 'stylesheet',
          stylesheetUrl: rule.sheet.href,
          stylesheetLabel: rule.sheet.label,
          selector: rule.selectorText,
          property: hit.authored.name,
          value: hit.authored.value,
          important: hit.authored.important,
          declaration: `${hit.authored.name}: ${hit.authored.value}${hit.authored.important ? ' !important' : ''}`,
          conditions: rule.conditions,
          cssVariable: hit.cssVariable
            ? {
                name: hit.cssVariable.name,
                value: hit.cssVariable.value,
                definition: defs.has(hit.cssVariable.name)
                  ? {
                      name: hit.cssVariable.name,
                      value: defs.get(hit.cssVariable.name).value,
                      selector: defs.get(hit.cssVariable.name).selector,
                      stylesheetUrl: defs.get(hit.cssVariable.name).sheet?.href || null,
                      stylesheetLabel: defs.get(hit.cssVariable.name).sheet?.label || null,
                      definedOn: defs.get(hit.cssVariable.name).selector,
                    }
                  : null,
              }
            : null,
          inheritedFrom: null,
          via: null,
          line: (rule.sheet.sourceCss || rule.sheet.css)
            ? findDeclarationLine(
                rule.sheet.sourceCss || rule.sheet.css,
                rule.selectorText,
                hit.authored.name,
                hit.authored.value,
              )
            : null,
          lineBase: rule.sheet.href ? 'file' : 'style-element',
        };
        for (const node of nodes) {
          if (truncated) break;
          if (node.nodeType !== 1) continue;
          addMatch(node, { ...hit, pseudo, source });
        }
      }
    }
  }

  const root = doc.documentElement;
  if (!root) {
    return {
      contextId: 'markup',
      elements,
      matches,
      truncated,
      stats: {
        elementsScanned: 0,
        durationMs: 0,
        timings: {},
        stylesheets: { scanned: sheets.length, inaccessible: [], rules: allRules.length },
      },
    };
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = root;
  while (node && !truncated) {
    const cssText = node.getAttribute?.('style');
    if (cssText) {
      for (const decl of parseDeclarations(cssText)) {
        for (const hit of hitsFromDecl(decl, vars)) {
          addMatch(node, {
            ...hit,
            pseudo: '',
            source: {
              origin: 'inline',
              stylesheetUrl: null,
              stylesheetLabel: null,
              selector: 'element.style',
              property: hit.authored.name,
              value: hit.authored.value,
              important: hit.authored.important,
              declaration: `${hit.authored.name}: ${hit.authored.value}`,
              conditions: [],
              cssVariable: hit.cssVariable
                ? { name: hit.cssVariable.name, value: hit.cssVariable.value, definition: null }
                : null,
              inheritedFrom: null,
              via: null,
              line: null,
              lineBase: null,
            },
          });
        }
      }
    }
    node = walker.nextNode();
  }

  return {
    contextId: 'markup',
    elements,
    matches,
    truncated,
    stats: {
      elementsScanned: domIndex,
      durationMs: 0,
      timings: {},
      stylesheets: { scanned: sheets.length, inaccessible: [], rules: allRules.length },
    },
  };
}

/** Selectors that hide an element (`display: none` / `visibility: hidden`). */
export function hiddenSelectorsFromSheets(sheets, ruleCache) {
  const selectors = [];
  for (const sheet of sheets) {
    const cacheKey = sheet.href || sheet.css;
    let rules = ruleCache?.get(cacheKey);
    if (!rules) {
      rules = collectCssRules(sheet.css);
      ruleCache?.set(cacheKey, rules);
    }
    for (const rule of rules) {
      if (
        rule.declarations.some(
          (decl) =>
            (decl.name === 'display' && /^\s*none\s*$/i.test(decl.value)) ||
            (decl.name === 'visibility' && /^\s*hidden\s*$/i.test(decl.value)),
        )
      ) {
        selectors.push(rule.selectorText);
      }
    }
  }
  return selectors;
}
