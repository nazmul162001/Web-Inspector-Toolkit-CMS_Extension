/**
 * Interface language (English / Japanese).
 *
 * The code keeps writing its messages in English. When the language is
 * Japanese, any text that is shown goes through `translate()`, which looks the
 * English sentence up in the dictionary (services/i18n-ja.js), exact first,
 * then by pattern for sentences with numbers or names in them. Text that is not
 * in the dictionary (page data, URLs, selectors, CSS values) is returned as it
 * is, so a missing entry can only ever show English, never break anything.
 *
 * Pure functions, no DOM and no chrome.*, so the side panel, the page card of
 * Image Resolution and the tests share the same rules.
 */

import { EXACT_JA, makePatternsJa } from './i18n-ja.js';

const PATTERNS_JA = makePatternsJa((text) => translate(text, 'ja'));

export const LANGUAGES = Object.freeze([
  Object.freeze({ id: 'en', short: 'EN', name: 'English' }),
  Object.freeze({ id: 'ja', short: '日本語', name: '日本語' }),
]);

export const DEFAULT_LANGUAGE = 'en';
export const normalizeLanguage = (value) => (value === 'ja' ? 'ja' : 'en');

let current = DEFAULT_LANGUAGE;

export const getLanguage = () => current;

export function setLanguage(language) {
  current = normalizeLanguage(language);
  return current;
}

const SPACES = /\s+/g;
const HAS_LETTERS = /[A-Za-z]{2}/;
const cache = new Map();

const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z"“(])/;

/** The dictionary entry for a whole text, or null. */
function exact(core) {
  return EXACT_JA[core] ?? EXACT_JA[core.replace(SPACES, ' ')] ?? null;
}

/** The first pattern that fits a text, or null. */
function byPattern(core) {
  for (const [pattern, build] of PATTERNS_JA) {
    const match = pattern.exec(core);
    if (!match) continue;
    const text = typeof build === 'function' ? build(...match.slice(1), match) : build.replace(/\$(\d)/g, (_, i) => match[Number(i)] ?? '');
    if (text !== null && text !== undefined) return text;
  }
  return null;
}

/** Several sentences in one text: translate each, keep the ones that are not known. */
function bySentences(core) {
  const parts = core.split(SENTENCE_BREAK);
  if (parts.length < 2) return null;
  let known = 0;
  const out = parts.map((part) => {
    const text = exact(part) ?? byPattern(part);
    if (text === null) return part;
    known += 1;
    return text;
  });
  return known === 0 ? null : out.join(known === parts.length ? '' : ' ');
}

/** One text: a dictionary entry, then sentence by sentence, then a pattern. Null when unknown. */
function lookup(core) {
  return exact(core) ?? bySentences(core) ?? byPattern(core);
}

/** Japanese for an English UI text (or the text itself when there is none). */
export function translate(text, language = current) {
  if (language !== 'ja' || typeof text !== 'string' || !HAS_LETTERS.test(text)) return text;
  const core = text.trim();
  if (!core) return text;
  let found = cache.get(core);
  if (found === undefined) {
    found = lookup(core);
    if (cache.size > 2000) cache.clear();
    cache.set(core, found);
  }
  if (found === null) return text;
  return text.slice(0, text.indexOf(core)) + found + text.slice(text.indexOf(core) + core.length);
}
