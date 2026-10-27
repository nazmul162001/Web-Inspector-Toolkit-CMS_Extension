/**
 * Color parsing and normalization.
 *
 * NUMERIC PRECISION STRATEGY
 * --------------------------
 * Every accepted color is converted to a canonical RGBA value made of FOUR
 * INTEGERS in 0..255: { r, g, b, a }.  Alpha is stored as an 8-bit integer
 * too (a = round(alpha * 255)).  This mirrors how browsers store colors
 * internally, so two colors that render identically compare equal, and
 * comparisons are plain integer comparisons - no float epsilon problems.
 *
 *  - Float math (hsl, hwb, lab, oklch, percentages ...) is rounded to 6
 *    decimals first and only then rounded to the nearest integer, so values
 *    that land on a .5 boundary because of float error (127.49999999) are
 *    resolved the same way a decimal calculation would.
 *  - rgba(255,255,255,0.5) and #ffffff80 are the same color: round(0.5*255)
 *    = 128 = 0x80.  Alphas closer together than 1/255 cannot be told apart
 *    when rendered, so they are treated as equal.
 *  - Out-of-range channel values are clamped like CSS does.
 *  - Fully transparent colors (a = 0) are collapsed to rgba(0,0,0,0); the RGB
 *    of an invisible color is meaningless.
 *
 * Supported syntax: #rgb #rgba #rrggbb #rrggbbaa, rgb()/rgba(), hsl()/hsla(),
 * hwb(), lab(), lch(), oklab(), oklch(), color(srgb | srgb-linear | display-p3),
 * the 148 named colors and `transparent`; legacy comma syntax and modern
 * space/slash syntax; `none` components.
 */

import { NAMED_COLORS } from '../shared/named-colors.js';
import {
  hslToRgb,
  hwbToRgb,
  labToRgb,
  lchToRgb,
  oklabToRgb,
  oklchToRgb,
  colorSpaceToRgb,
} from './color-spaces.js';

/* ------------------------------------------------------------- Rounding */

const round6 = (value) => Math.round(value * 1e6) / 1e6;

/** 0..1 float -> 0..255 integer. */
function unitToByte(value) {
  const scaled = round6(value * 255);
  return Math.min(255, Math.max(0, Math.round(scaled)));
}

/** Raw 0..255 float -> integer. */
function toByte(value) {
  return Math.min(255, Math.max(0, Math.round(round6(value))));
}

function makeColor(r, g, b, a = 255) {
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return { r, g, b, a };
}

/* ---------------------------------------------------------------- Tokens */

const NUMBER_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/;

/** Returns { value, unit } | null. `none` is treated as 0. */
function parseToken(token) {
  if (token === 'none') return { value: 0, unit: '' };
  const match = NUMBER_RE.exec(token);
  if (!match) return null;
  return { value: parseFloat(match[1]), unit: match[2] || '' };
}

function parseAngle(token) {
  const parsed = parseToken(token);
  if (!parsed) return null;
  switch (parsed.unit) {
    case '':
    case 'deg':
      return parsed.value;
    case 'grad':
      return parsed.value * 0.9;
    case 'rad':
      return (parsed.value * 180) / Math.PI;
    case 'turn':
      return parsed.value * 360;
    default:
      return null;
  }
}

/** A number or a percentage mapped to `percentScale` (100% -> percentScale). */
function parseScaled(token, percentScale) {
  const parsed = parseToken(token);
  if (!parsed || (parsed.unit && parsed.unit !== '%')) return null;
  return parsed.unit === '%' ? (parsed.value / 100) * percentScale : parsed.value;
}

/** Alpha token -> 0..1. */
function parseAlpha(token) {
  if (token === undefined || token === null) return 1;
  const value = parseScaled(token, 1);
  if (value === null) return null;
  return Math.min(1, Math.max(0, value));
}

/* ------------------------------------------------------------- Functions */

function splitArguments(body) {
  let main = body;
  let alphaToken = null;
  const slash = body.indexOf('/');
  if (slash !== -1) {
    main = body.slice(0, slash);
    alphaToken = body.slice(slash + 1).trim();
    if (alphaToken === '') return null;
  }
  const components = main.trim().split(/[\s,]+/).filter(Boolean);
  return { components, alphaToken };
}

const fail = (error) => ({ error });
const ok = (color) => ({ color });

function parseFunction(name, body) {
  const args = splitArguments(body);
  if (!args) return fail(`${name}(): missing alpha value after "/".`);
  let { components, alphaToken } = args;

  // color(<space> a b c)
  if (name === 'color') {
    const [space, ...channels] = components;
    if (channels.length === 4 && alphaToken === null) alphaToken = channels.pop();
    if (!space || channels.length !== 3) return fail('color(): expected a color space and three components.');
    const values = channels.map((token) => parseScaled(token, 1));
    if (values.includes(null)) return fail('color(): components must be numbers or percentages.');
    const rgb = colorSpaceToRgb(space, ...values);
    if (!rgb) return fail(`color(): unsupported color space "${space}".`);
    const alpha = parseAlpha(alphaToken);
    if (alpha === null) return fail('color(): invalid alpha value.');
    return ok(makeColor(...rgb.map(unitToByte), unitToByte(alpha)));
  }

  // Legacy comma syntax carries alpha as a 4th component.
  if (alphaToken === null && components.length === 4) alphaToken = components.pop();
  if (components.length !== 3) {
    return fail(`${name}(): expected 3 color components${alphaToken !== null ? ' plus alpha' : ''}.`);
  }
  const alpha = parseAlpha(alphaToken ?? undefined);
  if (alpha === null) return fail(`${name}(): invalid alpha value.`);
  const a = unitToByte(alpha);
  const [c1, c2, c3] = components;

  switch (name) {
    case 'rgb':
    case 'rgba': {
      const channels = components.map((token) => {
        const parsed = parseToken(token);
        if (!parsed || (parsed.unit && parsed.unit !== '%')) return null;
        return parsed.unit === '%' ? (parsed.value / 100) * 255 : parsed.value;
      });
      if (channels.includes(null)) return fail(`${name}(): components must be numbers or percentages.`);
      return ok(makeColor(...channels.map(toByte), a));
    }
    case 'hsl':
    case 'hsla': {
      const h = parseAngle(c1);
      const s = parseScaled(c2, 1);
      const l = parseScaled(c3, 1);
      if (h === null || s === null || l === null) return fail(`${name}(): invalid hue, saturation or lightness.`);
      // Plain numbers in the s/l slots are percentages (0-100) per CSS Color 4.
      const sat = parseToken(c2).unit === '%' ? s : s / 100;
      const lig = parseToken(c3).unit === '%' ? l : l / 100;
      return ok(makeColor(...hslToRgb(h, sat, lig).map(unitToByte), a));
    }
    case 'hwb': {
      const h = parseAngle(c1);
      const w = parseScaled(c2, 1);
      const bl = parseScaled(c3, 1);
      if (h === null || w === null || bl === null) return fail('hwb(): invalid hue, whiteness or blackness.');
      const white = parseToken(c2).unit === '%' ? w : w / 100;
      const black = parseToken(c3).unit === '%' ? bl : bl / 100;
      return ok(makeColor(...hwbToRgb(h, white, black).map(unitToByte), a));
    }
    case 'lab': {
      const L = parseScaled(c1, 100);
      const A = parseScaled(c2, 125);
      const B = parseScaled(c3, 125);
      if (L === null || A === null || B === null) return fail('lab(): invalid components.');
      return ok(makeColor(...labToRgb(L, A, B).map(unitToByte), a));
    }
    case 'lch': {
      const L = parseScaled(c1, 100);
      const C = parseScaled(c2, 150);
      const H = parseAngle(c3);
      if (L === null || C === null || H === null) return fail('lch(): invalid components.');
      return ok(makeColor(...lchToRgb(L, C, H).map(unitToByte), a));
    }
    case 'oklab': {
      const L = parseScaled(c1, 1);
      const A = parseScaled(c2, 0.4);
      const B = parseScaled(c3, 0.4);
      if (L === null || A === null || B === null) return fail('oklab(): invalid components.');
      return ok(makeColor(...oklabToRgb(L, A, B).map(unitToByte), a));
    }
    case 'oklch': {
      const L = parseScaled(c1, 1);
      const C = parseScaled(c2, 0.4);
      const H = parseAngle(c3);
      if (L === null || C === null || H === null) return fail('oklch(): invalid components.');
      return ok(makeColor(...oklchToRgb(L, C, H).map(unitToByte), a));
    }
    default:
      return fail(`Unsupported color function "${name}()".`);
  }
}

/* ------------------------------------------------------------------ Hex */

function parseHex(digits) {
  let hex = digits;
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
  return makeColor(r, g, b, a);
}

const HEX_WITH_HASH = /^#([0-9a-f]+)$/;
const HEX_VALID_LENGTHS = new Set([3, 4, 6, 8]);
const FUNCTION_RE = /^([a-z-]+)\(\s*([\s\S]*?)\s*\)$/;

/* ---------------------------------------------------------------- Public */

/**
 * Parse a CSS color. Returns `{ color }` on success or `{ error }` with a
 * human-readable message.
 *
 * @param {string} input
 * @param {{ allowBareHex?: boolean }} [options] accept `ffffff` without `#`
 *        (user input only - never when scanning arbitrary CSS values)
 */
export function parseColorDetailed(input, { allowBareHex = false } = {}) {
  if (typeof input !== 'string') return fail('Enter a color value.');
  const text = input.trim().toLowerCase();
  if (!text) return fail('Enter a color value.');

  if (text.startsWith('#')) {
    const match = HEX_WITH_HASH.exec(text);
    if (!match) return fail('HEX colors may only contain the digits 0-9 and letters a-f.');
    if (!HEX_VALID_LENGTHS.has(match[1].length)) {
      return fail('HEX colors need 3, 4, 6 or 8 digits (#rgb, #rgba, #rrggbb, #rrggbbaa).');
    }
    return ok(parseHex(match[1]));
  }

  if (text === 'transparent') return ok(makeColor(0, 0, 0, 0));
  if (text === 'currentcolor') return fail('"currentColor" depends on the element and cannot be searched for.');

  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, text)) {
    return ok(parseHex(NAMED_COLORS[text]));
  }

  const fn = FUNCTION_RE.exec(text);
  if (fn) return parseFunction(fn[1], fn[2]);

  if (allowBareHex && /^[0-9a-f]+$/.test(text) && [3, 6, 8].includes(text.length)) {
    return ok(parseHex(text));
  }

  if (/^[a-z]+$/.test(text)) return fail(`"${input.trim()}" is not a recognised color name.`);
  return fail('Unrecognised color. Try #rrggbb, rgb(), hsl() or a color name.');
}

/** @returns {{r:number,g:number,b:number,a:number}|null} */
export function parseColor(input, options) {
  const result = parseColorDetailed(input, options);
  return result.color || null;
}

/* ------------------------------------------------------------ Formatting */

const hex2 = (n) => n.toString(16).padStart(2, '0');

/** `#rrggbb`, or `#rrggbbaa` when not fully opaque (or `forceAlpha`). */
export function toHex(color, { forceAlpha = false } = {}) {
  const base = `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
  return forceAlpha || color.a < 255 ? base + hex2(color.a) : base;
}

/** Alpha as a 0..1 number, shortest representation that round-trips to 8 bits. */
export function alphaToNumber(a8) {
  const two = Math.round((a8 / 255) * 100) / 100;
  if (Math.round(two * 255) === a8) return two;
  return Math.round((a8 / 255) * 1000) / 1000;
}

export function toRgbString(color) {
  return color.a === 255
    ? `rgb(${color.r}, ${color.g}, ${color.b})`
    : `rgba(${color.r}, ${color.g}, ${color.b}, ${alphaToNumber(color.a)})`;
}

/** Value for `<input type="color">` (always `#rrggbb`, alpha dropped). */
export const toColorPickerValue = (color) => toHex({ ...color, a: 255 });

export const isTransparent = (color) => color.a === 0;

/**
 * Full normalization used by the UI.
 * @returns {{ok:true,color,hex,rgb,alpha}|{ok:false,error:string}}
 */
export function normalizeColor(input, options) {
  const result = parseColorDetailed(input, options);
  if (!result.color) return { ok: false, error: result.error };
  const { color } = result;
  return { ok: true, color, hex: toHex(color), rgb: toRgbString(color), alpha: alphaToNumber(color.a) };
}

/* ------------------------------------------------- Colors inside a value */

/**
 * Split a CSS value into top-level tokens (separated by whitespace or commas
 * outside parentheses / quotes). `rgba(0, 0, 0, .2) 0 4px 6px` -> 3 tokens.
 */
export function splitValueTokens(value) {
  const tokens = [];
  let depth = 0;
  let quote = null;
  let current = '';
  const flush = () => {
    if (current) tokens.push(current);
    current = '';
  };
  for (const ch of String(value)) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '(') {
      depth += 1;
      current += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      flush();
    } else {
      current += ch;
    }
  }
  flush();
  return tokens;
}

/**
 * Extract every color from a (computed or authored) CSS value such as a
 * box-shadow list. Only tokens that are genuinely colors are returned, so
 * lengths and keywords (`0px`, `inset`) are never mistaken for colors.
 *
 * @param {string} value
 * @param {{ currentColor?: object }} [options] color to substitute for `currentcolor`
 * @returns {{raw:string,color:object}[]}
 */
export function extractColors(value, { currentColor } = {}) {
  if (!value || value === 'none') return [];
  const found = [];
  for (const token of splitValueTokens(value)) {
    if (currentColor && token.toLowerCase() === 'currentcolor') {
      found.push({ raw: token, color: currentColor });
      continue;
    }
    const color = parseColor(token);
    if (color) found.push({ raw: token, color });
  }
  return found;
}
