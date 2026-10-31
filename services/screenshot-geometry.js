/**
 * Screenshot Taker: the arithmetic behind capturing and editing.
 *
 * Pure functions (no DOM, no chrome.*), shared by the content script and the
 * tests:
 *   - how a long page is cut into slices for a Full Page capture,
 *   - how big the stitched picture may be,
 *   - rectangles and shapes drawn with the mouse (Shift keeps them square /
 *     on 45 degree lines),
 *   - where the editor puts the picture, the tool palette and the action bar,
 *   - the file name of a saved screenshot.
 */

/** A Full Page capture stops here (CSS px). Longer pages are cut off and the user is told. */
export const MAX_PAGE_HEIGHT = 24000;
export const MAX_SLICES = 60;
/** The stitched picture is scaled down (never up) to stay inside these limits. */
export const MAX_PIXELS = 60_000_000;
export const MAX_SIDE = 32000;
/** Chrome allows two captures per second; stay below that. */
export const CAPTURE_GAP_MS = 600;
/** Smallest area (CSS px) that counts as a selection. */
export const MIN_SELECTION = 8;

/* ---------------------------------------------------------------- Slices */

/**
 * Scroll positions for a Full Page capture. Slices are one viewport tall; the
 * last one is moved up so it ends exactly at the bottom of the page.
 * @returns {{ positions: number[], height: number, truncated: boolean }}
 *   `height` is the page height that the slices cover (CSS px).
 */
export function planSlices({ totalHeight, viewportHeight, maxHeight = MAX_PAGE_HEIGHT, maxSlices = MAX_SLICES }) {
  const vh = Math.max(1, Math.floor(viewportHeight));
  const total = Math.max(vh, Math.ceil(totalHeight));
  const limited = Math.min(total, maxHeight, maxSlices * vh);
  const positions = [];
  for (let y = 0; y + vh < limited; y += vh) positions.push(y);
  const last = Math.max(0, limited - vh);
  if (positions.length === 0 || positions[positions.length - 1] !== last) positions.push(last);
  return { positions, height: last + vh, truncated: limited < total };
}

/** Factor (<= 1) that keeps a picture of `width` x `height` pixels inside the size limits. */
export function outputScale({ width, height, maxPixels = MAX_PIXELS, maxSide = MAX_SIDE }) {
  if (!(width > 0 && height > 0)) return 1;
  return Math.min(1, maxSide / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
}

/* ------------------------------------------------------------ Rectangles */

export const pointFrom = (x, y) => ({ x, y });

export const rectFromPoints = (a, b) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});

export const clampPoint = (point, width, height) => ({
  x: Math.min(width, Math.max(0, point.x)),
  y: Math.min(height, Math.max(0, point.y)),
});

/** Slide a rectangle without changing its size, keeping it inside `bounds`. */
export function moveRect(rect, dx, dy, bounds) {
  const maxX = Math.max(0, bounds.w - rect.w);
  const maxY = Math.max(0, bounds.h - rect.h);
  return {
    x: Math.min(maxX, Math.max(0, rect.x + dx)),
    y: Math.min(maxY, Math.max(0, rect.y + dy)),
    w: rect.w,
    h: rect.h,
  };
}

const HAS_W = /w/;
const HAS_E = /e/;
const HAS_N = /n/;
const HAS_S = /s/;

/** Resize from a handle (`nw` `n` `ne` `e` `se` `s` `sw` `w`). Opposite corners can swap. */
export function resizeRect(rect, handle, point, { min = MIN_SELECTION, bounds = null } = {}) {
  let left = HAS_W.test(handle) ? point.x : rect.x;
  let top = HAS_N.test(handle) ? point.y : rect.y;
  let right = HAS_E.test(handle) ? point.x : rect.x + rect.w;
  let bottom = HAS_S.test(handle) ? point.y : rect.y + rect.h;
  if (bounds) {
    left = Math.min(bounds.w, Math.max(0, left));
    top = Math.min(bounds.h, Math.max(0, top));
    right = Math.min(bounds.w, Math.max(0, right));
    bottom = Math.min(bounds.h, Math.max(0, bottom));
  }
  const x = Math.min(left, right);
  const y = Math.min(top, bottom);
  return { x, y, w: Math.max(min, Math.abs(right - left)), h: Math.max(min, Math.abs(bottom - top)) };
}

/**
 * The part of a captured bitmap that a selection covers.
 * @param {{x:number,y:number,w:number,h:number}} rect selection in CSS px (viewport)
 * @param {number} ratioX bitmap pixels per CSS px (horizontally)
 * @param {number} ratioY bitmap pixels per CSS px (vertically)
 * @returns {{ sx:number, sy:number, sw:number, sh:number }} whole pixels, inside the bitmap
 */
export function cropRegion(rect, ratioX, ratioY, bitmapWidth, bitmapHeight) {
  const sx = Math.min(bitmapWidth - 1, Math.max(0, Math.round(rect.x * ratioX)));
  const sy = Math.min(bitmapHeight - 1, Math.max(0, Math.round(rect.y * ratioY)));
  const sw = Math.max(1, Math.min(bitmapWidth - sx, Math.round(rect.w * ratioX)));
  const sh = Math.max(1, Math.min(bitmapHeight - sy, Math.round(rect.h * ratioY)));
  return { sx, sy, sw, sh };
}

/* ---------------------------------------------------------------- Shapes */

/** Move `end` so that the box from `start` to it is a square (the longer side wins). */
export function squareEnd(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + (dx < 0 ? -size : size), y: start.y + (dy < 0 ? -size : size) };
}

/** Move `end` onto the nearest 45 degree line from `start` (keeps the length). */
export function snapEnd(start, end, step = Math.PI / 4) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { ...end };
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
}

/**
 * The triangle of an arrow head. `base` is where the line should stop so it
 * does not poke through the tip.
 */
export function arrowHead(from, to, lineWidth) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const headLength = Math.min(Math.max(12, lineWidth * 4.2), Math.max(length * 0.6, 1));
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = (28 * Math.PI) / 180;
  const corner = (sign) => ({
    x: to.x - headLength * Math.cos(angle + sign * spread),
    y: to.y - headLength * Math.sin(angle + sign * spread),
  });
  const base = { x: to.x - headLength * 0.8 * Math.cos(angle), y: to.y - headLength * 0.8 * Math.sin(angle) };
  return { tip: { ...to }, left: corner(-1), right: corner(1), base, length: headLength };
}

/* ------------------------------------------------------------- File name */

const pad = (value) => String(value).padStart(2, '0');

/** `screenshot-example.com-20261101-143005.png` (no characters a file system dislikes). */
export function screenshotFileName(url, date = new Date(), extension = 'png') {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }
  const safeHost = host.replace(/[^a-z0-9.-]+/gi, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 60);
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return ['screenshot', safeHost, stamp].filter(Boolean).join('-') + `.${extension}`;
}

/* ---------------------------------------------------------- Editor layout */

export const LAYOUT = Object.freeze({
  margin: 16,
  gap: 10,
  labelHeight: 26,
  scrollbar: 12,
  palette: Object.freeze({ w: 52, h: 420 }),
  actions: Object.freeze({ w: 280, h: 46 }),
});

const clampTo = (value, min, max) => Math.max(min, Math.min(max, value));
const EDGE = 4;

/** Two boxes overlap when they sit closer than `gap` (used so the bars never cover each other). */
export function boxesOverlap(a, b, gap = 8) {
  return a.left < b.left + b.w + gap && a.left + a.w + gap > b.left && a.top < b.top + b.h + gap && a.top + a.h + gap > b.top;
}

function clampBox(box, viewport) {
  return {
    ...box,
    left: clampTo(box.left, EDGE, Math.max(EDGE, viewport.w - EDGE - box.w)),
    top: clampTo(box.top, EDGE, Math.max(EDGE, viewport.h - EDGE - box.h)),
  };
}

/**
 * Slots for the tool palette and the Copy/Save bar that stay on screen and
 * do not sit on top of each other (a selection on the far left or right used
 * to push both bars into the same corner).
 */
export function placeChrome(viewport, view, palette, actions, gap = LAYOUT.gap) {
  const v = view;
  const palSlots = [
    { left: v.left + v.w + gap, top: v.top },
    { left: v.left - gap - palette.w, top: v.top },
    { left: v.left + v.w + gap, top: v.top + v.h - palette.h },
    { left: v.left - gap - palette.w, top: v.top + v.h - palette.h },
    { left: v.left + v.w + gap, top: v.top + v.h + gap },
    { left: v.left - gap - palette.w, top: v.top + v.h + gap },
    { left: v.left + v.w + gap, top: v.top - gap - palette.h },
    { left: v.left - gap - palette.w, top: v.top - gap - palette.h },
    { left: viewport.w - EDGE - palette.w, top: v.top },
    { left: EDGE, top: v.top },
    { left: viewport.w - EDGE - palette.w, top: EDGE },
    { left: EDGE, top: EDGE },
  ].map((slot) => clampBox({ ...slot, w: palette.w, h: palette.h }, viewport));

  const actAround = (pal) =>
    [
      { left: v.left + v.w / 2 - actions.w / 2, top: v.top + v.h + gap },
      { left: v.left, top: v.top + v.h + gap },
      { left: v.left + v.w - actions.w, top: v.top + v.h + gap },
      { left: v.left + v.w / 2 - actions.w / 2, top: v.top - gap - actions.h },
      { left: v.left, top: v.top - gap - actions.h },
      { left: v.left + v.w - actions.w, top: v.top - gap - actions.h },
      { left: v.left + v.w + gap, top: v.top + v.h / 2 - actions.h / 2 },
      { left: v.left - gap - actions.w, top: v.top + v.h / 2 - actions.h / 2 },
      { left: pal.left + pal.w + gap, top: v.top + v.h + gap },
      { left: pal.left - gap - actions.w, top: v.top + v.h + gap },
      { left: pal.left + pal.w + gap, top: v.top - gap - actions.h },
      { left: pal.left - gap - actions.w, top: v.top - gap - actions.h },
      { left: pal.left + pal.w + gap, top: pal.top },
      { left: pal.left - gap - actions.w, top: pal.top },
      { left: pal.left + pal.w + gap, top: pal.top + pal.h - actions.h },
      { left: pal.left - gap - actions.w, top: pal.top + pal.h - actions.h },
      { left: pal.left, top: pal.top + pal.h + gap },
      { left: pal.left, top: pal.top - gap - actions.h },
      { left: v.left + v.w / 2 - actions.w / 2, top: viewport.h - EDGE - actions.h },
      { left: EDGE, top: viewport.h - EDGE - actions.h },
      { left: viewport.w - EDGE - actions.w, top: viewport.h - EDGE - actions.h },
      { left: EDGE, top: EDGE },
      { left: viewport.w - EDGE - actions.w, top: EDGE },
    ].map((slot) => clampBox({ ...slot, w: actions.w, h: actions.h }, viewport));

  const roomRight = v.left + v.w + gap + palette.w <= viewport.w - EDGE;
  const roomLeft = v.left - gap - palette.w >= EDGE;
  const roomBelow = v.top + v.h + gap + actions.h <= viewport.h - EDGE;
  const roomAbove = v.top - gap - actions.h >= EDGE;

  let best = null;
  let bestScore = -Infinity;
  for (const pal of palSlots) {
    for (const act of actAround(pal)) {
      if (boxesOverlap(pal, act, gap)) continue;
      let score = 0;
      if (pal.left >= v.left + v.w - 1) score += roomRight ? 80 : 12;
      else if (pal.left + pal.w <= v.left + 1) score += roomLeft ? 70 : 12;
      if (act.top >= v.top + v.h - 1) score += roomBelow ? 80 : 12;
      else if (act.top + act.h <= v.top + 1) score += roomAbove ? 60 : 12;
      score += boxesOverlap(pal, v, 0) ? -90 : 25;
      score += boxesOverlap(act, v, 0) ? -90 : 25;
      score -= Math.abs(pal.left - (v.left + v.w)) * 0.02 + Math.abs(pal.top - v.top) * 0.01;
      score -= Math.abs(act.top - (v.top + v.h)) * 0.02 + Math.abs(act.left + act.w / 2 - (v.left + v.w / 2)) * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = { palette: pal, actions: act };
      }
    }
  }
  if (!best) {
    const pal = clampBox({ left: v.left + v.w + gap, top: v.top, w: palette.w, h: palette.h }, viewport);
    const act = clampBox({ left: EDGE, top: viewport.h - EDGE - actions.h, w: actions.w, h: actions.h }, viewport);
    if (boxesOverlap(pal, act, gap)) act.left = clampTo(pal.left - gap - actions.w, EDGE, viewport.w - EDGE - actions.w);
    if (boxesOverlap(pal, act, gap)) act.top = clampTo(pal.top - gap - actions.h, EDGE, viewport.h - EDGE - actions.h);
    best = { palette: pal, actions: act };
  }
  return best;
}

/**
 * Where everything of the editor goes.
 *
 * @param {object} p
 * @param {{w:number,h:number}} p.viewport window size (CSS px)
 * @param {{w:number,h:number}} p.image the picture at 100% (CSS px)
 * @param {'area'|'fit'|'scroll'} p.mode
 *   area   - a selected area: shown exactly where it was on the page when it fits;
 *   fit    - the whole picture is visible (Current Screen);
 *   scroll - fitted to the width, tall pictures scroll inside the editor (Full Page).
 * @param {{x:number,y:number,w:number,h:number}} [p.rect] the selection (mode "area")
 * @param {{w:number,h:number}} [p.palette] measured size of the tool palette
 * @param {{w:number,h:number}} [p.actions] measured size of the action bar
 */
export function layoutEditor({ viewport, image, mode = 'fit', rect = null, palette = LAYOUT.palette, actions = LAYOUT.actions }) {
  const { margin, gap, labelHeight } = LAYOUT;
  const availW = Math.max(120, viewport.w - 2 * margin - palette.w - gap);
  const availH = Math.max(120, viewport.h - 2 * margin - actions.h - gap - labelHeight);

  let scale;
  let left;
  let top;
  let view;
  let stage;

  const inPlace = mode === 'area' && rect && image.w <= viewport.w && image.h <= viewport.h;
  if (inPlace) {
    scale = 1;
    stage = { w: image.w, h: image.h };
    view = { w: stage.w, h: stage.h, scrolls: false };
    left = clampTo(rect.x, 0, Math.max(0, viewport.w - view.w));
    top = clampTo(rect.y, 0, Math.max(0, viewport.h - view.h));
  } else {
    scale = Math.min(1, availW / image.w, mode === 'scroll' ? Infinity : availH / image.h);
    stage = { w: Math.max(1, Math.floor(image.w * scale)), h: Math.max(1, Math.floor(image.h * scale)) };
    const scrolls = stage.h > availH;
    view = { w: stage.w, h: Math.min(stage.h, availH), scrolls };
    const totalW = view.w + gap + palette.w;
    const totalH = labelHeight + view.h + gap + actions.h;
    left = Math.max(margin, Math.round((viewport.w - totalW) / 2));
    top = Math.max(margin + labelHeight, Math.round((viewport.h - totalH) / 2) + labelHeight);
  }

  const chrome = placeChrome(viewport, { left, top, w: view.w, h: view.h }, palette, actions, gap);
  const labelInside = top - labelHeight < EDGE || boxesOverlap({ left, top: top - labelHeight, w: 90, h: labelHeight }, chrome.palette, 4) || boxesOverlap({ left, top: top - labelHeight, w: 90, h: labelHeight }, chrome.actions, 4);

  return {
    scale,
    movable: inPlace,
    stage,
    view: { left, top, ...view },
    palette: { left: chrome.palette.left, top: chrome.palette.top },
    actions: { left: chrome.actions.left, top: chrome.actions.top },
    label: { left, top: labelInside ? top + 6 : top - labelHeight, inside: labelInside },
  };
}
