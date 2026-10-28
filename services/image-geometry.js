/**
 * Image Resolution: the pure maths and text rules (no DOM, no chrome.*), shared by
 * the content script, the side panel and the tests.
 *
 * The page-facing part (finding the image under the pointer) lives in
 * content/image-inspector.js. Everything that can be decided from plain values
 * lives here so it can be tested exactly:
 *   - reading CSS lists (background-image layers, sizes, positions, repeats)
 *   - where a CSS background image is really painted (size, position, repeat),
 *     so a point can be tested against the picture and not just its element
 *   - file name / format / size text, aspect ratio and "retina" wording
 */

/* ------------------------------------------------------------ CSS lists */

/** Split a CSS value on top-level separators (not inside brackets or quotes). */
export function splitTopLevel(value, separator = ',') {
  const parts = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const ch of String(value ?? '')) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (!quote && depth === 0 && ch === separator) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim() || parts.length) parts.push(current.trim());
  return parts;
}

/** Split on top-level whitespace ("auto 50px", "calc(100% - 10px) 0px"). */
export function splitSpaces(value) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(value ?? '').trim()) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * The image address of one background-image layer, or null for `none`,
 * gradients and anything else that is not a picture file.
 * Handles url("..."), url(...) and image-set(url(...) 1x, "..." 2x).
 */
export function extractImageUrl(layer) {
  const text = String(layer ?? '').trim();
  if (!text || text === 'none') return null;
  const url = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)/i.exec(text);
  if (url) return (url[1] ?? url[2] ?? url[3] ?? '').replace(/\\(.)/g, '$1') || null;
  const set = /^(?:-webkit-)?image-set\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/i.exec(text);
  if (set) return (set[1] ?? set[2] ?? '').replace(/\\(.)/g, '$1') || null;
  return null;
}

/** The density written after an image-set() candidate ("2x" -> 2), or 1. */
export function imageSetDensity(layer) {
  const match = /\s(\d+(?:\.\d+)?)x\s*[,)]/i.exec(String(layer ?? ''));
  return match ? Math.max(0.1, Number(match[1])) : 1;
}

/** The value of layer `index` of a comma list (CSS repeats the list when there are more layers than values). */
export const layerValue = (list, index, fallback = '') => (list.length ? list[index % list.length] : fallback);

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?';

/**
 * One length or percentage as pixels. `auto` and anything unreadable give null.
 * Understands the simple calc() forms the browser reports for offsets
 * ("calc(100% - 10px)", "calc(10px + 50%)").
 */
export function resolveLength(token, basis) {
  const text = String(token ?? '').trim().toLowerCase();
  if (!text || text === 'auto') return null;
  let match = new RegExp(`^(${NUMBER})px$`).exec(text);
  if (match) return Number(match[1]);
  match = new RegExp(`^(${NUMBER})%$`).exec(text);
  if (match) return (Number(match[1]) / 100) * basis;
  if (/^[-+]?0+(?:\.0+)?$/.test(text)) return 0;
  match = new RegExp(`^calc\\(\\s*(${NUMBER})(px|%)\\s*([+-])\\s*(${NUMBER})(px|%)\\s*\\)$`).exec(text);
  if (match) {
    const part = (value, unit) => (unit === '%' ? (Number(value) / 100) * basis : Number(value));
    const first = part(match[1], match[2]);
    const second = part(match[4], match[5]);
    return match[3] === '-' ? first - second : first + second;
  }
  return null;
}

/* --------------------------------------------------- Background painting */

/** `background-repeat` -> one mode per axis. */
export function parseRepeat(value) {
  const tokens = splitSpaces(String(value ?? 'repeat').toLowerCase());
  const [first = 'repeat', second] = tokens;
  if (first === 'repeat-x') return { x: 'repeat', y: 'no-repeat' };
  if (first === 'repeat-y') return { x: 'no-repeat', y: 'repeat' };
  const known = (token) => (['repeat', 'no-repeat', 'space', 'round'].includes(token) ? token : 'repeat');
  return { x: known(first), y: known(second ?? first) };
}

/**
 * The size one copy of a background image is drawn at.
 * @param {string} sizeValue computed `background-size` of the layer ("auto", "cover", "100% 50px" ...)
 * @param {{w:number,h:number}} natural the image's own size (0 when it has none, like some SVGs)
 * @param {{w:number,h:number}} area the background positioning area
 */
export function computeTileSize(sizeValue, natural, area) {
  const nw = natural.w > 0 ? natural.w : 0;
  const nh = natural.h > 0 ? natural.h : 0;
  const text = String(sizeValue ?? 'auto').trim().toLowerCase();

  if (text === 'cover' || text === 'contain') {
    if (!nw || !nh) return { w: area.w, h: area.h };
    const scale = text === 'cover' ? Math.max(area.w / nw, area.h / nh) : Math.min(area.w / nw, area.h / nh);
    return { w: nw * scale, h: nh * scale, autoW: false, autoH: false };
  }

  const [first = 'auto', second = 'auto'] = splitSpaces(text);
  let w = resolveLength(first, area.w);
  let h = resolveLength(second, area.h);
  const autoW = w === null;
  const autoH = h === null;
  const ratio = nw && nh ? nw / nh : 0;

  if (w === null && h === null) {
    w = nw || area.w;
    h = nh || area.h;
  } else if (w === null) w = ratio ? h * ratio : nw || area.w;
  else if (h === null) h = ratio ? w / ratio : nh || area.h;
  return { w: Math.max(0, w), h: Math.max(0, h), autoW, autoH };
}

/** Offset of a tile inside the free space of one axis. */
export const resolveOffset = (token, free) => resolveLength(token, free) ?? 0;

/**
 * Where tiles sit along one axis. Returns a function that finds the tile
 * covering a coordinate, or null when the coordinate is in a gap / outside.
 * `p` is measured from the start of the positioning area.
 */
function axisTiles(mode, areaLen, tileLen, offset) {
  if (!(tileLen > 0)) return () => null;
  if (mode === 'repeat' || mode === 'round') {
    return (p) => {
      const k = Math.floor((p - offset) / tileLen);
      return { start: offset + k * tileLen, len: tileLen };
    };
  }
  if (mode === 'space') {
    const count = Math.floor(areaLen / tileLen);
    if (count >= 2) {
      const step = (areaLen - count * tileLen) / (count - 1) + tileLen;
      return (p) => {
        const k = Math.floor(p / step);
        if (k < 0 || k >= count) return null;
        const start = k * step;
        return p >= start && p < start + tileLen ? { start, len: tileLen } : null;
      };
    }
  }
  return (p) => (p >= offset && p < offset + tileLen ? { start: offset, len: tileLen } : null);
}

/**
 * Lay out one background layer.
 * @param {object} layer
 * @param {{w:number,h:number}} layer.natural
 * @param {{w:number,h:number}} layer.area background positioning area
 * @param {string} layer.size  computed background-size of the layer
 * @param {string} layer.posX  computed background-position-x of the layer
 * @param {string} layer.posY  computed background-position-y of the layer
 * @param {string} layer.repeat computed background-repeat of the layer
 * @returns {{ tile: {w:number,h:number}, tileAt: (x:number, y:number) => ({x:number,y:number,w:number,h:number}|null) }}
 */
export function layoutBackgroundLayer({ natural, area, size, posX, posY, repeat }) {
  const modes = parseRepeat(repeat);
  const tile = computeTileSize(size, natural, area);

  // "round": the picture is stretched so a whole number of copies fits; an `auto` side keeps its ratio.
  if (modes.x === 'round' && tile.w > 0) {
    const stretched = area.w / Math.max(1, Math.round(area.w / tile.w));
    if (tile.autoH) tile.h *= stretched / tile.w;
    tile.w = stretched;
  }
  if (modes.y === 'round' && tile.h > 0) {
    const stretched = area.h / Math.max(1, Math.round(area.h / tile.h));
    if (tile.autoW) tile.w *= stretched / tile.h;
    tile.h = stretched;
  }

  const offsetX = resolveOffset(posX, area.w - tile.w);
  const offsetY = resolveOffset(posY, area.h - tile.h);
  const columns = axisTiles(modes.x, area.w, tile.w, offsetX);
  const rows = axisTiles(modes.y, area.h, tile.h, offsetY);

  return {
    tile: { w: tile.w, h: tile.h },
    /** The copy of the picture under (x, y) (measured from the positioning area's corner), or null. */
    tileAt(x, y) {
      const column = columns(x);
      const row = rows(y);
      return column && row ? { x: column.start, y: row.start, w: column.len, h: row.len } : null;
    },
  };
}

/**
 * The painted rectangle of an element's object-fit image is not needed for the
 * size shown (that is the element's box), but is for the outline of images with
 * `object-fit: contain | none | scale-down`.
 * @returns {{x:number,y:number,w:number,h:number}} relative to the content box
 */
export function objectFitRect(fit, positionValue, box, natural) {
  const mode = String(fit ?? 'fill').trim().toLowerCase();
  if (mode === 'fill' || !(natural.w > 0 && natural.h > 0)) return { x: 0, y: 0, w: box.w, h: box.h };
  const contain = Math.min(box.w / natural.w, box.h / natural.h);
  const cover = Math.max(box.w / natural.w, box.h / natural.h);
  const scale = { contain, cover, none: 1, 'scale-down': Math.min(1, contain) }[mode.split(/\s+/)[0]] ?? contain;
  const w = natural.w * scale;
  const h = natural.h * scale;
  const [px = '50%', py = '50%'] = splitSpaces(positionValue || '50% 50%');
  return { x: resolveOffset(px, box.w - w), y: resolveOffset(py, box.h - h), w, h };
}

/* ------------------------------------------------------------ Text rules */

const trimZero = (value) => String(value).replace(/\.0+$/, '');

/** 1200 -> "1,200"; 99.5 -> "99.5"; 99.04 -> "99". */
export function formatPixels(value) {
  if (!Number.isFinite(value)) return '-';
  const rounded = Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : Math.round(value * 10) / 10;
  return trimZero(rounded.toLocaleString('en-US', { maximumFractionDigits: 1 }));
}

/** "1,200 × 800" */
export const formatSize = (w, h) => `${formatPixels(w)} × ${formatPixels(h)}`;

/** 84123 -> "82.2 KB". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${trimZero((bytes / 1024).toFixed(1))} KB`;
  return `${trimZero((bytes / 1024 / 1024).toFixed(2))} MB`;
}

const COMMON_RATIOS = [
  [1, 1], [4, 3], [3, 2], [16, 9], [16, 10], [21, 9], [5, 4], [2, 1], [3, 1], [4, 1],
  [3, 4], [2, 3], [9, 16], [10, 16], [4, 5], [1, 2], [1, 3], [1, 4],
];

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

/** "16:9" for common shapes, a reduced ratio when it is small, otherwise "1.78:1". */
export function aspectRatio(w, h) {
  if (!(w > 0 && h > 0)) return '';
  const value = w / h;
  for (const [a, b] of COMMON_RATIOS) {
    if (Math.abs(value - a / b) / (a / b) < 0.01) return `${a}:${b}`;
  }
  const divisor = gcd(Math.round(w), Math.round(h));
  const a = Math.round(w) / divisor;
  const b = Math.round(h) / divisor;
  if (divisor > 1 && a <= 30 && b <= 30) return `${a}:${b}`;
  return value >= 1 ? `${trimZero(value.toFixed(2))}:1` : `1:${trimZero((1 / value).toFixed(2))}`;
}

/**
 * How the displayed size compares with the image's own size, in words.
 * tone: "ok" (fine), "info" (worth knowing), "warn" (will look soft).
 * @returns {{ text: string, tone: 'ok'|'info'|'warn', factor: number }|null}
 */
export function describeScale(displayW, naturalW) {
  if (!(displayW > 0 && naturalW > 0)) return null;
  const factor = displayW / naturalW; // displayed / own size
  if (Math.abs(factor - 1) <= 0.02) return { text: 'Shown at its own size', tone: 'ok', factor };
  if (factor > 1) {
    return { text: `Enlarged ${trimZero(factor.toFixed(2))}× - can look soft`, tone: 'warn', factor };
  }
  const reduction = 1 / factor;
  for (const density of [2, 3, 4]) {
    if (Math.abs(reduction - density) / density <= 0.03) return { text: `${density}× image, sharp on high-density screens`, tone: 'ok', factor };
  }
  const text = `Shrunk ${trimZero(reduction.toFixed(reduction < 10 ? 2 : 1))}× (shown at ${Math.round(factor * 100)}%)`;
  return { text, tone: reduction > 4 ? 'warn' : 'info', factor };
}

const FORMATS = {
  jpg: 'JPEG', jpeg: 'JPEG', jfif: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', avif: 'AVIF',
  svg: 'SVG', bmp: 'BMP', ico: 'ICO', apng: 'APNG', tif: 'TIFF', tiff: 'TIFF', heic: 'HEIC',
};

const MIME_FORMATS = {
  'image/jpeg': 'JPEG', 'image/jpg': 'JPEG', 'image/png': 'PNG', 'image/gif': 'GIF', 'image/webp': 'WebP',
  'image/avif': 'AVIF', 'image/svg+xml': 'SVG', 'image/bmp': 'BMP', 'image/x-icon': 'ICO',
  'image/vnd.microsoft.icon': 'ICO', 'image/apng': 'APNG', 'image/tiff': 'TIFF',
};

/** Format name from an address or data URL ("" when it cannot be told). */
export function imageFormat(url) {
  const text = String(url ?? '');
  const data = /^data:([^;,]+)/i.exec(text);
  if (data) return MIME_FORMATS[data[1].toLowerCase()] || '';
  const path = text.split(/[?#]/)[0];
  const ext = /\.([a-z0-9]{2,5})$/i.exec(path);
  return ext ? FORMATS[ext[1].toLowerCase()] || '' : '';
}

/** A readable file name for an address ("hero@2x.webp", "inline image (data URL)"). */
export function imageName(url) {
  const text = String(url ?? '');
  if (/^data:/i.test(text)) return 'Inline image (data URL)';
  if (/^blob:/i.test(text)) return 'Image from a blob URL';
  try {
    const { pathname, hostname } = new URL(text);
    const last = pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : hostname;
  } catch {
    return text.split(/[?#]/)[0].split('/').filter(Boolean).pop() || text;
  }
}

/** The byte size of a base64 or percent-encoded data URL (0 for anything else). */
export function dataUrlBytes(url) {
  const match = /^data:[^,]*?(;base64)?,(.*)$/is.exec(String(url ?? ''));
  if (!match) return 0;
  const body = match[2];
  if (match[1]) {
    const padding = /=+$/.exec(body)?.[0].length || 0;
    return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(body)).length;
  } catch {
    return body.length;
  }
}
