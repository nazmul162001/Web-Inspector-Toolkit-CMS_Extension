/**
 * Text Highlighter: colours, rectangles and the colour ring. Pure functions
 * (no DOM, no chrome.*) shared by the page overlay and the tests.
 */

import { clampPoint, rectFromPoints } from './screenshot-geometry.js';

/** Marker colours shown in the ring (Flameshot-style). */
export const HIGHLIGHT_COLORS = Object.freeze([
  Object.freeze({ id: 'yellow', hex: '#ffe56b', label: 'Yellow highlight' }),
  Object.freeze({ id: 'green', hex: '#7bed9f', label: 'Green highlight' }),
  Object.freeze({ id: 'orange', hex: '#ff9f43', label: 'Orange highlight' }),
  Object.freeze({ id: 'pink', hex: '#ff6b81', label: 'Pink highlight' }),
  Object.freeze({ id: 'blue', hex: '#54a0ff', label: 'Blue highlight' }),
]);

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].id;
export const MIN_HIGHLIGHT = 8;

export const RING = Object.freeze({
  radius: 44,
  swatch: 30,
  count: HIGHLIGHT_COLORS.length,
});

export function colorById(id) {
  return HIGHLIGHT_COLORS.find((color) => color.id === id) || HIGHLIGHT_COLORS[0];
}

export function sanitizeHighlightColor(id) {
  return HIGHLIGHT_COLORS.some((color) => color.id === id) ? id : DEFAULT_HIGHLIGHT_COLOR;
}

export function highlightFill(hex, alpha = 0.55) {
  const value = typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : HIGHLIGHT_COLORS[0].hex;
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function highlightRect(a, b) {
  return rectFromPoints(a, b);
}

export function isUsefulRect(rect, min = MIN_HIGHLIGHT) {
  return !!(rect && rect.w >= min && rect.h >= min);
}

export function clampPagePoint(point, width, height) {
  return clampPoint(point, width, height);
}

/** Offset of one swatch from the ring centre, starting at the top and going clockwise. */
export function swatchOffset(index, count = RING.count, radius = RING.radius) {
  const total = Math.max(1, count);
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
  return { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) };
}

/**
 * Keep the ring on the page so every swatch stays visible. `rect` and
 * `bounds` are in the same coordinate space (page pixels).
 */
export function placeRingCenter(rect, bounds, radius = RING.radius, swatch = RING.swatch) {
  const pad = radius + swatch / 2 + 8;
  const maxX = Math.max(pad, (bounds?.w || pad) - pad);
  const maxY = Math.max(pad, (bounds?.h || pad) - pad);
  return {
    x: Math.min(maxX, Math.max(pad, rect.x + rect.w / 2)),
    y: Math.min(maxY, Math.max(pad, rect.y + rect.h / 2)),
  };
}
