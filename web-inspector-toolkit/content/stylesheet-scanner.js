/**
 * CSS source inspection through the CSSOM.
 *
 * Two phases:
 *   1. buildStylesheetIndex(): walk document.styleSheets (including @import,
 *      @media, @supports, @layer, @container and nested rules) once and index
 *      every color-relevant declaration, plus custom-property declarations.
 *   2. createSourceResolver(): for a *matched* (element, property), find the
 *      declaration responsible for the matched color.
 *
 * Truthfulness rules
 *   - A source is only reported when the declaration, after resolving var()
 *     and currentcolor against the element, really produces the matched color.
 *     That is what "verifiable" means here; a CSS variable is only reported
 *     under the same condition.
 *   - Cross-origin sheets that block cssRules are listed as inaccessible and
 *     never guessed at.
 *   - Line numbers come from the real stylesheet text and only when the match
 *     is unambiguous (see findDeclarationLine). Never invented.
 */

import { COLOR_PROPERTIES, SCAN_LIMITS } from '../shared/constants.js';
import { yieldToMain } from '../shared/helpers.js';
import { extractColors, parseColor } from '../services/color-normalizer.js';
import { getReadableSelector } from './element-info.js';
import {
  calculateSpecificity,
  coveredProperties,
  expandNestedSelectors,
  findDeclarationLine,
  parseDeclarations,
  selectorBucketKey,
  } from './css-utils.js';

const COLOR_DESCRIPTOR = COLOR_PROPERTIES.find((d) => d.property === 'color');
const MAX_INHERIT_DEPTH = 60;
const MAX_VAR_DEPTH = 8;
const MAX_PENDING_LINES = 20000;

/* ------------------------------------------------------------------ Index */

function urlLabel(href, doc) {
  try {
    const url = new URL(href);
    const path = `${url.pathname.replace(/^\//, '')}${url.search}`;
    const sameOrigin = url.origin === doc.location.origin;
    return sameOrigin ? path || url.host : `${url.host}/${path}`;
  } catch {
    return href;
  }
}

function safeMedia(view, mediaText) {
  if (!mediaText || mediaText === 'all') return true;
  try {
    return view.matchMedia(mediaText).matches;
  } catch {
    return true;
  }
}

function safeSupports(view, condition) {
  try {
    return view.CSS.supports(condition);
  } catch {
    return true;
  }
}

function addToBucket(index, property, entry, key) {
  let bucket = index.byProperty.get(property);
  if (!bucket) {
    bucket = new Map();
    index.byProperty.set(property, bucket);
  }
  const list = bucket.get(key);
  if (list) list.push(entry);
  else bucket.set(key, [entry]);
}

/**
 * @returns {Promise<{
 *   byProperty: Map<string, Map<string, object[]>>,
 *   inaccessible: {href:string|null,label:string,reason:string}[],
 *   sheetCount: number, ruleCount: number
 * }>}
 */
export async function buildStylesheetIndex(doc = document, { isCancelled = () => false } = {}) {
  const view = doc.defaultView;
  const index = { byProperty: new Map(), inaccessible: [], sheetCount: 0, ruleCount: 0 };
  const state = { order: 0, styleBlocks: 0, adopted: 0, sliceStart: performance.now() };

  async function maybeYield() {
    if (performance.now() - state.sliceStart > SCAN_LIMITS.BATCH_BUDGET_MS) {
      await yieldToMain();
      state.sliceStart = performance.now();
    }
  }

  function describeSheet(sheet, kind) {
    if (sheet.href) return { href: sheet.href, label: urlLabel(sheet.href, doc), kind: sheet.ownerNode ? 'link' : 'import', sheet };
    if (kind === 'adopted') {
      state.adopted += 1;
      return { href: null, label: `Constructed stylesheet #${state.adopted}`, kind: 'adopted', sheet };
    }
    state.styleBlocks += 1;
    const id = sheet.ownerNode?.id ? ` #${sheet.ownerNode.id}` : '';
    return { href: null, label: `<style> block ${state.styleBlocks}${id}`, kind: 'style', sheet };
  }

  function indexRule(rule, ctx) {
    const displaySelectors = expandNestedSelectors(rule.selectorText, ctx.parentDisplay, false);
    const matchSelectors = expandNestedSelectors(rule.selectorText, ctx.parentMatch, true);
    const declarations = parseDeclarations(rule.style.cssText);

    for (const declaration of declarations) {
      const properties = declaration.name.startsWith('--')
        ? [declaration.name]
        : coveredProperties(declaration.name);
      if (properties.length === 0) continue;
      state.order += 1;
      for (const selector of matchSelectors) {
        const entry = {
          selectorText: ctx.parentDisplay ? displaySelectors.join(', ') : rule.selectorText,
          selector,
          specificity: calculateSpecificity(selector),
          declName: declaration.name,
          value: declaration.value,
          important: declaration.important,
          sheet: ctx.sheet,
          order: state.order,
          layered: ctx.layered,
          conditions: ctx.conditions,
        };
        const key = selectorBucketKey(selector);
        for (const property of properties) addToBucket(index, property, entry, key);
      }
    }
    return { matchSelectors, displaySelectors };
  }

  async function walk(rules, ctx) {
    for (const rule of rules) {
      index.ruleCount += 1;
      await maybeYield();
      const type = rule.constructor?.name;
      switch (type) {
        case 'CSSStyleRule': {
          const { matchSelectors, displaySelectors } = indexRule(rule, ctx);
          if (rule.cssRules && rule.cssRules.length) {
            await walk(rule.cssRules, { ...ctx, parentMatch: matchSelectors, parentDisplay: displaySelectors });
          }
          break;
        }
        case 'CSSMediaRule':
          if (safeMedia(view, rule.media?.mediaText)) {
            await walk(rule.cssRules, {
              ...ctx,
              conditions: [...ctx.conditions, `@media ${rule.media.mediaText}`],
            });
          }
          break;
        case 'CSSSupportsRule':
          if (safeSupports(view, rule.conditionText)) {
            await walk(rule.cssRules, {
              ...ctx,
              conditions: [...ctx.conditions, `@supports ${rule.conditionText}`],
            });
          }
          break;
        case 'CSSLayerBlockRule':
          await walk(rule.cssRules, { ...ctx, layered: true, conditions: [...ctx.conditions, `@layer ${rule.name}`] });
          break;
        case 'CSSContainerRule':
          await walk(rule.cssRules, {
            ...ctx,
            conditions: [...ctx.conditions, `@container ${rule.conditionText}`],
          });
          break;
        case 'CSSImportRule':
          if (rule.styleSheet && safeMedia(view, rule.media?.mediaText)) {
            await indexSheet(rule.styleSheet, 'import', ctx);
          }
          break;
        default:
          break; // keyframes, font-face, page rules ... carry no element colors
      }
    }
  }

  async function indexSheet(sheet, kind, parentCtx) {
    if (isCancelled() || sheet.disabled) return;
    if (!safeMedia(view, sheet.media?.mediaText)) return;
    const info = describeSheet(sheet, kind);
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (error) {
      index.inaccessible.push({
        href: sheet.href,
        label: info.label,
        reason: error?.name === 'SecurityError'
          ? 'Cross-origin stylesheet (blocked by the browser)'
          : `Unreadable stylesheet (${error?.name || 'error'})`,
      });
      return;
    }
    index.sheetCount += 1;
    await walk(rules, {
      sheet: info,
      layered: parentCtx?.layered || false,
      conditions: parentCtx?.conditions || [],
      parentMatch: null,
      parentDisplay: null,
    });
  }

  for (const sheet of Array.from(doc.styleSheets)) await indexSheet(sheet, 'document', null);
  for (const sheet of Array.from(doc.adoptedStyleSheets || [])) await indexSheet(sheet, 'adopted', null);
  return index;
}

/* --------------------------------------------------------------- Resolver */

function safeMatches(element, selector) {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function bucketEntries(index, property, element) {
  const bucket = index.byProperty.get(property);
  if (!bucket) return [];
  const out = [];
  const add = (key) => {
    const list = bucket.get(key);
    if (list) for (const entry of list) out.push(entry);
  };
  add('*');
  if (element.id) add(`#${element.id}`);
  for (const name of element.classList || []) add(`.${name}`);
  add(element.localName.toLowerCase());
  return out;
}

function compareRank(a, b) {
  if (a.important !== b.important) return a.important ? 1 : -1;
  if (!!a.inline !== !!b.inline) return a.inline ? 1 : -1;
  if (!!a.layered !== !!b.layered) return a.layered ? -1 : 1;
  if (a.specificity !== b.specificity) return a.specificity - b.specificity;
  return a.order - b.order;
}

const pickWinner = (candidates) => candidates.reduce((best, c) => (!best || compareRank(c, best) > 0 ? c : best), null);

/** Index of the first comma outside parentheses, or -1. */
function firstTopLevelComma(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (text[i] === ',' && depth === 0) return i;
  }
  return -1;
}

/** Index of the `)` closing the `(` at `open`, or -1. */
function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Replace `var(--x, fallback)` using the computed style of the declaring
 * element. Returns null when a variable cannot be resolved. `used` collects the
 * top-level variables (for CSS-variable attribution).
 */
function substituteVariables(value, style, used, depth = 0) {
  if (depth > MAX_VAR_DEPTH) return null;
  let out = '';
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf('var(', i);
    if (at === -1) {
      out += value.slice(i);
      break;
    }
    if (at > 0 && /[\w-]/.test(value[at - 1])) {
      out += value.slice(i, at + 4); // part of another identifier, e.g. "somevar("
      i = at + 4;
      continue;
    }
    out += value.slice(i, at);
    const end = closingParen(value, at + 3);
    if (end === -1) return null;
    const inner = value.slice(at + 4, end);
    const comma = firstTopLevelComma(inner);
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    let resolved = style.getPropertyValue(name).trim();
    if (!resolved && comma !== -1) {
      resolved = substituteVariables(inner.slice(comma + 1).trim(), style, [], depth + 1);
    }
    if (!resolved) return null;
    if (depth === 0) used.push({ name, value: resolved });
    out += resolved;
    i = end + 1;
  }
  return out;
}

/**
 * @param {object} config
 * @param {Awaited<ReturnType<typeof buildStylesheetIndex>>} config.index
 * @param {(el: Element) => CSSStyleDeclaration} config.styleOf
 * @param {ReturnType<import('../services/color-matcher.js').createColorMatcher>} config.matcher
 */
export function createSourceResolver({ index, styleOf, matcher }) {
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
      const covers = decl.name.startsWith('--') ? decl.name === property : coveredProperties(decl.name).includes(property);
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

  function resolveDeclared(value, node) {
    const style = styleOf(node);
    const used = [];
    const text = substituteVariables(value, style, used);
    if (text === null) return { colors: [], vars: used };
    const currentColor = parseColor(style.getPropertyValue('color'));
    return { colors: extractColors(text, { currentColor }), vars: used };
  }

  /** Best verified declaration for `property` declared directly on `node`. */
  function lookupOn(node, property) {
    const verified = [];
    for (const candidate of candidatesFor(node, property)) {
      const resolution = resolveDeclared(candidate.value, node);
      if (resolution.colors.some((part) => matcher.matchesColor(part.color))) {
        verified.push({ candidate, resolution });
      }
    }
    if (verified.length === 0) return null;
    const winner = pickWinner(verified.map((v) => v.candidate));
    return { ...verified.find((v) => v.candidate === winner), node };
  }

  function lookupWithInheritance(element, descriptor) {
    const direct = lookupOn(element, descriptor.property);
    if (direct) return { ...direct, inheritedFrom: null };
    if (!descriptor.inherited) return null;
    let node = element.parentElement;
    for (let depth = 0; node && depth < MAX_INHERIT_DEPTH; depth += 1, node = node.parentElement) {
      const found = lookupOn(node, descriptor.property);
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

  function buildSource({ candidate, resolution, node, inheritedFrom }, via) {
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
      via: via || null,
      line: null,
      lineBase: null,
    };

    // Report a variable only if its own value is (one of) the matched color(s).
    const verifiedVar = resolution.vars.find((v) => extractColors(v.value).some((part) => matcher.matchesColor(part.color)));
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

    /**
     * @returns {{ source: object|null, status: 'found'|'unavailable'|'not-found' }}
     */
    resolve(element, descriptor) {
      let found = lookupWithInheritance(element, descriptor);
      let via = null;

      if (!found && descriptor.currentColorDefault) {
        const style = styleOf(element);
        const value = style.getPropertyValue(descriptor.property).trim();
        if (value && value === style.getPropertyValue('color').trim()) {
          found = lookupWithInheritance(element, COLOR_DESCRIPTOR);
          via = 'currentColor';
        }
      }

      if (found) return { source: buildSource(found, via), status: 'found' };
      return { source: null, status: index.inaccessible.length > 0 ? 'unavailable' : 'not-found' };
    },
  };
}

/* ---------------------------------------------------------- Line numbers */

async function fetchStylesheetText(href) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(href, { credentials: 'include', cache: 'force-cache', signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    return text.length > 3_000_000 ? null : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fill `source.line` for sources whose declaration can be located
 * unambiguously in the stylesheet text. Stylesheet text is fetched at most
 * once per URL, and the number of lookups is capped.
 */
export async function resolveSourceLines(pending, { fetchText = fetchStylesheetText, isCancelled = () => false } = {}) {
  const texts = new Map();
  const results = new Map();
  let lookups = 0;

  const textFor = (sheet) => {
    if (sheet.kind === 'style') return Promise.resolve(sheet.sheet.ownerNode?.textContent ?? null);
    if (!sheet.href) return Promise.resolve(null);
    if (!texts.has(sheet.href)) texts.set(sheet.href, fetchText(sheet.href));
    return texts.get(sheet.href);
  };

  for (const { source, entry } of pending) {
    if (isCancelled()) return;
    const key = `${entry.sheet.href || entry.sheet.label}|${entry.selectorText}|${entry.declName}|${entry.value}`;
    if (!results.has(key)) {
      if (lookups >= SCAN_LIMITS.MAX_LINE_LOOKUPS) continue;
      lookups += 1;
      const text = await textFor(entry.sheet);
      results.set(key, text ? findDeclarationLine(text, entry.selectorText, entry.declName, entry.value) : null);
      if (lookups % 25 === 0) await yieldToMain();
    }
    const line = results.get(key);
    if (line) {
      source.line = line;
      source.lineBase = entry.sheet.kind === 'style' ? 'style-element' : 'file';
    }
  }
}
