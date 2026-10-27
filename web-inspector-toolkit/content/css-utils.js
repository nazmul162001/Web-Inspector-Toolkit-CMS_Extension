/**
 * Pure CSS text helpers used by the stylesheet scanner. No DOM access, so they
 * can be unit-tested in isolation.
 */

import { SHORTHAND_TO_LONGHANDS, COLOR_PROPERTIES } from '../shared/constants.js';
import { escapeRegExp } from '../shared/helpers.js';

const COLOR_PROPERTY_NAMES = new Set(COLOR_PROPERTIES.map((d) => d.property));

/* ----------------------------------------------------------- Declarations */

/**
 * Split a declaration block (`CSSStyleDeclaration.cssText`) into
 * `{ name, value, important }`. Semicolons inside (), [], {} or strings do
 * not split. Reading cssText (instead of getPropertyValue) preserves
 * `var()` references inside shorthands, which CSSOM longhand reads lose.
 */
export function parseDeclarations(cssText) {
  const declarations = [];
  if (!cssText) return declarations;
  let depth = 0;
  let quote = null;
  let start = 0;

  const push = (chunk) => {
    const colon = chunk.indexOf(':');
    if (colon < 1) return;
    let name = chunk.slice(0, colon).trim();
    let value = chunk.slice(colon + 1).trim();
    if (!name) return;
    let important = false;
    const flag = /\s*!\s*important\s*$/i.exec(value);
    if (flag) {
      important = true;
      value = value.slice(0, flag.index).trim();
    }
    if (!name.startsWith('--')) name = name.toLowerCase();
    declarations.push({ name, value, important });
  };

  for (let i = 0; i < cssText.length; i += 1) {
    const ch = cssText[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      push(cssText.slice(start, i));
      start = i + 1;
    }
  }
  push(cssText.slice(start));
  return declarations;
}

/** The inspected longhand color properties a declaration name can set. */
export function coveredProperties(name) {
  if (COLOR_PROPERTY_NAMES.has(name)) return [name];
  return SHORTHAND_TO_LONGHANDS[name] || [];
}

/* -------------------------------------------------------------- Selectors */

/** Split on `separator` outside of (), [] and strings. */
export function splitTopLevel(text, separator = ',') {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        i += 1;
        current += text[i] ?? '';
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Expand a nested rule's selector list against its parent selectors.
 * `wrap` produces `:is(parent)` (for matching); otherwise the parent text is
 * inlined (for display).
 */
export function expandNestedSelectors(selectorText, parentSelectors, wrap) {
  const parts = splitTopLevel(selectorText);
  if (!parentSelectors || parentSelectors.length === 0) return parts;
  const parent = wrap ? `:is(${parentSelectors.join(', ')})` : parentSelectors.join(', ');
  return parts.map((part) => (part.includes('&') ? part.replace(/&/g, parent) : `${parent} ${part}`));
}

const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
const LOGICAL_PSEUDOS = new Set(['is', 'not', 'has', 'matches', '-webkit-any', '-moz-any']);

function skipIdentifier(text, from) {
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (/[\w-]/.test(ch) || ch.charCodeAt(0) > 127) i += 1;
    else if (ch === '\\') i += 2;
    else break;
  }
  return i;
}

function matchingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

const compareParts = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function maxPartsOfList(list) {
  let best = [0, 0, 0];
  for (const part of splitTopLevel(list)) {
    const parts = specificityParts(part);
    if (compareParts(parts, best) > 0) best = parts;
  }
  return best;
}

function specificityParts(selector) {
  let a = 0;
  let b = 0;
  let c = 0;
  const text = selector
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '#') {
      a += 1;
      i = skipIdentifier(text, i + 1);
    } else if (ch === '.') {
      b += 1;
      i = skipIdentifier(text, i + 1);
    } else if (ch === '[') {
      b += 1;
      const end = text.indexOf(']', i);
      i = end === -1 ? text.length : end + 1;
    } else if (ch === ':') {
      const isElement = text[i + 1] === ':';
      i += isElement ? 2 : 1;
      const nameStart = i;
      i = skipIdentifier(text, i);
      const name = text.slice(nameStart, i).toLowerCase();
      let argument = null;
      if (text[i] === '(') {
        const end = matchingParen(text, i);
        argument = text.slice(i + 1, end);
        i = end + 1;
      }
      if (isElement || LEGACY_PSEUDO_ELEMENTS.has(name)) c += 1;
      else if (name === 'where') {
        /* zero specificity */
      } else if (argument !== null && LOGICAL_PSEUDOS.has(name)) {
        const [pa, pb, pc] = maxPartsOfList(argument);
        a += pa;
        b += pb;
        c += pc;
      } else if (argument !== null && (name === 'nth-child' || name === 'nth-last-child')) {
        b += 1;
        const of = /\sof\s([\s\S]+)$/i.exec(argument);
        if (of) {
          const [pa, pb, pc] = maxPartsOfList(of[1]);
          a += pa;
          b += pb;
          c += pc;
        }
      } else b += 1;
    } else if (/[A-Za-z_\\]/.test(ch) || ch.charCodeAt(0) > 127) {
      c += 1;
      i = skipIdentifier(text, i);
    } else i += 1; // combinators, *, |, whitespace
  }
  return [a, b, c];
}

/** Specificity of one complex selector as a single sortable number. */
export function calculateSpecificity(selector) {
  const [a, b, c] = specificityParts(selector);
  return Math.min(a, 999) * 1e6 + Math.min(b, 999) * 1e3 + Math.min(c, 999);
}

function unescapeIdentifier(raw) {
  return raw.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([\s\S])/g, (_, hex, char) =>
    hex ? String.fromCodePoint(parseInt(hex, 16) || 0xfffd) : char,
  );
}

/** Rightmost compound selector (the part that must match the element). */
function lastCompound(selector) {
  let depth = 0;
  let quote = null;
  let segment = '';
  let last = '';
  const flush = () => {
    if (segment) last = segment;
    segment = '';
  };
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (quote) {
      segment += ch;
      if (ch === '\\') {
        i += 1;
        segment += selector[i] ?? '';
      } else if (ch === quote) quote = null;
    } else if (ch === '\\') {
      segment += ch + (selector[i + 1] ?? '');
      i += 1;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      segment += ch;
    } else if (ch === '(' || ch === '[') {
      depth += 1;
      segment += ch;
    } else if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
      segment += ch;
    } else if (depth === 0 && (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~')) flush();
    else segment += ch;
  }
  flush();
  return last;
}

/**
 * Bucket key used to index rules by their rightmost compound (the same idea
 * browsers use): `#id`, `.class`, `tag` or `*`. Lets the resolver test only a
 * handful of rules per element instead of every rule in every stylesheet.
 */
export function selectorBucketKey(selector) {
  const compound = lastCompound(selector);
  const tagMatch = /^([A-Za-z][\w-]*|\*)/.exec(compound);
  const tag = tagMatch ? tagMatch[1] : null;
  let id = null;
  let cls = null;
  let i = tag ? tag.length : 0;
  while (i < compound.length) {
    const ch = compound[i];
    if (ch === '[') {
      const end = compound.indexOf(']', i);
      i = end === -1 ? compound.length : end + 1;
    } else if (ch === ':') {
      i += compound[i + 1] === ':' ? 2 : 1;
      i = skipIdentifier(compound, i);
      if (compound[i] === '(') i = matchingParen(compound, i) + 1;
    } else if (ch === '#' || ch === '.') {
      const end = skipIdentifier(compound, i + 1);
      const name = unescapeIdentifier(compound.slice(i + 1, end));
      if (ch === '#' && id === null) id = name;
      if (ch === '.' && cls === null) cls = name;
      i = end;
    } else i += 1;
  }
  if (id) return `#${id}`;
  if (cls) return `.${cls}`;
  if (tag && tag !== '*') return tag.toLowerCase();
  return '*';
}

/* ------------------------------------------------------------ Line lookup */

/** Replace comment text with spaces, keeping newlines so offsets and line numbers stay valid. */
export function maskComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** Regex source matching `text` with flexible whitespace around punctuation. */
function flexibleSource(text) {
  let out = '';
  let previousWasSpace = false;
  for (const ch of text.trim()) {
    if (/\s/.test(ch)) {
      if (!previousWasSpace) out += '\\s*';
      previousWasSpace = true;
      continue;
    }
    previousWasSpace = false;
    if (ch === '"' || ch === "'") out += '["\']';
    else if (',>+~():'.includes(ch)) out += `\\s*${escapeRegExp(ch)}\\s*`;
    else out += escapeRegExp(ch);
  }
  return out;
}

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
 * Locate the 1-based line of `declName: value` inside the rule whose selector
 * is `selectorText`, searching real source text.
 *
 * Reliability rule: a line is returned ONLY when exactly one place in the
 * source matches (same selector block containing that declaration). Minified
 * or ambiguous sources therefore yield `null` - a line number is never guessed.
 */
export function findDeclarationLine(cssText, selectorText, declName, value) {
  if (!cssText || !selectorText || !declName) return null;
  const css = maskComments(cssText);
  let selectorRe;
  let declRe;
  try {
    // The selector must start a rule: preceded by file start or one of { } ;
    // (so `a {` never matches inside `.nav a {`).
    selectorRe = new RegExp(`(?:^|[{};])\\s*(${flexibleSource(selectorText)})\\s*\\{`, 'g');
    declRe = new RegExp(
      `(?:^|[;{\\s])(${escapeRegExp(declName)}\\s*:\\s*${flexibleSource(value)}\\s*(?:!\\s*important\\s*)?)(?:;|}|$)`,
      'i',
    );
  } catch {
    return null;
  }

  const hits = [];
  let match;
  while ((match = selectorRe.exec(css)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchingBrace(css, open);
    if (close === -1) continue;
    const body = css.slice(open + 1, close);
    const found = declRe.exec(body);
    if (found) {
      const offset = open + 1 + found.index + found[0].indexOf(found[1]);
      hits.push(offset);
      if (hits.length > 1) return null;
    }
  }
  if (hits.length !== 1) return null;
  return css.slice(0, hits[0]).split('\n').length;
}
