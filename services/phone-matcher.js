/**
 * Telephone number matching. Pure functions (no DOM, no chrome.*), shared by
 * the content script, the invisible renderer, the side panel and the tests.
 *
 * A phone number is compared by its DIGITS only, so the way it is written does
 * not matter: `080-1234-5678`, `08012345678`, `080 1234 5678`, `(080)1234-5678`,
 * `080.1234.5678` and full-width `０８０－１２３４－５６７８` are all the same number.
 *
 * Rules
 *  - A number in a text is a run of digits that may be joined by short gaps of
 *    separators (spaces, hyphens of every kind, dots, parentheses). Letters, commas and
 *    other characters end the run, so "1,234" or "ab12cd34" are never one number.
 *  - "Exact" rejects a match that continues into more digits joined by hyphens,
 *    dots or nothing (so 1234-5678 is not found inside 080-1234-5678 and
 *    080-1234-5678 is not found inside 080-1234-56789). A gap that contains a
 *    space counts as the end of a number, so "03-1234-5678 080-1111-2222" holds two numbers.
 *  - "International" treats +81 80 1234 5678 / +81 (0)80 1234 5678 and
 *    080 1234 5678 as the same number, in either direction (and +1 555 555 0123
 *    as 555 555 0123). The country code length is not guessed: 1 to 3 digits are tried.
 */

export const MIN_DIGITS = 4;
export const MAX_DIGITS = 15;
const MAX_GAP = 3;
const MAX_INPUT_LENGTH = 40;

const SEPARATORS = new Set([
  ' ', '\u00a0', '\u3000', '-', '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212', '\uff0d',
  '\u30fc', '\uff70', '.', '(', ')', '\uff08', '\uff09',
]);
const PLUS = new Set(['+', '\uff0b']);
const SPACE = /[\s\u00a0\u3000]/;

/** ASCII digit for ASCII or full-width digits, otherwise null. */
function digitOf(ch) {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return ch;
  if (code >= 0xff10 && code <= 0xff19) return String(code - 0xff10);
  return null;
}

/* ---------------------------------------------------------------- Query */

/**
 * Parse what the user typed.
 * @returns {{ ok: true, query: object } | { ok: false, error: string }}
 */
export function parsePhoneInput(input, flags = {}) {
  const text = String(input ?? '').trim();
  if (!text) return { ok: false, error: 'Enter a phone number, for example 080-1234-5678.' };
  if (text.length > MAX_INPUT_LENGTH) return { ok: false, error: 'That is too long for a phone number.' };

  let digits = '';
  let plus = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const d = digitOf(ch);
    if (d !== null) digits += d;
    else if (PLUS.has(ch) && i === 0) plus = true;
    else if (!SEPARATORS.has(ch)) {
      return { ok: false, error: 'Use digits only, with optional spaces, - ( ) . or a leading +.' };
    }
  }
  if (digits.length < MIN_DIGITS) return { ok: false, error: `Enter at least ${MIN_DIGITS} digits.` };
  if (digits.length > MAX_DIGITS) return { ok: false, error: `A phone number has at most ${MAX_DIGITS} digits.` };

  return {
    ok: true,
    query: {
      kind: 'phone',
      number: text.replace(/\s+/g, ' '),
      digits,
      plus,
      exact: flags.exact !== false,
      international: flags.international !== false,
      includeLinks: flags.includeLinks !== false,
    },
  };
}

/** Canonical query from an untrusted object (message payloads, saved settings), or null. */
export function sanitizePhoneQuery(raw) {
  if (!raw || typeof raw !== 'object' || raw.kind !== 'phone' || typeof raw.number !== 'string') return null;
  const parsed = parsePhoneInput(raw.number, raw);
  return parsed.ok ? parsed.query : null;
}

export const isPhoneQuery = (value) => !!value && typeof value === 'object' && value.kind === 'phone' && sanitizePhoneQuery(value) !== null;

/** `tel:+81-80-1234-5678;ext=1` -> `+81-80-1234-5678` (null when it is not a phone link). */
export function phoneFromHref(href) {
  const match = /^(?:tel|callto):(.*)$/i.exec(String(href ?? '').trim());
  if (!match) return null;
  let value = match[1];
  try {
    value = decodeURIComponent(value);
  } catch {
    /* keep the raw value */
  }
  value = value.split(/[;?]/)[0].trim();
  return value || null;
}

/* ----------------------------------------------------------------- Runs */

/**
 * The digit runs of a text: digits joined by gaps of at most MAX_GAP separator characters.
 * `idx[k]` is the position of digit k in the text, `gaps[k]` the text between digit k-1 and k.
 */
function extractRuns(text) {
  const runs = [];
  let run = null;
  let gap = 0;
  let last = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const d = digitOf(ch);
    if (d !== null) {
      if (run && gap > MAX_GAP) {
        runs.push(run);
        run = null;
      }
      if (!run) {
        run = { digits: '', idx: [], gaps: [], plusAt: -1 };
        let k = i - 1;
        let steps = 0;
        while (k >= 0 && SEPARATORS.has(text[k]) && steps < MAX_GAP) {
          k -= 1;
          steps += 1;
        }
        if (k >= 0 && PLUS.has(text[k])) run.plusAt = k;
      }
      run.gaps.push(run.digits.length === 0 ? '' : text.slice(last + 1, i));
      run.digits += d;
      run.idx.push(i);
      last = i;
      gap = 0;
    } else if (SEPARATORS.has(ch)) {
      gap += 1;
    } else {
      if (run) runs.push(run);
      run = null;
      gap = 0;
    }
  }
  if (run) runs.push(run);
  return runs;
}

/** True when digits [start, end) are not glued to neighbouring digits of the same number. */
function standsAlone(run, start, end) {
  const glued = (gap) => !SPACE.test(gap); // '' (adjacent digits), '-', '.', ')' ... keep a number going
  if (start > 0 && glued(run.gaps[start])) return false;
  if (end < run.digits.length && glued(run.gaps[end])) return false;
  return true;
}

function* occurrences(haystack, needle) {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return;
    yield at;
    from = at + 1;
  }
}

/* -------------------------------------------------------------- Matching */

/**
 * @param {object} query sanitized phone query
 * @returns {{ find: (text: string, limit?: number) => {start:number,end:number}[] }}
 */
export function createPhoneMatcher(query) {
  const clean = sanitizePhoneQuery({ ...query, kind: 'phone' });
  if (!clean) throw new Error('Phone query is invalid.');
  const { digits, exact, international } = clean;

  function candidates(run) {
    const found = [];
    const add = (start, end) => found.push({ start, end });

    for (const at of occurrences(run.digits, digits)) add(at, at + digits.length);

    if (international) {
      if (clean.plus) {
        // +CC rest  ->  also the domestic form 0rest (country code of 1 to 3 digits)
        for (let cc = 1; cc <= 3; cc += 1) {
          const domestic = `0${digits.slice(cc)}`;
          if (domestic.length < MIN_DIGITS) continue;
          for (const at of occurrences(run.digits, domestic)) add(at, at + domestic.length);
        }
      } else if (run.plusAt >= 0) {
        // 0rest or rest  ->  also +CC rest (and +CC (0)rest)
        const rest = digits.startsWith('0') ? digits.slice(1) : null;
        for (let cc = 1; cc <= 3; cc += 1) {
          if (run.digits.startsWith(digits, cc)) add(0, cc + digits.length);
          if (rest && run.digits.startsWith(rest, cc)) add(0, cc + rest.length);
        }
      }
    }
    return found;
  }

  return {
    find(text, limit = Infinity) {
      const hits = [];
      for (const run of extractRuns(text)) {
        for (const cand of candidates(run)) {
          if (exact && !standsAlone(run, cand.start, cand.end)) continue;
          // Include the "+" in front of a number that starts the run.
          const start = cand.start === 0 && run.plusAt >= 0 ? run.plusAt : run.idx[cand.start];
          hits.push({ start, end: run.idx[cand.end - 1] + 1 });
        }
      }
      // earliest first, longest first; never overlapping
      hits.sort((a, b) => a.start - b.start || b.end - a.end);
      const result = [];
      let edge = -1;
      for (const hit of hits) {
        if (hit.start < edge) continue;
        result.push(hit);
        edge = hit.end;
        if (result.length >= limit) break;
      }
      return result;
    },
  };
}
