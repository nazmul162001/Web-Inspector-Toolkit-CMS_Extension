/**
 * Screenshot Taker: the drawing tools of the editor.
 *
 * An annotation is plain data in the picture's own pixels, so the editor can
 * undo / redo it, show it on a lighter layer and paint it again at full
 * quality when the picture is copied or saved. No DOM here (only a canvas 2D
 * context is passed in), so it is shared with the tests.
 *
 *   { type: 'pen',     points: [{x,y}...], color, width }
 *   { type: 'line',    from, to,           color, width }
 *   { type: 'arrow',   from, to,           color, width }
 *   { type: 'ellipse', x, y, w, h,         color, width }
 *   { type: 'rect',    x, y, w, h,         color, width }
 *   { type: 'highlight', x, y, w, h,       color }
 *   { type: 'blur',    x, y, w, h,         radius }
 *   { type: 'number',  x, y, n,            color, radius }
 *   { type: 'text',    x, y, text,         color, size }
 */

import { arrowHead, rectFromPoints, snapEnd, squareEnd } from './screenshot-geometry.js';

/** The tools, in the order of the palette. `key` is the keyboard shortcut. */
export const TOOLS = Object.freeze([
  Object.freeze({ id: 'pen', label: 'Pen', key: 'p' }),
  Object.freeze({ id: 'line', label: 'Straight line', key: 'l' }),
  Object.freeze({ id: 'arrow', label: 'Arrow', key: 'a' }),
  Object.freeze({ id: 'ellipse', label: 'Circle / oval', hint: 'Hold Shift for a perfect circle', key: 'c' }),
  Object.freeze({ id: 'rect', label: 'Rectangle', hint: 'Hold Shift for a square', key: 'r' }),
  Object.freeze({ id: 'square', label: 'Square', key: 's' }),
  Object.freeze({ id: 'text', label: 'Text', key: 't' }),
  Object.freeze({ id: 'highlight', label: 'Highlighter', hint: 'Drag an area, then pick a colour', key: 'h' }),
  Object.freeze({ id: 'blur', label: 'Blur', hint: 'Drag an area to blur it', key: 'b' }),
  Object.freeze({ id: 'number', label: 'Number', hint: 'Click to place a numbered circle', key: 'n' }),
]);

export const COLORS = Object.freeze(['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#111827', '#ffffff']);

/** Line thickness and text size in CSS px (the editor multiplies by the picture's pixel ratio). */
export const WIDTHS = Object.freeze([
  Object.freeze({ id: 'thin', px: 2, text: 16, label: 'Thin' }),
  Object.freeze({ id: 'medium', px: 4, text: 22, label: 'Medium' }),
  Object.freeze({ id: 'thick', px: 7, text: 32, label: 'Thick' }),
]);

export const TEXT_FONT = '"Hiragino Sans", "Yu Gothic UI", Meiryo, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
export const TEXT_LINE_HEIGHT = 1.25;

/** The shape a tool makes while the mouse goes from `start` to `end` (null when it would be invisible). */
export function buildShape(tool, start, end, style, { constrain = false } = {}) {
  const { color, width } = style;
  let shape = null;
  switch (tool) {
    case 'line':
    case 'arrow':
      shape = { type: tool, from: { ...start }, to: constrain ? snapEnd(start, end) : { ...end }, color, width };
      break;
    case 'ellipse':
    case 'rect':
    case 'square':
    case 'highlight':
    case 'blur': {
      const corner = constrain || tool === 'square' ? squareEnd(start, end) : end;
      const box = rectFromPoints(start, corner);
      if (tool === 'ellipse') shape = { type: 'ellipse', ...box, color, width };
      else if (tool === 'highlight') shape = { type: 'highlight', ...box, color, width };
      else if (tool === 'blur') shape = { type: 'blur', ...box, radius: blurRadiusForWidth(width) };
      else shape = { type: 'rect', ...box, color, width };
      break;
    }
    default:
      return null;
  }
  return isVisible(shape) ? shape : null;
}

/** Something that is only a click (no size) is not worth keeping. */
export function isVisible(annotation) {
  switch (annotation.type) {
    case 'pen':
      return annotation.points.length > 1 || annotation.width > 0;
    case 'line':
    case 'arrow':
      return Math.hypot(annotation.to.x - annotation.from.x, annotation.to.y - annotation.from.y) >= 3;
    case 'ellipse':
    case 'rect':
    case 'highlight':
    case 'blur':
      return annotation.w >= 3 || annotation.h >= 3;
    case 'number':
      return annotation.n >= 1 && (annotation.radius || 0) > 0;
    case 'text':
      return annotation.text.trim().length > 0;
    default:
      return false;
  }
}

export function textLines(text) {
  return String(text).replace(/\r/g, '').split('\n');
}

/** How strong a blur is, from the current line thickness (picture pixels). */
export function blurRadiusForWidth(width) {
  const value = Number(width);
  return Math.max(6, Math.round((Number.isFinite(value) && value > 0 ? value : 4) * 3));
}

/** How big a numbered circle is, from the current line thickness (picture pixels). */
export function numberRadiusForWidth(width) {
  const value = Number(width);
  return Math.max(10, Math.round((Number.isFinite(value) && value > 0 ? value : 4) * 3.5));
}

/** The next step number after the marks already on the picture. */
export function nextNumber(annotations) {
  let max = 0;
  for (const annotation of annotations || []) {
    if (annotation.type === 'number' && Number.isFinite(annotation.n)) max = Math.max(max, annotation.n);
  }
  return max + 1;
}

/** A numbered circle at `point`. */
export function buildNumberMark(point, annotations, style) {
  return {
    type: 'number',
    x: point.x,
    y: point.y,
    n: nextNumber(annotations),
    color: style.color,
    radius: numberRadiusForWidth(style.width),
  };
}

function numberDiskRadius(annotation) {
  const base = Math.max(8, annotation.radius || 12);
  const digits = String(Math.max(1, annotation.n || 1)).length;
  return digits <= 1 ? base : Math.round(base * (0.72 + digits * 0.28));
}

function contrastInk(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(color || ''));
  if (!hex) return '#ffffff';
  const value = Number.parseInt(hex[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 186 ? '#111827' : '#ffffff';
}

function strokeStyle(ctx, { color, width }) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** Paint one annotation. `source` is the original picture, used by blur. */
export function drawAnnotation(ctx, annotation, source) {
  ctx.save();
  switch (annotation.type) {
    case 'pen': {
      strokeStyle(ctx, annotation);
      const points = annotation.points;
      ctx.beginPath();
      if (points.length === 1) {
        ctx.arc(points[0].x, points[0].y, annotation.width / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      ctx.moveTo(points[0].x, points[0].y);
      // Smooth the line through the middle of each pair of points.
      for (let i = 1; i < points.length - 1; i += 1) {
        const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
        ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
      break;
    }
    case 'line': {
      strokeStyle(ctx, annotation);
      ctx.beginPath();
      ctx.moveTo(annotation.from.x, annotation.from.y);
      ctx.lineTo(annotation.to.x, annotation.to.y);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      strokeStyle(ctx, annotation);
      const head = arrowHead(annotation.from, annotation.to, annotation.width);
      ctx.beginPath();
      ctx.moveTo(annotation.from.x, annotation.from.y);
      ctx.lineTo(head.base.x, head.base.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(head.tip.x, head.tip.y);
      ctx.lineTo(head.left.x, head.left.y);
      ctx.lineTo(head.right.x, head.right.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke(); // rounds the corners of the head
      break;
    }
    case 'ellipse': {
      strokeStyle(ctx, annotation);
      ctx.beginPath();
      ctx.ellipse(annotation.x + annotation.w / 2, annotation.y + annotation.h / 2, Math.max(0.5, annotation.w / 2), Math.max(0.5, annotation.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'rect': {
      strokeStyle(ctx, annotation);
      ctx.strokeRect(annotation.x, annotation.y, annotation.w, annotation.h);
      break;
    }
    case 'highlight': {
      ctx.fillStyle = annotation.color;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(annotation.x, annotation.y, annotation.w, annotation.h);
      ctx.globalAlpha = 1;
      break;
    }
    case 'blur': {
      if (!source) break;
      const radius = Math.max(1, annotation.radius || 12);
      ctx.beginPath();
      ctx.rect(annotation.x, annotation.y, annotation.w, annotation.h);
      ctx.clip();
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage(source, 0, 0);
      ctx.filter = 'none';
      break;
    }
    case 'number': {
      const radius = numberDiskRadius(annotation);
      ctx.beginPath();
      ctx.arc(annotation.x, annotation.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = annotation.color;
      ctx.fill();
      ctx.fillStyle = contrastInk(annotation.color);
      ctx.font = `700 ${Math.max(10, Math.round(radius * 1.15))}px ${TEXT_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(annotation.n), annotation.x, annotation.y + radius * 0.04);
      break;
    }
    case 'text': {
      ctx.fillStyle = annotation.color;
      ctx.font = `600 ${annotation.size}px ${TEXT_FONT}`;
      ctx.textBaseline = 'top';
      textLines(annotation.text).forEach((line, index) => {
        ctx.fillText(line, annotation.x, annotation.y + index * annotation.size * TEXT_LINE_HEIGHT);
      });
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

export function drawAnnotations(ctx, annotations, source) {
  for (const annotation of annotations) drawAnnotation(ctx, annotation, source);
}

/* ------------------------------------------------------- Move a mark */

function pointInBox(point, box) {
  return point.x >= box.x && point.y >= box.y && point.x <= box.x + box.w && point.y <= box.y + box.h;
}

function inflateBox(box, pad) {
  return { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
}

function distToSegment(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

const hitPad = (annotation) => Math.max(12, (annotation.width || annotation.size || 8) + 8);

/** The box around a mark (picture pixels), used to highlight it and to grab it. */
export function annotationBounds(annotation) {
  switch (annotation.type) {
    case 'pen': {
      const points = annotation.points;
      if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = points[0].x;
      let minY = points[0].y;
      let maxX = points[0].x;
      let maxY = points[0].y;
      for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      const pad = (annotation.width || 0) / 2;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    case 'line':
    case 'arrow': {
      const pad = (annotation.width || 0) / 2;
      return {
        x: Math.min(annotation.from.x, annotation.to.x) - pad,
        y: Math.min(annotation.from.y, annotation.to.y) - pad,
        w: Math.abs(annotation.to.x - annotation.from.x) + pad * 2,
        h: Math.abs(annotation.to.y - annotation.from.y) + pad * 2,
      };
    }
    case 'ellipse':
    case 'rect':
    case 'highlight':
    case 'blur':
      return { x: annotation.x, y: annotation.y, w: annotation.w, h: annotation.h };
    case 'number': {
      const radius = numberDiskRadius(annotation);
      return { x: annotation.x - radius, y: annotation.y - radius, w: radius * 2, h: radius * 2 };
    }
    case 'text': {
      const lines = textLines(annotation.text);
      const width = Math.max(1, ...lines.map((line) => line.length)) * annotation.size * 0.62;
      const height = Math.max(1, lines.length) * annotation.size * TEXT_LINE_HEIGHT;
      return { x: annotation.x, y: annotation.y, w: width, h: height };
    }
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

/** Slide a mark by `dx`, `dy` (picture pixels). */
export function translateAnnotation(annotation, dx, dy) {
  if (!dx && !dy) return annotation;
  switch (annotation.type) {
    case 'pen':
      return { ...annotation, points: annotation.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
    case 'line':
    case 'arrow':
      return {
        ...annotation,
        from: { x: annotation.from.x + dx, y: annotation.from.y + dy },
        to: { x: annotation.to.x + dx, y: annotation.to.y + dy },
      };
    case 'ellipse':
    case 'rect':
    case 'highlight':
    case 'blur':
    case 'number':
    case 'text':
      return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
    default:
      return annotation;
  }
}

/**
 * Whether `point` is on this mark. A selected outline (circle / rectangle)
 * can be grabbed from the inside; an unselected one only from its stroke,
 * so a new mark can still be drawn in the hole.
 */
export function hitsAnnotation(annotation, point, { selected = false } = {}) {
  const pad = hitPad(annotation);
  switch (annotation.type) {
    case 'line':
    case 'arrow':
      return distToSegment(point, annotation.from, annotation.to) <= pad;
    case 'pen': {
      const points = annotation.points;
      if (!points.length) return false;
      if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= pad;
      for (let i = 1; i < points.length; i += 1) {
        if (distToSegment(point, points[i - 1], points[i]) <= pad) return true;
      }
      return false;
    }
    case 'rect': {
      const box = annotationBounds(annotation);
      if (selected || box.w <= pad * 2 || box.h <= pad * 2) return pointInBox(point, inflateBox(box, pad));
      return pointInBox(point, inflateBox(box, pad)) && !pointInBox(point, inflateBox(box, -pad));
    }
    case 'highlight':
    case 'blur':
      return pointInBox(point, inflateBox(annotationBounds(annotation), 4));
    case 'ellipse': {
      const cx = annotation.x + annotation.w / 2;
      const cy = annotation.y + annotation.h / 2;
      const rx = Math.max(0.5, annotation.w / 2);
      const ry = Math.max(0.5, annotation.h / 2);
      const t = Math.hypot((point.x - cx) / rx, (point.y - cy) / ry);
      if (selected) return t <= 1.15;
      return Math.abs(t - 1) * Math.min(rx, ry) <= pad;
    }
    case 'number': {
      const radius = numberDiskRadius(annotation);
      return Math.hypot(point.x - annotation.x, point.y - annotation.y) <= radius + 6;
    }
    case 'text':
      return pointInBox(point, inflateBox(annotationBounds(annotation), 6));
    default:
      return false;
  }
}

/** Top-most mark under `point`, or -1. */
export function hitTopAnnotation(annotations, point, selectedIndex = -1) {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    if (hitsAnnotation(annotations[i], point, { selected: i === selectedIndex })) return i;
  }
  return -1;
}

/** Dashed box around the mark that is being moved (overlay only, never saved). */
export function drawSelection(ctx, annotation) {
  const box = annotationBounds(annotation);
  ctx.save();
  ctx.strokeStyle = 'rgba(143, 128, 255, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(box.x - 8, box.y - 8, box.w + 16, box.h + 16);
  ctx.restore();
}
