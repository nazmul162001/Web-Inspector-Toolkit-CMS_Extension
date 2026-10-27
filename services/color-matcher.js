/**
 * Color comparison.
 *
 * Colors are compared as canonical 8-bit RGBA (see color-normalizer.js), never
 * as strings. The default is an EXACT comparison; an optional per-channel
 * tolerance (in 0..255 units) powers the "Near" match mode.
 */

import { extractColors } from './color-normalizer.js';

/**
 * @param {{r:number,g:number,b:number,a:number}} a
 * @param {{r:number,g:number,b:number,a:number}} b
 * @param {{ tolerance?: number }} [options]
 */
export function colorsMatch(a, b, { tolerance = 0 } = {}) {
  // Invisible colors are all "the same" regardless of their RGB payload.
  if (a.a === 0 || b.a === 0) return a.a === b.a;
  if (tolerance <= 0) return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
  return (
    Math.abs(a.r - b.r) <= tolerance &&
    Math.abs(a.g - b.g) <= tolerance &&
    Math.abs(a.b - b.b) <= tolerance &&
    Math.abs(a.a - b.a) <= tolerance
  );
}

const MAX_CACHE_ENTRIES = 5000;

/**
 * Build a matcher for one target color. It memoizes parsing per distinct CSS
 * value, so scanning thousands of elements that share a handful of computed
 * values only parses each value once.
 *
 * @param {{r:number,g:number,b:number,a:number}} target
 * @param {{ tolerance?: number }} [options]
 */
export function createColorMatcher(target, { tolerance = 0 } = {}) {
  const cache = new Map();

  function partsFor(value) {
    let parts = cache.get(value);
    if (parts === undefined) {
      parts = extractColors(value);
      if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
      cache.set(value, parts);
    }
    return parts;
  }

  return {
    target,
    tolerance,
    /** Does a single parsed color match the target? */
    matchesColor: (color) => colorsMatch(color, target, { tolerance }),
    /**
     * Inspect a CSS value (single color or shadow list).
     * @returns {{ parts: {raw:string,color:object}[], matches: {raw:string,color:object}[] }}
     */
    matchValue(value) {
      const parts = partsFor(value);
      if (parts.length === 0) return { parts, matches: parts };
      return { parts, matches: parts.filter((part) => colorsMatch(part.color, target, { tolerance })) };
    },
    /** Parsed colors of a value (cached). */
    partsFor,
  };
}
