/**
 * Font family matching for Font Find. Pure functions (no DOM, no chrome.*),
 * shared by the content script, the invisible renderer, the side panel and the tests.
 *
 * What is searched is the CSS `font-family` list of an element: the computed
 * value, for example `"Noto Sans JP", Meiryo, sans-serif`. That tells which
 * fonts the page ASKS for, in order of preference. It does not tell whether the
 * visitor's browser really had the first font; a browser cannot report that
 * to a page, so the tool never claims it.
 *
 * Rules
 *  - Names are compared without quotes, ignoring letter case, extra spaces and
 *    full-width/half-width differences.
 *  - "Exact" (default): a name in the list must equal the typed name
 *    (`Roboto` does not find `Roboto Slab`). Off: it only has to contain it
 *    (`Noto` finds `Noto Sans JP` and `Noto Serif`).
 *  - The input can be written any way: a name (`Noto Sans JP`), a list
 *    (`"Noto Sans JP", arial, sans-serif`) or a CSS declaration pasted from a
 *    stylesheet or DevTools (`font-family: "Noto Sans JP", arial;`, the `font`
 *    shorthand, several lines, `!important`, a whole `{ ... }` rule). The font
 *    names are read out of it (see extractFontNames).
 *  - Which of the typed names are searched ("use"):
 *      first (default) - only the first one: pasting a whole font-family list finds
 *                        "the font", the rest of the list being fallbacks
 *      any             - any of them
 *      list            - all of them, in that order (other fonts may sit between)
 *  - "First choice only": the (first) name must be the first one in the element's list.
 *  - Generic names (`sans-serif`, `monospace`, `system-ui` ...) are ordinary
 *    names here, so they can be searched too.
 */

export const MAX_FAMILIES = 10;
export const MAX_FAMILY_LENGTH = 100;

const FORBIDDEN = /[{};<>\u0000-\u001f]/;

/** Fold a family name for comparison. */
export const foldFamily = (name) => String(name).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** `Noto Sans JP`, `"Noto Sans JP"`, `'Noto Sans JP'` -> `Noto Sans JP`. */
function unquote(part) {
  let name = part.trim();
  const quote = name[0];
  if ((quote === '"' || quote === "'") && name.length >= 2 && name.endsWith(quote)) name = name.slice(1, -1);
  return name.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim();
}

/**
 * Split a font-family list (`"A, B", C, sans-serif`) into its names, in order.
 * Commas inside quotes do not split.
 */
export function splitFontStack(value) {
  const names = [];
  let current = '';
  let quote = null;
  const flush = () => {
    const name = unquote(current);
    if (name) names.push(name);
    current = '';
  };
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        i += 1;
        current += text[i] ?? '';
      } else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') flush();
    else current += ch;
  }
  flush();
  return names;
}

/* ---------------------------------------------------------------- Query */

export const MAX_INPUT_LENGTH = 2000;
export const FONT_USE = Object.freeze(['first', 'any', 'list']);

const READ_ERROR = 'Could not read a font from that. Type a font name, a list like "Noto Sans JP", Arial, or a font-family declaration.';

/** `font-family: ...` and `font: ...` declarations anywhere in a text (CSS rule, DevTools copy, style="..." attribute). */
const DECLARATION = /(?:^|[\s;{"'(])(font-family|font)\s*:\s*([^;{}]*)/gi;

/** Drop a closing quote left over from `style="font-family: ..."` and an `!important` flag. */
function cleanValue(raw) {
  let value = raw.replace(/["']?\s*\/?>[\s\S]*$/, '').replace(/!\s*important/i, '').trim(); // `...">` ends an HTML attribute
  for (const quote of ['"', "'"]) {
    if (value.endsWith(quote) && (value.split(quote).length - 1) % 2 === 1) value = value.slice(0, -1).trim();
  }
  return value.replace(/,\s*$/, '');
}

/**
 * Read the font names out of whatever the user typed or pasted.
 * @returns {{ ok: true, names: string[], from: 'declaration' | 'list' } | { ok: false, error: string }}
 */
export function extractFontNames(input) {
  const text = String(input ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
  if (!text) return { ok: false, error: 'Enter a font family, for example Roboto or "Noto Sans JP".' };

  const declarations = Array.from(text.matchAll(DECLARATION));
  if (declarations.length) {
    const names = [];
    for (const [, property, raw] of declarations) {
      const value = cleanValue(raw);
      if (/\b(var|env|calc)\(/i.test(value)) {
        return { ok: false, error: 'That font comes from a CSS variable. Type the font name itself instead.' };
      }
      names.push(...familiesOfDeclaration(property.toLowerCase(), value));
    }
    return names.length ? { ok: true, names, from: 'declaration' } : { ok: false, error: READ_ERROR };
  }

  const list = text.replace(/^[{\s]+/, '').replace(/[;}\s,]+$/, '');
  if (/[:;{}]/.test(list.replace(/(["'])(?:\\.|(?!\1).)*\1/g, ''))) return { ok: false, error: READ_ERROR };
  return { ok: true, names: splitFontStack(list), from: 'list' };
}

function buildQuery(names, flags) {
  const families = [];
  for (const name of names) {
    if (name.length > MAX_FAMILY_LENGTH) return { ok: false, error: 'That font name is too long.' };
    if (FORBIDDEN.test(name)) return { ok: false, error: 'A font family name cannot contain { } ; < > characters.' };
    if (!families.some((known) => foldFamily(known) === foldFamily(name))) families.push(name);
  }
  if (families.length === 0) return { ok: false, error: 'Enter a font family, for example Roboto or "Noto Sans JP".' };
  if (families.length > MAX_FAMILIES) return { ok: false, error: `Enter at most ${MAX_FAMILIES} font families.` };
  return {
    ok: true,
    query: {
      kind: 'font',
      families,
      use: FONT_USE.includes(flags.use) ? flags.use : 'first',
      exact: flags.exact !== false,
      primaryOnly: flags.primaryOnly === true,
      includeInherited: flags.includeInherited === true,
    },
  };
}

/**
 * Parse what the user typed.
 * @returns {{ ok: true, query: object, from: 'declaration'|'list' } | { ok: false, error: string }}
 */
export function parseFontInput(input, flags = {}) {
  const text = String(input ?? '').trim();
  if (text.length > MAX_INPUT_LENGTH) return { ok: false, error: 'That is too long for a font name.' };
  const extracted = extractFontNames(text);
  if (!extracted.ok) return extracted;
  const built = buildQuery(extracted.names, flags);
  return built.ok ? { ...built, from: extracted.from } : built;
}

/** Canonical query from an untrusted object (message payloads, saved settings), or null. */
export function sanitizeFontQuery(raw) {
  if (!raw || typeof raw !== 'object' || raw.kind !== 'font' || !Array.isArray(raw.families)) return null;
  const built = buildQuery(raw.families.filter((name) => typeof name === 'string').map((name) => name.replace(/\s+/g, ' ').trim()).filter(Boolean), raw);
  return built.ok ? built.query : null;
}

export const isFontQuery = (value) => !!value && typeof value === 'object' && value.kind === 'font' && sanitizeFontQuery(value) !== null;

/** One sentence saying what a query looks for (for the preview under the input). */
export function describeFontQuery(query) {
  const names = query.families.map((name) => `"${name}"`);
  const many = query.families.length > 1;
  const how = query.exact ? '' : ' (partial names match)';
  if (!many) return `Looking for the font ${names[0]}${how}.`;
  if (query.use === 'any') return `Looking for any of ${names.join(', ')}${how}.`;
  if (query.use === 'list') return `Looking for ${names.join(' then ')} together, in that order${how}.`;
  return `Looking for the first font, ${names[0]}${how}; the others are ignored.`;
}

/* --------------------------------------------------------------- Matcher */

/**
 * @param {{ families: string[], use?: string, exact: boolean, primaryOnly: boolean }} query a sanitized query
 * @returns {{ match: (stack: string[]) => ({ matched: string[], position: number } | null) }}
 */
export function createFontMatcher(query) {
  const wanted = query.families.map(foldFamily);
  const same = query.exact ? (name, want) => name === want : (name, want) => name.includes(want);
  const use = FONT_USE.includes(query.use) ? query.use : 'first';
  const searched = use === 'any' ? wanted : wanted.slice(0, 1);

  return {
    /**
     * @param {string[]} stack names of a font-family list, in order (see splitFontStack)
     * @returns {{ matched: string[], position: number } | null} the matching names and the 1-based place of the first one
     */
    match(stack) {
      const folded = stack.map(foldFamily);

      if (use === 'list') {
        const matched = [];
        let position = 0;
        let from = 0;
        for (const want of wanted) {
          let found = -1;
          for (let i = from; i < folded.length; i += 1) {
            if (same(folded[i], want)) {
              found = i;
              break;
            }
          }
          if (found < 0) return null;
          if (!matched.length) position = found + 1;
          matched.push(stack[found]);
          from = found + 1;
        }
        return query.primaryOnly && position !== 1 ? null : { matched, position };
      }

      const limit = query.primaryOnly ? Math.min(1, stack.length) : stack.length;
      const matched = [];
      let position = 0;
      for (let i = 0; i < limit; i += 1) {
        if (searched.some((want) => same(folded[i], want))) {
          matched.push(stack[i]);
          if (!position) position = i + 1;
        }
      }
      return matched.length ? { matched, position } : null;
    },
  };
}

/* ------------------------------------------------------------ Declarations */

const SIZE = /(?:^|\s)(?:(?:\d*\.)?\d+(?:px|em|rem|pt|pc|cm|mm|in|q|ex|ch|vw|vh|vmin|vmax|%)|0|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)(?:\s*\/\s*\S+)?\s+/i;
const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/**
 * The family names a `font-family` or `font` declaration asks for.
 * `inherit`, `initial` and system font keywords give none.
 * @param {string} name declaration name
 * @param {string} value declaration value (variables already substituted)
 * @returns {string[]}
 */
export function familiesOfDeclaration(name, value) {
  const text = String(value ?? '').trim();
  if (!text || CSS_WIDE.has(text.toLowerCase())) return [];
  if (name === 'font-family') return splitFontStack(text);
  if (name === 'font') {
    const size = SIZE.exec(text);
    return size ? splitFontStack(text.slice(size.index + size[0].length)) : [];
  }
  return [];
}

/* ------------------------------------------------------------- Web fonts */

/** Families a Google Fonts (or compatible) stylesheet address loads: `family=Roboto:wght@400&family=Open+Sans`. */
export function googleFontFamilies(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return [];
  }
  if (!/(^|\.)(fonts\.googleapis\.com|fonts\.bunny\.net|fonts\.gstatic\.com)$/i.test(url.hostname)) return [];
  const names = [];
  for (const value of url.searchParams.getAll('family')) {
    for (const part of value.split('|')) {
      const name = part.split(':')[0].replace(/\+/g, ' ').trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/** The `url(...)` files of an @font-face `src` value, resolved against `base`. */
export function fontFaceFiles(src, base) {
  const files = [];
  const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)(?:\s*format\(\s*(['"]?)(.*?)\3\s*\))?/gi;
  for (const match of String(src ?? '').matchAll(pattern)) {
    let url = match[2];
    try {
      url = new URL(url, base).href;
    } catch {
      /* keep the written address */
    }
    if (!url.startsWith('data:')) files.push({ url, format: match[4] || null });
    else files.push({ url: 'data: URL (embedded font)', format: match[4] || null });
  }
  return files;
}
