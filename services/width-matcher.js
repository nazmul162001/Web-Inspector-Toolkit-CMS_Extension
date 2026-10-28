/**
 * Half-width / full-width character matching for "Half/Full Width Text".
 * Pure functions (no DOM, no chrome.*), shared by the content script, the
 * invisible renderer, the side panel and the tests.
 *
 * The user picks the kinds of characters to look for (numbers, letters,
 * parentheses, colons, %, ...) and whether they want the FULL-width form
 * (０１２ Ａ （） ： ％ and the ideographic space) or the HALF-width form
 * (012 A () : % and half-width katakana ｱｲｳ).
 *
 * Rules
 *  - Full-width forms are U+FF01-FF5E (the full-width twins of ASCII ! to ~),
 *    the full-width currency/sign forms U+FFE0-FFE6 (￥ ...) and the ideographic
 *    space U+3000. Normal Japanese punctuation such as 、。「」【】ー is NOT full-width
 *    text in this sense (it has no half-width twin) and is never reported.
 *  - A result is a RUN: consecutive characters of the chosen kinds, so
 *    "２０２４年" reports "２０２４" once, not four times.
 *  - Half-width mode looks for the ASCII twins. Spaces are not offered there,
 *    a normal space is everywhere. "Half-width katakana" (U+FF61-FF9F, the
 *    narrow ｱｲｳ ｡｢｣) is a half-width-only kind.
 */

export const MAX_CONTEXT_CODES = 6;

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCharCode(from + i)).join('');
const fullOf = (ascii) => Array.from(ascii, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)).join('');

const ASCII_LETTERS = range(0x41, 0x5a) + range(0x61, 0x7a);
const ASCII_SYMBOLS = '"#$&\'*+-/<=>@\\^_`|~';

/**
 * Kinds of characters. `full` / `half` list the characters of each form
 * (an empty string means the kind does not exist in that form).
 */
export const WIDTH_CATEGORIES = Object.freeze([
  { id: 'number', label: 'Numbers', fullExample: '０１２', halfExample: '012', full: fullOf('0123456789'), half: '0123456789' },
  { id: 'letter', label: 'Letters', fullExample: 'ＡＢｃ', halfExample: 'ABc', full: fullOf(ASCII_LETTERS), half: ASCII_LETTERS },
  { id: 'bracket', label: 'Parentheses and brackets', fullExample: '（）［］', halfExample: '()[]', full: `${fullOf('()[]{}')}\uff5f\uff60`, half: '()[]{}' },
  { id: 'colon', label: 'Colons and semicolons', fullExample: '：；', halfExample: ':;', full: fullOf(':;'), half: ':;' },
  { id: 'percent', label: 'Percent', fullExample: '％', halfExample: '%', full: fullOf('%'), half: '%' },
  { id: 'mark', label: 'Question and exclamation marks', fullExample: '？！', halfExample: '?!', full: fullOf('?!'), half: '?!' },
  { id: 'punct', label: 'Commas and periods', fullExample: '，．', halfExample: ',.', full: fullOf(',.'), half: ',.' },
  {
    id: 'symbol',
    label: 'Hyphens, slashes, ￥ and other symbols',
    fullExample: '－／＋￥',
    halfExample: '-/+',
    full: `${fullOf(ASCII_SYMBOLS)}\uffe0\uffe1\uffe2\uffe3\uffe4\uffe5\uffe6`,
    half: ASCII_SYMBOLS,
  },
  { id: 'space', label: 'Spaces', fullExample: '［　］', halfExample: '', full: '\u3000', half: '' },
  { id: 'kana', label: 'Half-width katakana', fullExample: '', halfExample: 'ｱｲｳ ｡｢｣', full: '', half: range(0xff61, 0xff9f) },
]);

const BY_ID = new Map(WIDTH_CATEGORIES.map((category) => [category.id, category]));
export const WIDTH_MODES = Object.freeze(['full', 'half']);

/** Is this kind of character available in this form? */
export const isAvailable = (category, mode) => (mode === 'half' ? category.half !== '' : category.full !== '');

/* ---------------------------------------------------------------- Query */

/**
 * Build a query from the checkboxes of the panel.
 * @param {string} _text unused (this tool has no text field)
 * @param {{ mode?: string, highlightOnPage?: boolean } & Record<string, boolean>} flags `mode`, one boolean per kind id
 * @returns {{ ok: true, query: object } | { ok: false, error: string }}
 */
export function parseWidthInput(_text, flags = {}) {
  const mode = WIDTH_MODES.includes(flags.mode) ? flags.mode : 'full';
  const categories = WIDTH_CATEGORIES.filter((category) => flags[category.id] !== false && isAvailable(category, mode)).map((category) => category.id);
  if (categories.length === 0) return { ok: false, error: 'Tick at least one kind of character to look for.' };
  return { ok: true, query: { kind: 'width', mode, categories, highlightOnPage: flags.highlightOnPage !== false } };
}

/** Canonical query from an untrusted object (message payloads, saved settings), or null. */
export function sanitizeWidthQuery(raw) {
  if (!raw || typeof raw !== 'object' || raw.kind !== 'width' || !Array.isArray(raw.categories)) return null;
  const flags = Object.fromEntries(WIDTH_CATEGORIES.map((category) => [category.id, raw.categories.includes(category.id)]));
  const parsed = parseWidthInput('', { ...flags, mode: raw.mode, highlightOnPage: raw.highlightOnPage });
  return parsed.ok ? parsed.query : null;
}

export const isWidthQuery = (value) => !!value && typeof value === 'object' && value.kind === 'width' && sanitizeWidthQuery(value) !== null;

/** One sentence saying what a query looks for (the line under the options). */
export function describeWidthQuery(query) {
  const names = query.categories.map((id) => BY_ID.get(id).label.toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `Looking for ${query.mode === 'half' ? 'half-width' : 'full-width'} ${list}.`;
}

/* --------------------------------------------------------------- Matcher */

/** `U+FF10` for a character. */
export const codeOf = (ch) => `U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * @param {{ mode: string, categories: string[] }} query a sanitized query
 * @returns {{ find: (text: string, limit?: number) => { start: number, end: number, kinds: string[] }[] }}
 */
export function createWidthMatcher(query) {
  const table = new Map(); // character -> kind id
  for (const id of query.categories) {
    const category = BY_ID.get(id);
    if (!category) continue;
    for (const ch of query.mode === 'half' ? category.half : category.full) table.set(ch, id);
  }

  return {
    /** Runs of consecutive wanted characters. */
    find(text, limit = Infinity) {
      const runs = [];
      let start = -1;
      let kinds = null;
      const close = (end) => {
        if (start >= 0) runs.push({ start, end, kinds: Array.from(kinds) });
        start = -1;
      };
      for (let i = 0; i < text.length; i += 1) {
        const kind = table.get(text[i]);
        if (kind === undefined) {
          close(i);
          if (runs.length >= limit) return runs;
        } else {
          if (start < 0) {
            start = i;
            kinds = new Set();
          }
          kinds.add(kind);
        }
      }
      close(text.length);
      return runs.slice(0, limit);
    },
  };
}

/* ------------------------------------------------------------ Converting */

const SIGN_TO_HALF = { '\uffe0': '\u00a2', '\uffe1': '\u00a3', '\uffe2': '\u00ac', '\uffe3': '\u00af', '\uffe4': '\u00a6', '\uffe5': '\u00a5', '\uffe6': '\u20a9' };

/**
 * The same text in the other form: full -> half (０１２ -> 012, the ideographic space -> a space)
 * or half -> full (012 -> ０１２, ｱｲｳ -> アイウ, ｶﾞ -> ガ).
 * @param {string} text
 * @param {'half'|'full'} to
 */
export function convertWidth(text, to) {
  if (to === 'half') {
    return Array.from(text, (ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
      if (code === 0x3000) return ' ';
      return SIGN_TO_HALF[ch] || ch;
    }).join('');
  }
  return text
    .replace(/[\uff61-\uff9f]+/g, (kana) => kana.normalize('NFKC'))
    .replace(/[\u0020-\u007e]/g, (ch) => (ch === ' ' ? '\u3000' : String.fromCharCode(ch.charCodeAt(0) + 0xfee0)));
}

const SHORT_LABELS = { number: 'Numbers', letter: 'Letters', bracket: 'Brackets', colon: 'Colons', percent: 'Percent', mark: 'Marks', punct: 'Punctuation', symbol: 'Symbols', space: 'Spaces', kana: 'Katakana' };

/** Short names of kind ids for pills. */
export const shortLabelsOf = (ids) => ids.map((id) => SHORT_LABELS[id]).filter(Boolean);

/** The labels of kind ids, in order. */
export const labelsOf = (ids) => ids.map((id) => BY_ID.get(id)?.label).filter(Boolean);
