import { afterEach, assert, describe as baseDescribe, it } from '../test-runner.js';
import {
  CAPTURE_GAP_MS,
  LAYOUT,
  MAX_PAGE_HEIGHT,
  arrowHead,
  clampPoint,
  cropRegion,
  boxesOverlap,
  layoutEditor,
  moveRect,
  outputScale,
  planSlices,
  rectFromPoints,
  resizeRect,
  screenshotFileName,
  snapEnd,
  squareEnd,
} from '../../services/screenshot-geometry.js';
import { COLORS, TOOLS, WIDTHS, annotationBounds, buildNumberMark, buildShape, drawAnnotation, hitTopAnnotation, hitsAnnotation, isVisible, nextNumber, translateAnnotation } from '../../services/screenshot-draw.js';
import { dataUrlToBlob } from '../../content/screenshot-capture.js';
import { copyImageToClipboard, openEditor } from '../../content/screenshot-editor.js';
import { selectArea } from '../../content/screenshot-selector.js';
import { createIcon } from '../../content/screenshot-icons.js';
import { FEATURES, MSG } from '../../shared/constants.js';
import { translate } from '../../services/i18n.js';
import { DEFAULT_SETTINGS } from '../../services/settings-service.js';
import {
  comboFromEvent,
  comboKeys,
  combosEqual,
  formatCombo,
  isTypingTarget,
  isUsableCombo,
  matchesCombo,
  readCombo,
  sanitizeCombo,
} from '../../services/screenshot-hotkey.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;

/* ============================================================ Geometry */

describe('Screenshot: slices of a long page', () => {
  it('uses one slice when the page fits the screen', () => {
    assert.deepEqual(planSlices({ totalHeight: 500, viewportHeight: 800 }), { positions: [0], height: 800, truncated: false });
  });

  it('steps by the screen height and ends exactly at the bottom', () => {
    const plan = planSlices({ totalHeight: 2500, viewportHeight: 1000 });
    assert.deepEqual(plan.positions, [0, 1000, 1500]); // the last slice moves up to end at 2500
    assert.equal(plan.height, 2500);
    assert.equal(plan.truncated, false);
  });

  it('needs no overlap when the height is an exact multiple', () => {
    assert.deepEqual(planSlices({ totalHeight: 3000, viewportHeight: 1000 }).positions, [0, 1000, 2000]);
  });

  it('covers every pixel of the page', () => {
    for (const total of [801, 1599, 1600, 1601, 4321, 9999]) {
      const plan = planSlices({ totalHeight: total, viewportHeight: 800 });
      let covered = 0;
      for (const top of plan.positions) {
        assert.ok(top <= covered, `gap before ${top} (total ${total})`);
        covered = Math.max(covered, top + 800);
      }
      assert.equal(covered, plan.height);
      assert.ok(plan.height >= total);
    }
  });

  it('stops at the page height limit and says so', () => {
    const plan = planSlices({ totalHeight: 100000, viewportHeight: 1000 });
    assert.equal(plan.truncated, true);
    assert.equal(plan.height, MAX_PAGE_HEIGHT);
    assert.ok(plan.positions.length <= 60);
  });

  it('also stops at the slice limit', () => {
    const plan = planSlices({ totalHeight: 50000, viewportHeight: 100, maxHeight: 50000, maxSlices: 10 });
    assert.equal(plan.positions.length, 10);
    assert.equal(plan.truncated, true);
  });

  it('keeps the photos under the browser limit of two a second', () => {
    assert.ok(CAPTURE_GAP_MS >= 500);
  });
});

describe('Screenshot: picture size limits', () => {
  it('never scales up', () => {
    assert.equal(outputScale({ width: 1000, height: 1000 }), 1);
  });
  it('scales a huge picture down to the pixel and side limits', () => {
    const scale = outputScale({ width: 4000, height: 40000 });
    assert.ok(scale < 1);
    assert.ok(4000 * scale * 40000 * scale <= 60_000_000 + 1);
    assert.ok(40000 * scale <= 32000 + 1);
  });
  it('ignores nonsense sizes', () => {
    assert.equal(outputScale({ width: 0, height: 10 }), 1);
  });
});

describe('Screenshot: rectangles and shapes', () => {
  it('makes a rectangle from any two corners', () => {
    assert.deepEqual(rectFromPoints({ x: 50, y: 40 }, { x: 10, y: 90 }), { x: 10, y: 40, w: 40, h: 50 });
  });

  it('crops a photo for the selected area, in whole pixels, inside the photo', () => {
    assert.deepEqual(cropRegion({ x: 10, y: 20, w: 100, h: 50 }, 2, 2, 1000, 800), { sx: 20, sy: 40, sw: 200, sh: 100 });
    const edge = cropRegion({ x: 990, y: 790, w: 100, h: 100 }, 1, 1, 1000, 800);
    assert.equal(edge.sx + edge.sw, 1000);
    assert.equal(edge.sy + edge.sh, 800);
    const tiny = cropRegion({ x: -5, y: -5, w: 0, h: 0 }, 1, 1, 1000, 800);
    assert.deepEqual(tiny, { sx: 0, sy: 0, sw: 1, sh: 1 });
  });

  it('keeps points inside the picture', () => {
    assert.deepEqual(clampPoint({ x: -4, y: 900 }, 800, 600), { x: 0, y: 600 });
  });

  it('slides a selection without changing its size, and keeps it on the page', () => {
    assert.deepEqual(moveRect({ x: 10, y: 20, w: 100, h: 50 }, 30, -5, { w: 400, h: 300 }), { x: 40, y: 15, w: 100, h: 50 });
    assert.deepEqual(moveRect({ x: 10, y: 20, w: 100, h: 50 }, -50, 400, { w: 400, h: 300 }), { x: 0, y: 250, w: 100, h: 50 });
  });

  it('resizes a selection from a handle, and can swap opposite sides', () => {
    assert.deepEqual(resizeRect({ x: 10, y: 10, w: 80, h: 40 }, 'se', { x: 120, y: 80 }, { min: 8 }), { x: 10, y: 10, w: 110, h: 70 });
    assert.deepEqual(resizeRect({ x: 10, y: 10, w: 80, h: 40 }, 'nw', { x: 40, y: 20 }, { min: 8 }), { x: 40, y: 20, w: 50, h: 30 });
    const swapped = resizeRect({ x: 10, y: 10, w: 80, h: 40 }, 'e', { x: 0, y: 30 }, { min: 8 });
    assert.equal(swapped.x, 0);
    assert.equal(swapped.w, 10);
  });

  it('squares a box on the longer side and keeps the direction', () => {
    assert.deepEqual(squareEnd({ x: 10, y: 10 }, { x: 60, y: 30 }), { x: 60, y: 60 });
    assert.deepEqual(squareEnd({ x: 10, y: 10 }, { x: -20, y: 15 }), { x: -20, y: 40 });
  });

  it('snaps a line to the nearest 45 degrees and keeps its length', () => {
    const end = snapEnd({ x: 0, y: 0 }, { x: 100, y: 8 });
    assert.ok(near(end.x, 100.3, 0.5) && near(end.y, 0, 0.001));
    const diagonal = snapEnd({ x: 0, y: 0 }, { x: 50, y: 60 });
    assert.ok(near(diagonal.x, diagonal.y, 0.001));
    assert.ok(near(Math.hypot(diagonal.x, diagonal.y), Math.hypot(50, 60), 0.001));
    assert.deepEqual(snapEnd({ x: 5, y: 5 }, { x: 5, y: 5 }), { x: 5, y: 5 });
  });

  it('puts the arrow tip where the mouse ended and stops the line before it', () => {
    const head = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    assert.deepEqual(head.tip, { x: 100, y: 0 });
    assert.ok(head.base.x < 100 && head.base.x > head.left.x);
    assert.ok(head.left.y * head.right.y < 0, 'the two wings are on opposite sides of the shaft');
    const short = arrowHead({ x: 0, y: 0 }, { x: 5, y: 0 }, 8);
    assert.ok(short.length <= 5, 'the head of a short arrow does not run past its start');
  });
});

describe('Screenshot: file name', () => {
  it('has the site, the date and the time', () => {
    const date = new Date(2026, 10, 1, 14, 3, 5);
    assert.equal(screenshotFileName('https://www.example.com/a/b?c=1', date), 'screenshot-www.example.com-20261101-140305.png');
  });
  it('has no characters a file system dislikes', () => {
    const name = screenshotFileName('http://[::1]:8080/', new Date(2026, 0, 2, 3, 4, 5));
    assert.ok(/^[\w.-]+$/.test(name), name);
    assert.equal(screenshotFileName('', new Date(2026, 0, 2, 3, 4, 5)), 'screenshot-20260102-030405.png');
    assert.equal(screenshotFileName('file:///Users/me/page.html', new Date(2026, 0, 2, 3, 4, 5)), 'screenshot-20260102-030405.png');
  });
});

describe('Screenshot: where the editor puts things', () => {
  const inside = (box, viewport) => box.left >= 0 && box.top >= 0 && box.left + box.w <= viewport.w + 0.5 && box.top + box.h <= viewport.h + 0.5;

  it('shows a selected area exactly where it was', () => {
    const plan = layoutEditor({ viewport: { w: 1280, h: 800 }, image: { w: 400, h: 300 }, mode: 'area', rect: { x: 200, y: 150, w: 400, h: 300 } });
    assert.equal(plan.scale, 1);
    assert.deepEqual([plan.view.left, plan.view.top, plan.view.w, plan.view.h], [200, 150, 400, 300]);
    assert.ok(plan.palette.left >= 600, 'the palette is on the right of the area');
    assert.ok(plan.actions.top >= 450, 'the action bar is under the area');
    assert.equal(boxesOverlap({ ...plan.palette, w: LAYOUT.palette.w, h: LAYOUT.palette.h }, { ...plan.actions, w: LAYOUT.actions.w, h: LAYOUT.actions.h }), false);
  });

  it('keeps the Copy/Save bar off the tool palette at the left and right edges', () => {
    const viewport = { w: 1280, h: 800 };
    const spots = [
      { x: 1180, y: 80, w: 90, h: 70 },
      { x: 8, y: 80, w: 90, h: 70 },
      { x: 1180, y: 700, w: 90, h: 80 },
      { x: 8, y: 700, w: 90, h: 80 },
      { x: 600, y: 10, w: 120, h: 80 },
      { x: 600, y: 720, w: 120, h: 70 },
    ];
    for (const rect of spots) {
      const plan = layoutEditor({ viewport, image: { w: rect.w, h: rect.h }, mode: 'area', rect });
      const palette = { ...plan.palette, w: LAYOUT.palette.w, h: LAYOUT.palette.h };
      const actions = { ...plan.actions, w: LAYOUT.actions.w, h: LAYOUT.actions.h };
      assert.equal(boxesOverlap(palette, actions), false, `overlap at ${rect.x},${rect.y}`);
      assert.ok(inside(palette, viewport), `palette off-screen at ${rect.x},${rect.y}`);
      assert.ok(inside(actions, viewport), `actions off-screen at ${rect.x},${rect.y}`);
    }
  });

  it('keeps every part inside the window, whatever the size', () => {
    const viewports = [{ w: 1280, h: 800 }, { w: 800, h: 600 }, { w: 500, h: 520 }, { w: 1920, h: 1080 }, { w: 380, h: 700 }];
    const images = [{ w: 532, h: 411 }, { w: 1200, h: 9000 }, { w: 3000, h: 400 }, { w: 40, h: 30 }];
    for (const viewport of viewports) {
      for (const image of images) {
        for (const mode of ['fit', 'scroll', 'area']) {
          const rect = { x: viewport.w - 30, y: viewport.h - 20, w: image.w, h: image.h };
          const plan = layoutEditor({ viewport, image, mode, rect });
          const label = `${viewport.w}x${viewport.h} ${image.w}x${image.h} ${mode}`;
          assert.ok(inside(plan.view, viewport), `view ${label}`);
          assert.ok(inside({ ...plan.palette, w: LAYOUT.palette.w, h: Math.min(LAYOUT.palette.h, viewport.h - 32) }, viewport), `palette ${label}`);
          assert.ok(inside({ ...plan.actions, w: LAYOUT.actions.w, h: LAYOUT.actions.h }, viewport) || viewport.w < LAYOUT.actions.w + 8, `actions ${label}`);
          const palette = { ...plan.palette, w: LAYOUT.palette.w, h: Math.min(LAYOUT.palette.h, viewport.h - 8) };
          const actions = { ...plan.actions, w: Math.min(LAYOUT.actions.w, viewport.w - 8), h: LAYOUT.actions.h };
          assert.equal(boxesOverlap(palette, actions), false, `overlap ${label}`);
        }
      }
    }
  });

  it('fits the whole picture for Current Screen', () => {
    const plan = layoutEditor({ viewport: { w: 1200, h: 800 }, image: { w: 1200, h: 800 }, mode: 'fit' });
    assert.ok(plan.scale < 1);
    assert.ok(plan.stage.w <= 1200 && plan.view.h === plan.stage.h && !plan.view.scrolls);
    assert.ok(near(plan.stage.w / plan.stage.h, 1.5, 0.02), 'the proportions stay the same');
  });

  it('scrolls a tall Full Page picture inside the editor at a readable width', () => {
    const plan = layoutEditor({ viewport: { w: 1200, h: 800 }, image: { w: 1000, h: 8000 }, mode: 'scroll' });
    assert.equal(plan.view.scrolls, true);
    assert.ok(plan.view.h < 800);
    assert.equal(plan.scale, 1);
  });
});

/* ================================================================ Draw */

const makeCanvas = (w, h, fill = '#ffffff') => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  return canvas;
};
const pixel = (canvas, x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
const isRed = ([r, g, b]) => r > 200 && g < 90 && b < 90;
const isWhite = ([r, g, b]) => r > 245 && g > 245 && b > 245;
const style = { color: '#ef4444', width: 6 };

describe('Screenshot: drawing tools', () => {
  it('has every tool the user asked for', () => {
    const ids = TOOLS.map((tool) => tool.id);
    for (const id of ['pen', 'line', 'arrow', 'ellipse', 'rect', 'square', 'text', 'highlight', 'blur', 'number']) assert.ok(ids.includes(id), id);
    assert.equal(new Set(TOOLS.map((tool) => tool.key)).size, TOOLS.length, 'shortcut keys are unique');
    assert.ok(COLORS.length >= 6 && WIDTHS.length === 3);
  });

  it('builds a rectangle from two corners, a square for the square tool or Shift', () => {
    const rect = buildShape('rect', { x: 10, y: 10 }, { x: 70, y: 40 }, style);
    assert.deepEqual([rect.type, rect.x, rect.y, rect.w, rect.h], ['rect', 10, 10, 60, 30]);
    const shift = buildShape('rect', { x: 10, y: 10 }, { x: 70, y: 40 }, style, { constrain: true });
    assert.equal(shift.w, shift.h);
    const square = buildShape('square', { x: 10, y: 10 }, { x: 70, y: 40 }, style);
    assert.equal(square.w, square.h);
    const circle = buildShape('ellipse', { x: 10, y: 10 }, { x: 70, y: 40 }, style, { constrain: true });
    assert.equal(circle.type, 'ellipse');
    assert.equal(circle.w, circle.h);
    const oval = buildShape('ellipse', { x: 10, y: 10 }, { x: 70, y: 40 }, style);
    assert.ok(oval.w !== oval.h);
  });

  it('ignores a click that made no shape', () => {
    assert.equal(buildShape('rect', { x: 5, y: 5 }, { x: 5, y: 5 }, style), null);
    assert.equal(buildShape('arrow', { x: 5, y: 5 }, { x: 6, y: 5 }, style), null);
    assert.equal(buildShape('unknown', { x: 0, y: 0 }, { x: 50, y: 50 }, style), null);
    assert.equal(isVisible({ type: 'text', text: '   ', x: 0, y: 0, color: '#000', size: 12 }), false);
  });

  it('paints a rectangle outline (not a filled box)', () => {
    const canvas = makeCanvas(100, 100);
    drawAnnotation(canvas.getContext('2d'), { type: 'rect', x: 20, y: 20, w: 60, h: 40, ...style });
    assert.ok(isRed(pixel(canvas, 50, 20)), 'top edge');
    assert.ok(isRed(pixel(canvas, 20, 40)), 'left edge');
    assert.ok(isWhite(pixel(canvas, 50, 40)), 'inside stays clear');
    assert.ok(isWhite(pixel(canvas, 5, 5)));
  });

  it('paints a highlighter as a translucent fill', () => {
    const canvas = makeCanvas(100, 100);
    drawAnnotation(canvas.getContext('2d'), { type: 'highlight', x: 20, y: 20, w: 60, h: 40, color: '#ffe56b' });
    const [r, g, b, a] = pixel(canvas, 50, 40);
    assert.ok(r > 240 && g > 200 && b < 230 && g > b && a > 0, `inside is tinted yellow, got ${r},${g},${b},${a}`);
    assert.ok(isWhite(pixel(canvas, 5, 5)));
    const shape = buildShape('highlight', { x: 10, y: 10 }, { x: 80, y: 50 }, style);
    assert.equal(shape.type, 'highlight');
    assert.equal(shape.w, 70);
    assert.equal(isVisible(shape), true);
  });

  it('paints a blur by sampling the original picture', () => {
    const src = makeCanvas(100, 100);
    const painted = src.getContext('2d');
    painted.fillStyle = '#ffffff';
    painted.fillRect(0, 0, 50, 100);
    painted.fillStyle = '#000000';
    painted.fillRect(50, 0, 50, 100);
    const out = makeCanvas(100, 100);
    out.getContext('2d').drawImage(src, 0, 0);
    drawAnnotation(out.getContext('2d'), { type: 'blur', x: 20, y: 20, w: 60, h: 60, radius: 10 }, src);
    const [r] = pixel(out, 50, 50);
    assert.ok(r > 20 && r < 235, `the edge is softened, got ${r}`);
    assert.ok(isWhite(pixel(out, 5, 5)), 'outside the box is unchanged');
    const shape = buildShape('blur', { x: 10, y: 10 }, { x: 80, y: 50 }, style);
    assert.equal(shape.type, 'blur');
    assert.ok(shape.radius >= 6);
  });

  it('paints a numbered circle in the chosen colour', () => {
    const canvas = makeCanvas(100, 100);
    const mark = buildNumberMark({ x: 50, y: 50 }, [], { color: '#22c55e', width: 4 });
    assert.equal(mark.type, 'number');
    assert.equal(mark.n, 1);
    assert.equal(nextNumber([mark]), 2);
    drawAnnotation(canvas.getContext('2d'), mark);
    const [r, g, b] = pixel(canvas, 50, 38);
    assert.ok(g > 140 && g > r && g > b, `the disk is green, got ${r},${g},${b}`);
    assert.ok(isWhite(pixel(canvas, 5, 5)), 'outside the circle is unchanged');
    assert.equal(isVisible(mark), true);
    assert.equal(hitsAnnotation(mark, { x: 50, y: 50 }), true);
    assert.equal(hitsAnnotation(mark, { x: 5, y: 5 }), false);
  });

  it('paints a circle outline', () => {
    const canvas = makeCanvas(100, 100);
    drawAnnotation(canvas.getContext('2d'), { type: 'ellipse', x: 20, y: 20, w: 60, h: 60, ...style });
    assert.ok(isRed(pixel(canvas, 50, 20)));
    assert.ok(isRed(pixel(canvas, 80, 50)));
    assert.ok(isWhite(pixel(canvas, 50, 50)));
    assert.ok(isWhite(pixel(canvas, 22, 22)), 'the corner of the box is outside the circle');
  });

  it('paints a line and an arrow with a head', () => {
    const line = makeCanvas(100, 100);
    drawAnnotation(line.getContext('2d'), { type: 'line', from: { x: 10, y: 50 }, to: { x: 90, y: 50 }, ...style });
    assert.ok(isRed(pixel(line, 50, 50)));
    assert.ok(isWhite(pixel(line, 50, 60)));

    const arrow = makeCanvas(120, 100);
    drawAnnotation(arrow.getContext('2d'), { type: 'arrow', from: { x: 10, y: 50 }, to: { x: 110, y: 50 }, ...style });
    assert.ok(isRed(pixel(arrow, 50, 50)), 'shaft');
    assert.ok(isRed(pixel(arrow, 105, 50)), 'tip');
    assert.ok(isRed(pixel(arrow, 98, 56)), 'the head is wider than the shaft');
  });

  it('paints a pen stroke through its points, and a dot for a single click', () => {
    const canvas = makeCanvas(100, 100);
    drawAnnotation(canvas.getContext('2d'), { type: 'pen', points: [{ x: 10, y: 10 }, { x: 40, y: 50 }, { x: 90, y: 90 }], ...style });
    assert.ok(isRed(pixel(canvas, 10, 10)));
    assert.ok(isRed(pixel(canvas, 90, 90)));
    assert.ok(isWhite(pixel(canvas, 90, 10)));
    const dot = makeCanvas(40, 40);
    drawAnnotation(dot.getContext('2d'), { type: 'pen', points: [{ x: 20, y: 20 }], color: '#ef4444', width: 10 });
    assert.ok(isRed(pixel(dot, 20, 20)));
  });

  it('paints text in the chosen colour', () => {
    const canvas = makeCanvas(200, 60);
    drawAnnotation(canvas.getContext('2d'), { type: 'text', x: 5, y: 5, text: 'MMMM', color: '#ef4444', size: 40 });
    let red = 0;
    const data = canvas.getContext('2d').getImageData(0, 0, 200, 60).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 90) red += 1;
    assert.ok(red > 300, `text pixels: ${red}`);
  });

  it('slides a mark without changing its size or shape', () => {
    const arrow = translateAnnotation({ type: 'arrow', from: { x: 10, y: 10 }, to: { x: 40, y: 10 }, color: '#f00', width: 4 }, 20, -5);
    assert.deepEqual([arrow.from, arrow.to], [{ x: 30, y: 5 }, { x: 60, y: 5 }]);
    const circle = translateAnnotation({ type: 'ellipse', x: 8, y: 8, w: 20, h: 20, color: '#f00', width: 4 }, 5, 5);
    assert.deepEqual([circle.x, circle.y, circle.w, circle.h], [13, 13, 20, 20]);
    const pen = translateAnnotation({ type: 'pen', points: [{ x: 0, y: 0 }, { x: 4, y: 4 }], color: '#f00', width: 3 }, 1, 2);
    assert.deepEqual(pen.points, [{ x: 1, y: 2 }, { x: 5, y: 6 }]);
  });

  it('finds a mark under the pointer, preferring the one on top', () => {
    const arrow = { type: 'arrow', from: { x: 10, y: 40 }, to: { x: 90, y: 40 }, color: '#f00', width: 4 };
    const rect = { type: 'rect', x: 20, y: 20, w: 60, h: 40, color: '#f00', width: 4 };
    assert.equal(hitsAnnotation(arrow, { x: 50, y: 40 }), true);
    assert.equal(hitsAnnotation(arrow, { x: 50, y: 80 }), false);
    assert.equal(hitsAnnotation(rect, { x: 20, y: 40 }, { selected: false }), true, 'the stroke of a rectangle');
    assert.equal(hitsAnnotation(rect, { x: 50, y: 40 }, { selected: false }), false, 'the hole of an unselected rectangle stays free to draw in');
    assert.equal(hitsAnnotation(rect, { x: 50, y: 40 }, { selected: true }), true, 'a selected rectangle can be grabbed from the inside');
    assert.equal(hitTopAnnotation([arrow, rect], { x: 20, y: 20 }), 1);
    assert.ok(annotationBounds(arrow).w >= 80);
    const blur = { type: 'blur', x: 20, y: 20, w: 60, h: 40, radius: 12 };
    assert.equal(hitsAnnotation(blur, { x: 50, y: 40 }), true, 'a blur is grabbed from the inside');
    assert.equal(hitsAnnotation(blur, { x: 5, y: 5 }), false);
  });
});

/* =============================================================== Misc */

describe('Screenshot: reading a photo from Chrome', () => {
  it('turns a data URL into a PNG blob without fetch()', async () => {
    const source = makeCanvas(8, 6, '#00ff00');
    const blob = dataUrlToBlob(source.toDataURL('image/png'));
    assert.equal(blob.type, 'image/png');
    const bitmap = await createImageBitmap(blob);
    assert.deepEqual([bitmap.width, bitmap.height], [8, 6]);
  });
  it('rejects something that is not a data URL', () => {
    let error;
    try {
      dataUrlToBlob('https://example.com/a.png');
    } catch (caught) {
      error = caught;
    }
    assert.ok(error && error.code === 'CAPTURE_FAILED');
  });
});

describe('Screenshot: icons for the page', () => {
  it('builds svg elements without innerHTML', () => {
    for (const name of ['pen', 'line', 'arrow', 'ellipse', 'rect', 'square', 'text', 'highlight', 'blur', 'number', 'undo', 'redo', 'copy', 'save', 'close', 'check', 'alert']) {
      const svg = createIcon(name, 20);
      assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
      assert.ok(svg.childElementCount > 0, name);
      assert.equal(svg.getAttribute('width'), '20');
    }
    assert.equal(createIcon('nope').childElementCount, 0);
  });
});

describe('Screenshot: tool entry', () => {
  it('is the last tool, works in both languages and needs no scope', () => {
    const shot = FEATURES.find((feature) => feature.id === 'screenshot');
    assert.ok(shot);
    assert.equal(shot.label, 'Screenshot Taker');
    assert.equal(shot.usesScope, false);
    assert.equal(translate('Screenshot Taker', 'ja'), 'スクリーンショット');
    assert.equal(FEATURES[FEATURES.length - 1].id, 'screenshot');
    for (const type of ['SCREENSHOT_START', 'SCREENSHOT_CANCEL', 'SCREENSHOT_EDITOR', 'SCREENSHOT_CAPTURE', 'CONTENT_SCREENSHOT', 'SCREENSHOT_EVENT', 'SCREENSHOT_HOTKEY', 'SCREENSHOT_SET_HOTKEY']) assert.ok(MSG[type], type);
    assert.equal(DEFAULT_SETTINGS.screenshot.shortcut, null);
  });

  it('translates every text of the panel and the editor', () => {
    const texts = [
      'Full Page', 'Current Screen', 'Select Area', 'Pen', 'Straight line', 'Arrow', 'Circle / oval', 'Rectangle', 'Square', 'Text', 'Highlighter', 'Blur', 'Number',
      'Drag an area, then pick a colour', 'Drag an area to blur it', 'Click to place a numbered circle', 'Highlight colour', 'Yellow highlight', 'Green highlight',
      'Color and thickness', 'Undo', 'Redo', 'Copy', 'Save', 'Close', 'Thin', 'Medium', 'Thick', 'Copied to the clipboard.',
      'Could not copy the picture. Use Save instead.', 'Could not save the picture.', 'Keep editing', 'Discard', 'Discard this screenshot?',
      'Drag to select an area', 'to cancel', 'Hold Shift for a perfect circle', 'Hold Shift for a square',
      'Capture a page, mark it up, then copy or save it.', 'The editor is open on the page', 'Close editor',
      'This page is very long, so the picture stops at 24,000 px.', 'The picture was reduced in size because the page is very large.',
      'This page scrolls inside a panel, so only the visible part was captured.', 'Capturing the page… 3 of 8',
      'Chrome needs permission to photograph the tab. Nothing is uploaded.',
      'Drag the area to move it, or a handle to resize', 'Drag to resize', 'to capture', 'Drag a rectangle, then drag it to adjust. Enter or a tool takes the picture.',
      'Draw on the picture. Copy or Save also closes the editor.',
      'Shortcut',
      'Press a shortcut', 'Press keys…', 'No shortcut set', 'Click here, then press a shortcut',
      'Press the key or combination you want, then click Save.', 'Click Save to use this shortcut on any website.',
      'Shortcut saved. Press it on a website to select an area.', 'Could not save the shortcut.',
      'Allow access to websites first, then save the shortcut again.', 'Clear',
    ];
    for (const text of texts) assert.ok(translate(text, 'ja') !== text, `not translated: ${text}`);
    assert.equal(translate('Capturing the page… 3 of 8', 'ja'), 'ページをキャプチャ中… 8 枚中 3 枚目');
  });
});

describe('Screenshot: Select Area shortcut', () => {
  const combo = { key: 's', ctrl: true, alt: false, shift: true, meta: false };
  const event = (overrides = {}) => ({
    key: 's',
    code: 'KeyS',
    ctrlKey: true,
    altKey: false,
    shiftKey: true,
    metaKey: false,
    repeat: false,
    ...overrides,
  });

  it('keeps a real key and drops junk fields', () => {
    assert.equal(sanitizeCombo(null), null);
    assert.equal(sanitizeCombo({ key: 'escape', ctrl: true }), null);
    assert.equal(sanitizeCombo({ key: 's', ctrl: true, evil: 1 }).evil, undefined);
    assert.deepEqual(sanitizeCombo({ key: 'S', ctrl: 1, alt: 0, shift: 1, meta: 0 }), combo);
    assert.deepEqual(sanitizeCombo({ key: 's' }), { key: 's', ctrl: false, alt: false, shift: false, meta: false });
    assert.equal(isUsableCombo({ key: 's' }), true);
    assert.equal(isUsableCombo({ key: 'escape' }), false);
    assert.equal(isUsableCombo(combo), true);
  });

  it('reads a key press and matches the same combo later', () => {
    assert.deepEqual(comboFromEvent(event()), combo);
    assert.deepEqual(readCombo(event({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })), {
      key: 's',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    });
    assert.equal(comboFromEvent(event({ key: 'Escape', code: 'Escape', ctrlKey: true })), null);
    assert.equal(comboFromEvent(event({ key: 'Control', code: 'ControlLeft', ctrlKey: true })), null);
    assert.equal(matchesCombo(event(), combo), true);
    assert.equal(matchesCombo(event({ shiftKey: false }), combo), false);
    assert.equal(matchesCombo(event({ repeat: true }), combo), false);
    assert.equal(combosEqual(combo, { ...combo }), true);
    assert.equal(combosEqual(combo, { ...combo, alt: true }), false);
    assert.deepEqual(comboKeys(combo), ['Ctrl', 'Shift', 'S']);
    assert.deepEqual(comboKeys({ key: 's' }), ['S']);
    assert.equal(formatCombo(combo), 'Ctrl+Shift+S');
    assert.equal(formatCombo({ key: 's', meta: true }), '⌘+S');
  });

  it('does not steal keys while the user is typing in a field', () => {
    const input = document.createElement('input');
    const text = document.createTextNode('x');
    const box = document.createElement('div');
    box.append(text);
    document.body.append(input, box);
    assert.equal(isTypingTarget(input), true);
    assert.equal(isTypingTarget(text), false);
    assert.equal(isTypingTarget(box), false);
    input.remove();
    box.remove();
  });
});

/* ================================================================ Editor */

const opened = [];
const selectors = [];
/** A suite that closes every editor and selector it opened. */
function describe(name, define) {
  baseDescribe(name, () => {
    afterEach(() => {
      while (opened.length) opened.pop().close();
      while (selectors.length) selectors.pop().cancel();
    });
    define();
  });
}

function launch(overrides = {}) {
  const calls = { copied: [], saved: [], closed: 0 };
  const deps = {
    copyImage: async (blob) => calls.copied.push(blob),
    download: async (blob, name) => calls.saved.push({ blob, name }),
  };
  // A white picture with a blue band so that "the picture is in the export" can be checked.
  const canvas = makeCanvas(400, 300);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2255ff';
  ctx.fillRect(0, 250, 400, 50);
  const editor = openEditor({ canvas, pixelRatio: 1, mode: 'fit', language: 'en', pageUrl: 'https://example.com/page', shadowMode: 'open', deps, onClose: () => (calls.closed += 1), ...overrides });
  opened.push(editor);
  return { editor, calls, canvas };
}

const q = (editor, selector) => editor.shadow.querySelector(selector);
const qa = (editor, selector) => Array.from(editor.shadow.querySelectorAll(selector));

function pointer(editor, type, x, y, extra = {}) {
  const stage = q(editor, '.stage');
  const box = stage.getBoundingClientRect();
  const scale = box.width / editor.size.width;
  stage.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, button: 0, pointerId: 7, clientX: box.left + x * scale, clientY: box.top + y * scale, ...extra }));
}
function drag(editor, from, to, extra = {}) {
  pointer(editor, 'pointerdown', from.x, from.y, extra);
  pointer(editor, 'pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2, extra);
  pointer(editor, 'pointermove', to.x, to.y, extra);
  pointer(editor, 'pointerup', to.x, to.y, extra);
}
const press = (key, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
const exported = async (editor) => {
  const bitmap = await createImageBitmap(await editor.exportBlob());
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  return canvas;
};

describe('Screenshot editor: opening', () => {
  it('shows the picture, its size, the tools and the actions', () => {
    const { editor } = launch();
    assert.ok(document.getElementById('wit-screenshot-editor'));
    assert.equal(q(editor, '.label').textContent, '400 × 300');
    assert.equal(qa(editor, '.palette .tool[aria-pressed]').length >= TOOLS.length, true);
    for (const tool of TOOLS) assert.ok(qa(editor, '.palette .tool').some((button) => button.getAttribute('aria-label') === tool.label), tool.label);
    const labels = qa(editor, '.actions .act').map((button) => button.textContent.trim() || button.getAttribute('aria-label'));
    assert.deepEqual(labels, ['Copy', 'Save', 'Close']);
    assert.ok(!/cloud|share|upload|google|print/i.test(q(editor, '.actions').textContent + q(editor, '.palette').innerHTML), 'no cloud, share, search or print buttons');
  });

  it('starts with the arrow tool and marks the active tool', () => {
    const { editor } = launch();
    assert.equal(editor.tool, 'arrow');
    assert.equal(qa(editor, '.palette .tool[aria-pressed="true"]').length, 1);
  });

  it('closes its page elements completely', () => {
    const { editor, calls } = launch();
    editor.close();
    assert.equal(document.getElementById('wit-screenshot-editor'), null);
    assert.equal(calls.closed, 1);
    editor.close();
    assert.equal(calls.closed, 1, 'closing twice is harmless');
  });

  it('speaks Japanese when asked to', () => {
    const { editor } = launch({ language: 'ja' });
    const labels = qa(editor, '.actions .act').map((button) => button.textContent.trim() || button.getAttribute('aria-label'));
    assert.deepEqual(labels, ['コピー', '保存', '閉じる']);
    assert.ok(qa(editor, '.palette .tool').some((button) => button.getAttribute('aria-label') === '矢印'));
  });

  it('shows an instant tooltip on a tool', () => {
    const { editor } = launch();
    const pen = qa(editor, '.palette .tool').find((button) => button.getAttribute('aria-label') === 'Pen');
    assert.equal(pen.hasAttribute('title'), false);
    assert.ok(pen.getAttribute('data-tip').includes('Pen'));
    assert.ok(pen.getAttribute('data-tip').includes('P'));
    const label = pen.parentElement.querySelector('.tip-text');
    assert.ok(label.textContent.includes('Pen'));
    assert.ok(label.textContent.includes('P'));
    pen.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    const tip = q(editor, '.tip');
    assert.equal(tip.hidden, false);
    assert.ok(tip.textContent.includes('Pen'));
    assert.ok(tip.textContent.includes('P'));
    pen.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    assert.equal(tip.hidden, false);
    pen.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    assert.equal(tip.hidden, false);
    pen.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    assert.equal(tip.hidden, true);
  });

  it('shows the Japanese tooltip at once', () => {
    const { editor } = launch({ language: 'ja' });
    const copy = qa(editor, '.actions .act')[0];
    assert.ok(copy.getAttribute('data-tip').includes('コピー'));
    assert.ok(copy.parentElement.querySelector('.tip-text').textContent.includes('コピー'));
    copy.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    assert.ok(q(editor, '.tip').textContent.includes('コピー'));
  });
});

describe('Screenshot editor: drawing', () => {
  it('draws an arrow, a rectangle, a circle and a square', () => {
    const { editor } = launch();
    drag(editor, { x: 20, y: 20 }, { x: 120, y: 80 }); // arrow is the starting tool
    editor.setTool('rect');
    drag(editor, { x: 30, y: 100 }, { x: 130, y: 160 });
    editor.setTool('ellipse');
    drag(editor, { x: 150, y: 100 }, { x: 250, y: 200 });
    editor.setTool('square');
    drag(editor, { x: 260, y: 20 }, { x: 340, y: 60 });
    const types = editor.annotations.map((item) => item.type);
    assert.deepEqual(types, ['arrow', 'rect', 'ellipse', 'rect']);
    const square = editor.annotations[3];
    assert.equal(square.w, square.h);
  });

  it('shows a colour circle after a highlighter box, then paints that colour', () => {
    const { editor } = launch();
    editor.setTool('highlight');
    drag(editor, { x: 40, y: 40 }, { x: 180, y: 140 });
    assert.equal(editor.annotations.length, 0, 'the mark waits for a colour');
    const ring = q(editor, '.hl-ring');
    assert.ok(ring && !ring.hidden, 'the colour circle is in the centre of the box');
    assert.equal(qa(editor, '.hl-swatch').length, 5);
    q(editor, '.hl-swatch[data-color="green"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, pointerId: 8 }));
    assert.equal(editor.annotations.length, 1);
    assert.equal(editor.annotations[0].type, 'highlight');
    assert.equal(editor.annotations[0].color, '#7bed9f');
    assert.equal(ring.hidden, true);
  });

  it('blurs an area as soon as the box is drawn', () => {
    const { editor } = launch();
    editor.setTool('blur');
    drag(editor, { x: 40, y: 40 }, { x: 180, y: 140 });
    assert.equal(editor.annotations.length, 1);
    assert.equal(editor.annotations[0].type, 'blur');
    assert.ok(editor.annotations[0].w >= 8);
    assert.ok(editor.annotations[0].radius >= 6);
  });

  it('places numbered circles in order where you click', () => {
    const { editor } = launch();
    editor.setTool('number');
    editor.setColor('#22c55e');
    pointer(editor, 'pointerdown', 80, 80);
    pointer(editor, 'pointerup', 80, 80);
    pointer(editor, 'pointerdown', 200, 90);
    pointer(editor, 'pointerup', 200, 90);
    assert.deepEqual(editor.annotations.map((item) => [item.type, item.n, item.color]), [
      ['number', 1, '#22c55e'],
      ['number', 2, '#22c55e'],
    ]);
    editor.undo();
    pointer(editor, 'pointerdown', 220, 160);
    pointer(editor, 'pointerup', 220, 160);
    assert.equal(editor.annotations[1].n, 2, 'undoing the last number reuses that number');
  });

  it('draws a freehand pen line', () => {
    const { editor } = launch();
    editor.setTool('pen');
    pointer(editor, 'pointerdown', 10, 10);
    for (let i = 1; i <= 10; i += 1) pointer(editor, 'pointermove', 10 + i * 10, 10 + i * 5);
    pointer(editor, 'pointerup', 110, 60);
    assert.equal(editor.annotations.length, 1);
    assert.ok(editor.annotations[0].points.length > 5);
  });

  it('keeps a circle round and a line straight while Shift is held', () => {
    const { editor } = launch();
    editor.setTool('ellipse');
    drag(editor, { x: 20, y: 20 }, { x: 120, y: 60 }, { shiftKey: true });
    const circle = editor.annotations[0];
    assert.equal(circle.w, circle.h);
    editor.setTool('line');
    drag(editor, { x: 200, y: 100 }, { x: 300, y: 110 }, { shiftKey: true });
    const line = editor.annotations[1];
    assert.ok(near(line.to.y, line.from.y, 0.5), 'a nearly horizontal line becomes horizontal');
  });

  it('lets the user drag an arrow or a circle to a new place', () => {
    const { editor } = launch();
    drag(editor, { x: 40, y: 40 }, { x: 160, y: 40 });
    const before = editor.annotations[0];
    drag(editor, { x: 100, y: 40 }, { x: 140, y: 80 });
    assert.equal(editor.annotations.length, 1, 'dragging a mark does not draw a second one');
    const moved = editor.annotations[0];
    assert.ok(near(moved.from.x, before.from.x + 40, 2) && near(moved.from.y, before.from.y + 40, 2));
    assert.ok(near(moved.to.x, before.to.x + 40, 2) && near(moved.to.y, before.to.y + 40, 2));
    editor.undo();
    assert.deepEqual(editor.annotations[0].from, before.from);
    editor.setTool('ellipse');
    drag(editor, { x: 20, y: 120 }, { x: 80, y: 180 });
    const circle = editor.annotations[1];
    drag(editor, { x: 22, y: 150 }, { x: 42, y: 160 });
    assert.equal(editor.annotations[1].type, 'ellipse');
    assert.ok(near(editor.annotations[1].x, circle.x + 20, 3));
    assert.equal(editor.annotations[1].w, circle.w);
  });

  it('ignores a plain click with a shape tool', () => {
    const { editor } = launch();
    editor.setTool('rect');
    pointer(editor, 'pointerdown', 50, 50);
    pointer(editor, 'pointerup', 50, 50);
    assert.equal(editor.annotations.length, 0);
  });

  it('keeps drawing inside the picture when the pointer leaves it', () => {
    const { editor } = launch();
    editor.setTool('rect');
    drag(editor, { x: 300, y: 200 }, { x: 900, y: 700 });
    const rect = editor.annotations[0];
    assert.ok(rect.x + rect.w <= 400 && rect.y + rect.h <= 300);
  });

  it('uses the chosen colour and thickness', () => {
    const { editor } = launch();
    editor.setColor('#22c55e');
    editor.setWidth('thick');
    editor.setTool('rect');
    drag(editor, { x: 20, y: 20 }, { x: 100, y: 80 });
    const [rect] = editor.annotations;
    assert.equal(rect.color, '#22c55e');
    assert.equal(rect.width, WIDTHS.find((item) => item.id === 'thick').px);
  });

  it('draws the shapes in the picture\'s own pixels when the page is zoomed', () => {
    const { editor } = launch({ pixelRatio: 2 });
    editor.setTool('rect');
    editor.setWidth('medium');
    drag(editor, { x: 20, y: 20 }, { x: 100, y: 80 });
    assert.equal(editor.annotations[0].width, WIDTHS.find((item) => item.id === 'medium').px * 2);
  });
});

describe('Screenshot editor: text', () => {
  it('puts text where you click, in the chosen colour', async () => {
    const { editor } = launch();
    editor.setColor('#a855f7');
    editor.setTool('text');
    pointer(editor, 'pointerdown', 40, 40);
    const input = q(editor, 'textarea.text-input');
    assert.ok(input, 'a text box opens');
    input.value = 'Hello';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const [text] = editor.annotations;
    assert.equal(text.type, 'text');
    assert.equal(text.text, 'Hello');
    assert.equal(text.color, '#a855f7');
    assert.equal(q(editor, 'textarea.text-input'), null);
  });

  it('throws away empty text and Esc cancels it', () => {
    const { editor, calls } = launch();
    editor.setTool('text');
    pointer(editor, 'pointerdown', 40, 40);
    q(editor, 'textarea.text-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(editor.annotations.length, 0);
    pointer(editor, 'pointerdown', 60, 60);
    const input = q(editor, 'textarea.text-input');
    input.value = 'draft';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(editor.annotations.length, 0);
    assert.equal(editor.isClosed, false, 'Esc inside the text box does not close the editor');
    assert.equal(calls.closed, 0);
  });

  it('keeps the typed letters away from the tool shortcuts', () => {
    const { editor } = launch();
    editor.setTool('text');
    pointer(editor, 'pointerdown', 40, 40);
    press('r'); // typed into the box, not "rectangle"
    assert.equal(editor.tool, 'text');
  });
});

describe('Screenshot editor: undo, redo and keys', () => {
  it('undoes and redoes with the buttons and the keyboard', () => {
    const { editor } = launch();
    editor.setTool('rect');
    drag(editor, { x: 20, y: 20 }, { x: 80, y: 60 });
    drag(editor, { x: 100, y: 20 }, { x: 180, y: 60 });
    assert.equal(editor.annotations.length, 2);
    press('z', { ctrlKey: true });
    assert.equal(editor.annotations.length, 1);
    press('z', { ctrlKey: true, shiftKey: true });
    assert.equal(editor.annotations.length, 2);
    editor.undo();
    editor.undo();
    editor.undo(); // nothing left: harmless
    assert.equal(editor.annotations.length, 0);
    editor.redo();
    assert.equal(editor.annotations.length, 1);
  });

  it('forgets the redo list after a new drawing', () => {
    const { editor } = launch();
    editor.setTool('rect');
    drag(editor, { x: 20, y: 20 }, { x: 80, y: 60 });
    editor.undo();
    drag(editor, { x: 100, y: 20 }, { x: 180, y: 60 });
    editor.redo();
    assert.equal(editor.annotations.length, 1);
  });

  it('switches tools with the letter keys and keeps the keys from the page', () => {
    const { editor } = launch();
    let leaked = 0;
    const spy = () => (leaked += 1);
    document.addEventListener('keydown', spy);
    for (const tool of TOOLS) {
      press(tool.key);
      assert.equal(editor.tool, tool.id);
    }
    press('q');
    document.removeEventListener('keydown', spy);
    assert.equal(leaked, 0, 'the page does not see keys typed in the editor');
  });

  it('disables undo and redo when there is nothing to undo or redo', () => {
    const { editor } = launch();
    const [undo, redo] = qa(editor, '.palette .tool').slice(-2);
    assert.equal(undo.disabled, true);
    assert.equal(redo.disabled, true);
    editor.setTool('rect');
    drag(editor, { x: 20, y: 20 }, { x: 80, y: 60 });
    assert.equal(undo.disabled, false);
  });
});

describe('Screenshot editor: colour and thickness', () => {
  it('opens a panel with the colours and three thicknesses', () => {
    const { editor } = launch();
    const button = qa(editor, '.palette .tool').find((item) => item.getAttribute('aria-haspopup'));
    button.click();
    const pop = q(editor, '.pop');
    assert.ok(pop);
    assert.ok(qa(editor, '.pop .color').length >= COLORS.length);
    assert.equal(qa(editor, '.pop .width').length, 3);
    const swatches = qa(editor, '.pop .color').filter((item) => !item.classList.contains('custom'));
    assert.equal(swatches[0].getAttribute('aria-pressed'), 'true', 'the current colour starts selected');
    swatches[3].click();
    assert.equal(swatches[3].getAttribute('aria-pressed'), 'true', 'the colour you click is selected');
    assert.equal(swatches[0].getAttribute('aria-pressed'), 'false');
    assert.ok(q(editor, '.pop'), 'the panel stays open so the choice is visible');
    assert.equal(editor.annotations.length, 0);
    editor.setTool('rect');
    drag(editor, { x: 20, y: 20 }, { x: 80, y: 60 });
    assert.equal(editor.annotations[0].color, COLORS[3]);
    assert.equal(q(editor, '.pop'), null, 'it closes when drawing starts');
    button.click();
    assert.ok(q(editor, '.pop'));
    button.click();
    assert.equal(q(editor, '.pop'), null, 'the button closes it again');
  });

  it('closes when you start drawing, and with Esc before the editor does', () => {
    const { editor } = launch();
    const button = qa(editor, '.palette .tool').find((item) => item.getAttribute('aria-haspopup'));
    button.click();
    press('Escape');
    assert.equal(q(editor, '.pop'), null);
    assert.equal(editor.isClosed, false);
  });
});

describe('Screenshot editor: copy and save', () => {
  it('copies the picture with the drawings on it', async () => {
    const { editor, calls } = launch();
    editor.setTool('rect');
    editor.setWidth('thick');
    drag(editor, { x: 50, y: 50 }, { x: 200, y: 150 });
    await editor.copy();
    assert.equal(calls.copied.length, 1);
    assert.equal(calls.copied[0].type, 'image/png');
    const bitmap = await createImageBitmap(calls.copied[0]);
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    assert.deepEqual([canvas.width, canvas.height], [400, 300]);
    assert.ok(isRed(pixel(canvas, 100, 50)), 'the drawing is in the copy');
    assert.ok(isWhite(pixel(canvas, 100, 100)), 'the picture is in the copy');
    const [blue] = [pixel(canvas, 10, 280)];
    assert.ok(blue[2] > 200 && blue[0] < 80, 'the blue band is in the copy');
    assert.equal(editor.isClosed, true, 'copy closes the editor');
    assert.equal(calls.closed, 1);
  });

  it('saves a PNG named after the site and the time, then closes', async () => {
    const { editor, calls } = launch();
    await editor.save();
    assert.equal(calls.saved.length, 1);
    assert.ok(/^screenshot-example\.com-\d{8}-\d{6}\.png$/.test(calls.saved[0].name), calls.saved[0].name);
    assert.equal(calls.saved[0].blob.type, 'image/png');
    assert.equal(editor.isClosed, true);
    assert.equal(calls.closed, 1);
  });

  it('says so, in the picture\'s language, when the clipboard refuses', async () => {
    const { editor } = launch({
      language: 'ja',
      deps: {
        copyImage: async () => {
          throw new Error('denied');
        },
        download: async () => {},
      },
    });
    await editor.copy();
    assert.equal(q(editor, '.toast').dataset.tone, 'error');
    assert.equal(q(editor, '.toast span').textContent, '画像をコピーできませんでした。代わりに「保存」を使ってください。');
    assert.equal(editor.isClosed, false, 'a failed copy leaves the editor open');
    assert.equal(editor.annotations.length, 0);
  });

  it('saves with Ctrl+S and closes', async () => {
    const { editor, calls } = launch();
    press('s', { ctrlKey: true, code: 'KeyS' });
    await sleep(80);
    assert.equal(calls.saved.length, 1);
    assert.equal(editor.isClosed, true);
  });

  it('saves with ⌘S and closes', async () => {
    const { editor, calls } = launch();
    press('s', { metaKey: true, code: 'KeyS' });
    await sleep(80);
    assert.equal(calls.saved.length, 1);
    assert.equal(editor.isClosed, true);
  });

  it('copies with Ctrl+C and closes', async () => {
    const { editor, calls } = launch();
    press('c', { ctrlKey: true, code: 'KeyC' });
    await sleep(80);
    assert.equal(calls.copied.length, 1);
    assert.equal(editor.isClosed, true);
  });

  it('copies with ⌘C and closes', async () => {
    const { editor, calls } = launch();
    press('c', { metaKey: true, code: 'KeyC' });
    await sleep(80);
    assert.equal(calls.copied.length, 1);
    assert.equal(editor.isClosed, true);
  });

  it('copies when the page world sends the editor key', async () => {
    const { editor, calls } = launch();
    window.dispatchEvent(new CustomEvent('wit-screenshot-key', { detail: { letter: 'c' } }));
    await sleep(80);
    assert.equal(calls.copied.length, 1);
    assert.equal(editor.isClosed, true);
  });

  it('puts an instant tooltip on every editor-bar control', () => {
    const { editor } = launch();
    const controls = [...qa(editor, '.palette .tool'), ...qa(editor, '.actions .act')];
    assert.ok(controls.length >= 13);
    for (const control of controls) {
      assert.equal(control.hasAttribute('title'), false);
      assert.ok(control.getAttribute('data-tip'), control.getAttribute('aria-label'));
      const label = control.parentElement.querySelector('.tip-text');
      assert.equal(label.textContent, control.getAttribute('data-tip'));
    }
  });

  it('commits unfinished text before copying', async () => {
    const { editor, calls } = launch();
    editor.setTool('text');
    pointer(editor, 'pointerdown', 20, 20);
    q(editor, 'textarea.text-input').value = 'Note';
    await editor.copy();
    assert.equal(calls.copied.length, 1);
    assert.equal(editor.isClosed, true);
  });

  it('reports a clipboard that does not exist', async () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
    Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => undefined });
    let error;
    try {
      await copyImageToClipboard(new Blob(['x'], { type: 'image/png' }));
    } catch (caught) {
      error = caught;
    } finally {
      if (original) Object.defineProperty(Navigator.prototype, 'clipboard', original);
    }
    assert.ok(error);
  });

  it('saves a big picture at its full size', async () => {
    const big = makeCanvas(1200, 5000, '#ffffff');
    const { editor } = launch({ canvas: big, mode: 'scroll' });
    editor.setTool('rect');
    drag(editor, { x: 100, y: 4000 }, { x: 500, y: 4400 });
    const out = await exported(editor);
    assert.deepEqual([out.width, out.height], [1200, 5000]);
    assert.ok(isRed(pixel(out, 300, 4000)), 'a drawing far down the page is in the file');
  });
});

describe('Screenshot editor: closing', () => {
  it('closes at once when nothing was drawn', () => {
    const { editor, calls } = launch();
    press('Escape');
    assert.equal(editor.isClosed, true);
    assert.equal(calls.closed, 1);
  });

  it('asks before throwing drawings away', () => {
    const { editor, calls } = launch();
    editor.setTool('rect');
    drag(editor, { x: 20, y: 20 }, { x: 80, y: 60 });
    press('Escape');
    assert.ok(q(editor, '[role="alertdialog"]'), 'a question is shown');
    assert.equal(editor.isClosed, false);
    press('Escape'); // dismisses the question, keeps the editor
    assert.equal(q(editor, '[role="alertdialog"]'), null);
    assert.equal(editor.annotations.length, 1);
    editor.requestClose();
    qa(editor, '.dialog .act').find((button) => button.textContent === 'Discard').click();
    assert.equal(editor.isClosed, true);
    assert.equal(calls.closed, 1);
  });

  it('closes with the close button', () => {
    const { editor } = launch();
    qa(editor, '.actions .act').pop().click();
    assert.equal(editor.isClosed, true);
  });
});

describe('Screenshot editor: its own place on the page', () => {
  it('does not let the page reach inside it', () => {
    const { editor } = launch({ shadowMode: 'closed' });
    assert.equal(editor.host.shadowRoot, null);
    assert.ok(editor.shadow.querySelector('.stage'));
  });

  it('is the page\'s only addition and leaves the page\'s own styles alone', () => {
    const before = document.documentElement.children.length;
    const { editor } = launch();
    assert.equal(document.documentElement.children.length, before + 1);
    editor.close();
    assert.equal(document.documentElement.children.length, before);
    assert.equal(document.adoptedStyleSheets.length, 0);
  });
});

/* =============================================================== Selector */

function selectorPointer(root, type, x, y) {
  root.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, button: 0, pointerId: 3, clientX: x, clientY: y }));
}

describe('Screenshot: select area', () => {
  function start(language = 'en') {
    const selector = selectArea({ language, shadowMode: 'open' });
    selectors.push(selector);
    const host = document.getElementById('wit-screenshot-selector');
    return { selector, host, root: host.shadowRoot.querySelector('.root') };
  }

  it('keeps the selection so it can be moved, then takes that final box', async () => {
    const { selector, root } = start();
    selectorPointer(root, 'pointerdown', 300, 200);
    selectorPointer(root, 'pointermove', 150, 120);
    assert.equal(root.querySelector('.size').textContent, '150 × 80');
    selectorPointer(root, 'pointerup', 100, 100);
    assert.ok(document.getElementById('wit-screenshot-selector'), 'the overlay stays so the area can be moved');
    assert.ok(root.classList.contains('ready'));
    assert.ok(root.querySelector('.hint').textContent.includes('Drag the area to move it, or a handle to resize'));
    assert.equal(root.querySelectorAll('[data-handle]').length, 8);
    selectorPointer(root, 'pointerdown', 200, 150); // inside the 100,100 200×100 box
    selectorPointer(root, 'pointermove', 260, 190);
    selectorPointer(root, 'pointerup', 260, 190);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const rect = await selector.promise;
    assert.deepEqual(rect, { x: 160, y: 140, w: 200, h: 100, action: 'edit' });
    assert.equal(document.getElementById('wit-screenshot-selector'), null, 'the overlay is gone before the photo');
  });

  it('grows the box from a corner and from the middle of an edge', async () => {
    const { selector, root } = start();
    selectorPointer(root, 'pointerdown', 50, 50);
    selectorPointer(root, 'pointermove', 200, 160);
    selectorPointer(root, 'pointerup', 200, 160);
    const se = root.querySelector('[data-handle="se"]');
    selectorPointer(se, 'pointerdown', 200, 160);
    selectorPointer(root, 'pointermove', 260, 200);
    selectorPointer(root, 'pointerup', 260, 200);
    assert.equal(root.querySelector('.size').textContent, '210 × 150');
    const n = root.querySelector('[data-handle="n"]');
    selectorPointer(n, 'pointerdown', 155, 50);
    selectorPointer(root, 'pointermove', 155, 20);
    selectorPointer(root, 'pointerup', 155, 20);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.deepEqual(await selector.promise, { x: 50, y: 20, w: 210, h: 180, action: 'edit' });
  });

  it('takes the picture with a tool after the area is placed', async () => {
    const { selector, root } = start();
    selectorPointer(root, 'pointerdown', 50, 50);
    selectorPointer(root, 'pointermove', 200, 160);
    selectorPointer(root, 'pointerup', 200, 160);
    root.querySelector('.palette .tool').click();
    assert.deepEqual(await selector.promise, { x: 50, y: 50, w: 150, h: 110, action: 'edit', tool: 'pen' });
  });

  it('ignores a click and lets you try again', async () => {
    const { selector, root } = start();
    selectorPointer(root, 'pointerdown', 50, 50);
    selectorPointer(root, 'pointerup', 52, 51);
    assert.ok(document.getElementById('wit-screenshot-selector'), 'still waiting');
    selectorPointer(root, 'pointerdown', 50, 50);
    selectorPointer(root, 'pointermove', 200, 160);
    selectorPointer(root, 'pointerup', 200, 160);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.deepEqual(await selector.promise, { x: 50, y: 50, w: 150, h: 110, action: 'edit' });
  });

  it('cancels with Esc and with cancel()', async () => {
    const first = start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(await first.selector.promise, null);
    assert.equal(document.getElementById('wit-screenshot-selector'), null);
    const second = start();
    second.selector.cancel();
    assert.equal(await second.selector.promise, null);
  });

  it('tells the user what to do, in their language', () => {
    const { root } = start('ja');
    assert.ok(root.querySelector('.hint').textContent.includes('ドラッグして範囲を選択'));
  });
});
