/**
 * Color-space conversions to gamma-encoded sRGB.
 *
 * Every function returns `[r, g, b]` as floats in 0..1 (NOT yet rounded or
 * clamped to the gamut - color-normalizer.js does that exactly once so the
 * numeric strategy lives in a single place).
 *
 * Formulas and matrices follow CSS Color Module Level 4.
 */

const D50 = [0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585];

const mul = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const XYZ_D65_TO_LINEAR_SRGB = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];

const XYZ_D50_TO_D65 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];

const LINEAR_P3_TO_XYZ_D65 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0.0, 0.04511338185890264, 1.043944368900976],
];

export const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** sRGB transfer function (also used by display-p3). */
export function gammaEncode(linear) {
  const abs = Math.abs(linear);
  const sign = linear < 0 ? -1 : 1;
  return abs > 0.0031308 ? sign * (1.055 * abs ** (1 / 2.4) - 0.055) : 12.92 * linear;
}

export function gammaDecode(encoded) {
  const abs = Math.abs(encoded);
  const sign = encoded < 0 ? -1 : 1;
  return abs <= 0.04045 ? encoded / 12.92 : sign * ((abs + 0.055) / 1.055) ** 2.4;
}

const encodeAll = (linear) => linear.map(gammaEncode);

/** @param h degrees, s/l 0..1 */
export function hslToRgb(h, s, l) {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = Math.min(1, Math.max(0, s));
  const light = Math.min(1, Math.max(0, l));
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)];
}

/** @param h degrees, w/b 0..1 */
export function hwbToRgb(h, w, b) {
  let white = Math.min(1, Math.max(0, w));
  let black = Math.min(1, Math.max(0, b));
  if (white + black >= 1) {
    const gray = white / (white + black);
    return [gray, gray, gray];
  }
  const base = hslToRgb(h, 1, 0.5);
  return base.map((c) => c * (1 - white - black) + white);
}

/** CIE Lab (D50) -> sRGB. L 0..100. */
export function labToRgb(L, a, b) {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const f1 = (L + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const xyzD50 = [
    (f0 ** 3 > epsilon ? f0 ** 3 : (116 * f0 - 16) / kappa) * D50[0],
    (L > kappa * epsilon ? ((L + 16) / 116) ** 3 : L / kappa) * D50[1],
    (f2 ** 3 > epsilon ? f2 ** 3 : (116 * f2 - 16) / kappa) * D50[2],
  ];
  return encodeAll(mul(XYZ_D65_TO_LINEAR_SRGB, mul(XYZ_D50_TO_D65, xyzD50)));
}

export function lchToRgb(L, C, H) {
  const hue = toRadians(H);
  return labToRgb(L, C * Math.cos(hue), C * Math.sin(hue));
}

/** Oklab -> sRGB. L 0..1. */
export function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return encodeAll([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]);
}

export function oklchToRgb(L, C, H) {
  const hue = toRadians(H);
  return oklabToRgb(L, C * Math.cos(hue), C * Math.sin(hue));
}

/**
 * color(<space> r g b) for the spaces we support. Returns null for others.
 * Out-of-gamut display-p3 values are clipped by the caller.
 */
export function colorSpaceToRgb(space, r, g, b) {
  switch (space) {
    case 'srgb':
      return [r, g, b];
    case 'srgb-linear':
      return encodeAll([r, g, b]);
    case 'display-p3': {
      const linear = [gammaDecode(r), gammaDecode(g), gammaDecode(b)];
      return encodeAll(mul(XYZ_D65_TO_LINEAR_SRGB, mul(LINEAR_P3_TO_XYZ_D65, linear)));
    }
    default:
      return null;
  }
}
