/**
 * Fast Entire Site font scan: HTML + CSS text only. No iframe, no
 * getComputedStyle. Finds authored `font-family` / `font` (including var()
 * and the `font` shorthand) by matching selectors against the parsed DOM.
 *
 * Used for pages fetched in the background. The live tab still uses the
 * computed-style scanner.
 */

import { HIGHLIGHT_HOST_ID, SCAN_LIMITS, SKIPPED_TAGS } from '../shared/constants.js';
import {
  createFontMatcher,
  familiesOfDeclaration,
  foldFamily,
  fontFaceFiles,
  googleFontFamilies,
  splitFontStack,
} from '../services/font-matcher.js';
import {
  calculateSpecificity,
  findDeclarationLine,
  maskComments,
  parseDeclarations,
  selectorPseudoElement,
  splitTopLevel,
  stripPseudoElement,
} from './css-utils.js';
import { collectCssRules } from './color-markup-scanner.js';
import { pickWinner, substituteVariables } from './stylesheet-scanner.js';
import { buildElementRecord, createPathBuilder, getReadableSelector } from './element-info.js';

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', 'emoji', 'math', 'fangsong',
]);
const CONTROLS = new Set(['input', 'textarea', 'select', 'button', 'option']);
const MAX_STACK_NAMES = 20;
const MAX_FACE_FILES = 6;
const MAX_INHERIT_DEPTH = 60;

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

function collectFontFaceRules(css) {
  const faces = [];
  const text = maskComments(css || '');
  const lower = text.toLowerCase();
  let from = 0;
  while (from < text.length) {
    const at = lower.indexOf('@font-face', from);
    if (at === -1) break;
    const open = text.indexOf('{', at);
    if (open === -1) break;
    const close = matchingBrace(text, open);
    if (close === -1) break;
    const byName = Object.fromEntries(parseDeclarations(text.slice(open + 1, close)).map((d) => [d.name, d.value]));
    const [family] = splitFontStack(byName['font-family'] || '');
    if (family) {
      faces.push({
        family,
        src: byName.src || '',
        weight: byName['font-weight'] || '400',
        style: byName['font-style'] || 'normal',
      });
    }
    from = close + 1;
  }
  return faces;
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

function hasOwnText(element) {
  if (CONTROLS.has(element.localName)) return true;
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 && child.nodeValue.trim()) return true;
  }
  return false;
}

/**
 * @param {Document} doc
 * @param {{ href: string|null, css: string, label: string, sourceCss?: string }[]} sheets
 * @param {object} target sanitized font query
 * @param {{ pageUrl?: string, ruleCache?: Map, includeInherited?: boolean }} [options]
 */
export function scanFontMarkup(doc, sheets, target, options = {}) {
  const matcher = createFontMatcher(target);
  const buildPath = createPathBuilder(doc);
  const pageUrl = options.pageUrl || doc.baseURI || '';
  const ruleCache = options.ruleCache;
  const allRules = [];
  const facesByFamily = new Map();
  const googleFamilies = new Set();

  for (const sheet of sheets) {
    const cacheKey = sheet.href || sheet.css;
    let rules = ruleCache?.get(cacheKey);
    if (!rules) {
      rules = collectCssRules(sheet.css);
      ruleCache?.set(cacheKey, rules);
    }
    for (const rule of rules) allRules.push({ ...rule, sheet });
    const base = sheet.href || pageUrl;
    for (const face of collectFontFaceRules(sheet.css)) {
      const key = foldFamily(face.family);
      const files = fontFaceFiles(face.src, base).slice(0, MAX_FACE_FILES);
      const list = facesByFamily.get(key) || [];
      list.push({ ...face, files, stylesheetLabel: sheet.label });
      facesByFamily.set(key, list);
    }
    for (const name of googleFontFamilies(sheet.href)) googleFamilies.add(foldFamily(name));
  }

  for (const node of doc.querySelectorAll('link[href]')) {
    for (const name of googleFontFamilies(node.getAttribute('href'))) googleFamilies.add(foldFamily(name));
  }

  const { vars, defs } = varMapFromRules(allRules);

  function faceOf(name) {
    const key = foldFamily(name);
    const rules = facesByFamily.get(key) || [];
    const files = [];
    for (const rule of rules) {
      for (const file of rule.files || []) {
        if (files.length < MAX_FACE_FILES && !files.some((known) => known.url === file.url)) {
          files.push({ url: file.url, format: file.format, weight: rule.weight, style: rule.style });
        }
      }
    }
    let status;
    if (rules.length) status = 'font-face';
    else if (googleFamilies.has(key)) status = 'google-fonts';
    else if (GENERIC_FAMILIES.has(key)) status = 'generic';
    else status = 'none';
    return {
      name,
      status,
      google: googleFamilies.has(key),
      files,
      stylesheetLabel: rules[0]?.stylesheetLabel || null,
    };
  }

  const candidatesOf = new WeakMap();
  function addCandidate(element, candidate) {
    let list = candidatesOf.get(element);
    if (!list) {
      list = [];
      candidatesOf.set(element, list);
    }
    list.push(candidate);
  }

  let order = 0;
  for (const rule of allRules) {
    for (const decl of rule.declarations) {
      if (decl.name !== 'font-family' && decl.name !== 'font') continue;
      if (!decl.value) continue;
      order += 1;
      const layered = (rule.conditions || []).some((c) => c.startsWith('@layer'));
      for (const selector of splitTopLevel(rule.selectorText)) {
        if (selectorPseudoElement(selector)) continue;
        const spec = calculateSpecificity(selector);
        const candidate = {
          inline: false,
          important: decl.important,
          layered,
          specificity: spec,
          order,
          declName: decl.name,
          value: decl.value,
          selectorText: rule.selectorText,
          selector,
          sheet: rule.sheet,
          conditions: rule.conditions || [],
        };
        for (const node of querySafe(doc, stripPseudoElement(selector))) {
          if (node.nodeType === 1) addCandidate(node, candidate);
        }
      }
    }
  }

  function inlineCandidates(element) {
    const cssText = element.getAttribute?.('style');
    if (!cssText) return [];
    const list = [];
    for (const decl of parseDeclarations(cssText)) {
      if (decl.name !== 'font-family' && decl.name !== 'font') continue;
      order += 1;
      list.push({
        inline: true,
        important: decl.important,
        layered: false,
        specificity: Infinity,
        order,
        declName: decl.name,
        value: decl.value,
        selectorText: 'element.style',
        selector: 'element.style',
        sheet: null,
        conditions: [],
      });
    }
    return list;
  }

  function resolveCandidate(candidate, element) {
    const used = [];
    const resolved = /var\(/i.test(candidate.value)
      ? (substituteVariables(candidate.value, {
          getPropertyValue(name) {
            return resolveValue(vars.get(name) || '', vars);
          },
        }, used) || candidate.value)
      : candidate.value;
    const families = familiesOfDeclaration(candidate.declName, resolved);
    if (!families.length) return null;
    return { families, resolved, used, candidate, element };
  }

  const resolvedOf = new WeakMap();
  function lookupOn(element) {
    if (resolvedOf.has(element)) return resolvedOf.get(element);
    const list = [...(candidatesOf.get(element) || []), ...inlineCandidates(element)];
    const verified = [];
    for (const candidate of list) {
      const resolution = resolveCandidate(candidate, element);
      if (resolution) verified.push(resolution);
    }
    const winner = pickWinner(verified.map((v) => v.candidate));
    const found = winner ? verified.find((v) => v.candidate === winner) : null;
    resolvedOf.set(element, found);
    return found;
  }

  function lookupWithInheritance(element) {
    const direct = lookupOn(element);
    if (direct) return { ...direct, inheritedFrom: null, inherited: false };
    let node = element.parentElement;
    for (let depth = 0; node && depth < MAX_INHERIT_DEPTH; depth += 1, node = node.parentElement) {
      const found = lookupOn(node);
      if (found) return { ...found, inheritedFrom: getReadableSelector(node), inherited: true };
    }
    return null;
  }

  function findVariableDefinition(name, start) {
    for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
      const found = lookupOn(node);
      if (found?.used?.some((v) => v.name === name) || defs.has(name)) {
        const def = defs.get(name);
        if (!def) continue;
        return {
          name,
          value: def.value,
          selector: def.selector,
          stylesheetUrl: def.sheet?.href || null,
          stylesheetLabel: def.sheet?.label || null,
          definedOn: def.selector,
        };
      }
    }
    const def = defs.get(name);
    if (!def) return null;
    return {
      name,
      value: def.value,
      selector: def.selector,
      stylesheetUrl: def.sheet?.href || null,
      stylesheetLabel: def.sheet?.label || null,
      definedOn: def.selector,
    };
  }

  function buildSource(found) {
    const candidate = found.candidate;
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
      inheritedFrom: found.inheritedFrom,
      via: null,
      line: !candidate.inline && (candidate.sheet?.sourceCss || candidate.sheet?.css)
        ? findDeclarationLine(
            candidate.sheet.sourceCss || candidate.sheet.css,
            candidate.selectorText,
            candidate.declName,
            candidate.value,
          )
        : null,
      lineBase: candidate.sheet?.href ? 'file' : 'style-element',
    };
    const verifiedVar = found.used?.find((v) => matcher.match(familiesOfDeclaration('font-family', v.value)));
    if (verifiedVar) {
      source.cssVariable = {
        name: verifiedVar.name,
        value: verifiedVar.value,
        definition: findVariableDefinition(verifiedVar.name, found.element),
      };
    }
    return source;
  }

  const elements = [];
  const matches = [];
  let truncated = false;
  let nextId = 1;
  let scanned = 0;
  let domIndex = 0;
  const root = doc.documentElement;
  if (!root) {
    return {
      contextId: 'markup',
      elements,
      matches,
      truncated,
      stats: { elementsScanned: 0, durationMs: 0, timings: {}, stylesheets: { scanned: sheets.length, inaccessible: [], rules: allRules.length } },
    };
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => (SKIPPED_TAGS.has(node.localName) || node.id === HIGHLIGHT_HOST_ID ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });

  function handleElement(element) {
    domIndex += 1;
    scanned += 1;
    const found = lookupWithInheritance(element);
    if (!found) return;
    const stack = found.families.slice(0, MAX_STACK_NAMES);
    const hit = matcher.match(stack);
    if (!hit) return;
    if (found.inherited && !(target.includeInherited && hasOwnText(element))) return;
    if (matches.length >= SCAN_LIMITS.MAX_MATCHES_PER_PAGE) {
      truncated = true;
      return;
    }
    const elementId = nextId;
    nextId += 1;
    elements.push(buildElementRecord(element, { buildPath, elementId, domIndex }));
    matches.push({
      elementId,
      kind: 'font',
      property: 'font-family',
      computed: found.resolved,
      families: stack,
      matched: hit.matched,
      position: hit.position,
      inherited: found.inherited,
      face: faceOf(hit.matched[0]),
      source: buildSource(found),
      sourceStatus: 'found',
    });
  }

  if (!SKIPPED_TAGS.has(root.localName)) handleElement(root);
  let node = walker.nextNode();
  while (node && !truncated) {
    handleElement(node);
    node = walker.nextNode();
  }

  return {
    contextId: 'markup',
    elements,
    matches,
    truncated,
    stats: {
      elementsScanned: scanned,
      durationMs: 0,
      timings: {},
      stylesheets: { scanned: sheets.length, inaccessible: [], rules: allRules.length },
    },
  };
}
