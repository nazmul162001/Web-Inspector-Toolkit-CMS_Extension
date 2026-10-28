/**
 * Text matching for Text Find. Pure functions (no DOM, no chrome.*), shared by
 * the content script, the invisible renderer, the side panel and the tests.
 *
 * Rules
 *  - Whitespace of any kind (spaces, tabs, line breaks, NBSP, ideographic
 *    space) is collapsed to a single space on BOTH sides, so "Hello   world"
 *    finds "Hello world" however the HTML is formatted.
 *  - Case-insensitive by default. Folding keeps the string length unchanged,
 *    so match offsets always point into the original text.
 *  - "Whole word" only constrains scripts that actually use word separators.
 *    Japanese, Chinese, Korean and Thai have no spaces between words, so a
 *    boundary rule would make every match fail; for them the option has no
 *    effect.
 */

export const MAX_QUERY_LENGTH = 500;

const WHITESPACE = /[\s\u00a0\u3000\u200b\ufeff]+/g;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const UNSEGMENTED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/** Collapse every whitespace run into one space (not trimmed). */
export const collapseWhitespace = (text) => String(text).replace(WHITESPACE, ' ');

/** Lower-case without ever changing the length (a few characters expand when lower-cased). */
export function foldCase(text) {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const lc = text[i].toLowerCase();
    out += lc.length === 1 ? lc : text[i];
  }
  return out;
}

/**
 * Clean user input into a canonical query, or null when there is nothing to search for.
 * @param {*} raw
 * @returns {{ kind: 'text', text: string, matchCase: boolean, wholeWord: boolean, includeAttributes: boolean, visibleOnly: boolean } | null}
 */
export function sanitizeTextQuery(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string') return null;
  const text = collapseWhitespace(raw.text).trim().slice(0, MAX_QUERY_LENGTH);
  if (!text) return null;
  return {
    kind: 'text',
    text,
    matchCase: !!raw.matchCase,
    wholeWord: !!raw.wholeWord,
    includeAttributes: !!raw.includeAttributes,
    visibleOnly: !!raw.visibleOnly,
  };
}

export const isTextQuery = (value) => !!value && typeof value === 'object' && value.kind === 'text' && sanitizeTextQuery(value) !== null;

const isWordChar = (ch) => !!ch && WORD_CHAR.test(ch) && !UNSEGMENTED.test(ch);

/** Does the match [start, end) sit on word boundaries (for scripts that have words)? */
function onWordBoundaries(haystack, start, end) {
  const first = haystack[start];
  const last = haystack[end - 1];
  if (isWordChar(first) && isWordChar(haystack[start - 1])) return false;
  if (isWordChar(last) && isWordChar(haystack[end])) return false;
  return true;
}

/**
 * @param {{ text: string, matchCase?: boolean, wholeWord?: boolean }} query
 * @returns {{ source: string, fold: (text: string) => string, find: (haystack: string, limit?: number) => {start:number,end:number}[] }}
 *   `fold` prepares a (whitespace-collapsed) haystack; `find` expects the folded haystack.
 */
export function createTextMatcher(query) {
  const clean = sanitizeTextQuery({ kind: 'text', ...query });
  if (!clean) throw new Error('Text query is empty.');
  const fold = clean.matchCase ? (text) => text : foldCase;
  const needle = fold(clean.text);

  return {
    source: clean.text,
    fold,
    find(haystack, limit = Infinity) {
      const found = [];
      if (haystack.length < needle.length) return found;
      let from = 0;
      while (found.length < limit) {
        const start = haystack.indexOf(needle, from);
        if (start === -1) break;
        const end = start + needle.length;
        if (!clean.wholeWord || onWordBoundaries(haystack, start, end)) {
          found.push({ start, end });
          from = end; // matches never overlap
        } else {
          from = start + 1;
        }
      }
      return found;
    },
  };
}
