/**
 * Image Resolution: turn a hovered picture into a file the user can save.
 *
 * The side panel fetches the image (the extension already has host access for
 * the tab) and draws it on a canvas so PNG / JPG / WebP / SVG can be produced
 * from the same source. SVG sources are saved as-is when the user picks SVG;
 * a raster picture saved as SVG is wrapped in a small SVG document.
 */

import { imageFormat } from './image-geometry.js';
import { enhanceCanvas } from './image-enhance.js';

export const DOWNLOAD_FORMATS = Object.freeze(['png', 'jpg', 'webp', 'svg']);

export const DOWNLOAD_FORMAT_LABELS = Object.freeze({
  png: 'PNG',
  jpg: 'JPG',
  webp: 'WebP',
  svg: 'SVG',
});

const MIME = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
});

const QUALITY = 0.92;
/**
 * JPEG / WebP visual quality for Convert and Resize. 0.92 looks near-lossless
 * and stays much smaller than quality 1. PNG is always lossless.
 */
const ENCODE_QUALITY = 0.92;
export const MAX_EXPORT_EDGE = 8192;

/** png / jpg / webp / svg from the inspector's format label (JPEG, PNG, …). */
export function preferredDownloadFormat(format) {
  const key = String(format || '').toLowerCase();
  if (key === 'jpeg' || key === 'jpg') return 'jpg';
  if (key === 'png' || key === 'webp' || key === 'svg') return key;
  return 'png';
}

export function isTruncatedUrl(url) {
  return /…$|\.\.\.$/.test(String(url || ''));
}

export function isAutoHeight(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return !text || text === 'auto';
}

function clampEdge(value) {
  return Math.min(MAX_EXPORT_EDGE, Math.max(1, Math.round(value)));
}

/**
 * A custom download size. Height may be "auto" (keep the picture's ratio).
 * `sourceWidth` / `sourceHeight` fill in auto height when they are known.
 */
export function sanitizeExportSize(width, height, { sourceWidth = 0, sourceHeight = 0 } = {}) {
  const w = Math.round(Number(width));
  if (!Number.isFinite(w) || w <= 0) return null;
  const clampedW = clampEdge(w);
  if (isAutoHeight(height)) {
    const srcW = Number(sourceWidth);
    const srcH = Number(sourceHeight);
    const h = srcW > 0 && srcH > 0 ? clampEdge((clampedW * srcH) / srcW) : 0;
    return { w: clampedW, h, autoHeight: true };
  }
  const h = Math.round(Number(height));
  if (!Number.isFinite(h) || h <= 0) return null;
  return { w: clampedW, h: clampEdge(h), autoHeight: false };
}

/** Pixel size after loading the picture, with auto height resolved from its ratio. */
export function resolveExportSize(img, size) {
  const srcW = img.naturalWidth || img.width || 0;
  const srcH = img.naturalHeight || img.height || 0;
  if (!size) return { w: srcW, h: srcH };
  const w = size.w || srcW;
  const h = size.autoHeight || !(size.h > 0) ? (srcW > 0 ? clampEdge((w * srcH) / srcW) : srcH) : size.h;
  return { w, h };
}

/** A safe Downloads-folder name: "hero.webp" + PNG -> "hero.png". */
export function downloadFilename(name, format) {
  const ext = format === 'jpg' ? 'jpg' : DOWNLOAD_FORMATS.includes(format) ? format : 'png';
  let base = String(name || 'image').trim();
  if (!base || /^data:/i.test(base) || /^blob:/i.test(base) || /inline image/i.test(base) || /blob url/i.test(base)) {
    base = 'image';
  }
  base = base.replace(/\.[a-z0-9]{2,5}$/i, '');
  base = base.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').replace(/^\.+/, '').replace(/\.+$/, '') || 'image';
  return `${base.slice(0, 80)}.${ext}`;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('The image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** Save through the browser's download (same path as the screenshot editor). */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.documentElement.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function isSvgSource(url, type = '') {
  if (/svg/i.test(type) || /^data:image\/svg/i.test(url)) return true;
  try {
    const path = new URL(url, 'https://example.invalid').pathname;
    return /\.svg$/i.test(path);
  } catch {
    return /\.svg(\?|#|$)/i.test(url);
  }
}

function decodeDataUrl(url) {
  const match = /^data:([^,]*),(.*)$/s.exec(String(url || ''));
  if (!match) throw new Error('The image could not be read.');
  const body = match[2];
  if (/;base64/i.test(match[1])) {
    const binary = atob(body);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  try {
    return decodeURIComponent(body);
  } catch {
    return body;
  }
}

function loadBitmap(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be loaded.'));
    img.src = src;
  });
}

function sourceWidth(source) {
  return source.naturalWidth || source.width || 0;
}

function sourceHeight(source) {
  return source.naturalHeight || source.height || 0;
}

function canvasContext(canvas, { alpha = true } = {}) {
  return canvas.getContext('2d', { alpha, colorSpace: 'srgb' }) || canvas.getContext('2d', { alpha });
}

function encodeQuality(format, quality) {
  if (format === 'png' || format === 'svg') return undefined;
  const value = Number(quality);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : ENCODE_QUALITY;
}

function paintToCanvas(source, w, h, { fillWhite = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvasContext(canvas, { alpha: !fillWhite });
  if (fillWhite) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  const same = sourceWidth(source) === w && sourceHeight(source) === h;
  ctx.imageSmoothingEnabled = !same;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

/** Halve oversized pictures until they are close to the target, then one last high-quality pass. */
function drawScaled(source, destW, destH, { fillWhite = false } = {}) {
  let current = source;
  let width = sourceWidth(source);
  let height = sourceHeight(source);
  while (width > destW * 2 && height > destH * 2) {
    const nextW = Math.max(destW, Math.round(width / 2));
    const nextH = Math.max(destH, Math.round(height / 2));
    if (nextW >= width && nextH >= height) break;
    current = paintToCanvas(current, nextW, nextH);
    width = nextW;
    height = nextH;
  }
  return paintToCanvas(current, destW, destH, { fillWhite });
}

async function createBitmap(source, options) {
  if (typeof createImageBitmap !== 'function') throw new Error('no bitmap');
  try {
    return options ? await createImageBitmap(source, options) : await createImageBitmap(source);
  } catch (error) {
    if (options) return createImageBitmap(source);
    throw error;
  }
}

/**
 * Resize with Chrome's high-quality bitmap scaler, in steps when shrinking a
 * lot. A 4000px photo down to 800px stays sharp instead of turning soft.
 */
async function scaleBitmap(source, w, h) {
  const srcW = sourceWidth(source);
  const srcH = sourceHeight(source);
  if (srcW === w && srcH === h) return { bitmap: source, owned: false };

  try {
    let current = source instanceof ImageBitmap ? source : await createBitmap(source, { imageOrientation: 'from-image' });
    let owned = current !== source;
    let width = current.width;
    let height = current.height;
    while (width > w * 2 && height > h * 2) {
      const nextW = Math.max(w, Math.round(width / 2));
      const nextH = Math.max(h, Math.round(height / 2));
      const next = await createBitmap(current, { resizeWidth: nextW, resizeHeight: nextH, resizeQuality: 'high' });
      if (owned) current.close?.();
      current = next;
      owned = true;
      width = nextW;
      height = nextH;
    }
    if (width !== w || height !== h) {
      const next = await createBitmap(current, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      if (owned) current.close?.();
      current = next;
      owned = true;
    }
    return { bitmap: current, owned };
  } catch {
    return { canvas: drawScaled(source, w, h), owned: false };
  }
}

async function encodeCanvas(canvas, format, quality) {
  const mime = MIME[format] || MIME.png;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, encodeQuality(format, quality)));
  if (!blob) throw new Error('The image could not be converted.');
  return blob;
}

async function canvasBlob(img, format, size, quality = QUALITY) {
  const { w, h } = resolveExportSize(img, size);
  if (!(w > 0 && h > 0)) throw new Error('The image has no size.');
  const scaled = await scaleBitmap(img, w, h);
  try {
    const source = scaled.canvas || scaled.bitmap;
    const alreadySized = source && sourceWidth(source) === w && sourceHeight(source) === h;
    const canvas =
      scaled.canvas && alreadySized && format !== 'jpg'
        ? scaled.canvas
        : alreadySized
          ? paintToCanvas(source, w, h, { fillWhite: format === 'jpg' })
          : drawScaled(source, w, h, { fillWhite: format === 'jpg' });
    const scale = Math.max(w / Math.max(1, sourceWidth(img)), h / Math.max(1, sourceHeight(img)));
    enhanceCanvas(canvas, { scale });
    return await encodeCanvas(canvas, format, quality);
  } finally {
    if (scaled.owned) scaled.bitmap?.close?.();
  }
}

function snapshotSize(source) {
  const w = sourceWidth(source);
  const h = sourceHeight(source);
  return { naturalWidth: w, naturalHeight: h, width: w, height: h };
}

async function decodeSource(src, sourceBlob) {
  const blob = sourceBlob && !/svg/i.test(sourceBlob.type || '') ? sourceBlob : null;
  if (blob && typeof createImageBitmap === 'function') {
    try {
      return await createBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(blob);
      } catch {
        /* Image() fallback */
      }
    }
  }
  if (typeof src === 'string') return loadBitmap(src);
  const url = URL.createObjectURL(sourceBlob);
  try {
    return await loadBitmap(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draw SVG at the output pixel size so vectors are not rasterised small then upscaled. */
async function rasterizeSvg(text, size) {
  const probe = URL.createObjectURL(new Blob([text], { type: MIME.svg }));
  try {
    const img = await loadBitmap(probe);
    const out = resolveExportSize(img, size);
    if (!(out.w > 0 && out.h > 0)) throw new Error('The image has no size.');
    const markup = scaleSvgMarkup(text, out.w, out.h, img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sized = URL.createObjectURL(new Blob([markup], { type: MIME.svg }));
    try {
      const drawn = await loadBitmap(sized);
      return { canvas: paintToCanvas(drawn, out.w, out.h), img };
    } finally {
      URL.revokeObjectURL(sized);
    }
  } finally {
    URL.revokeObjectURL(probe);
  }
}

async function rasterBlob(src, format, size, quality = QUALITY, sourceBlob = null) {
  const fmt = format === 'svg' ? 'png' : format;
  if (isSvgSource(src, sourceBlob?.type || '')) {
    let text = '';
    try {
      if (sourceBlob) text = await sourceBlob.text();
      else if (/^data:/i.test(src)) text = decodeDataUrl(src);
    } catch {
      text = '';
    }
    if (/<svg/i.test(text)) {
      const { canvas, img } = await rasterizeSvg(text, size);
      return { blob: await encodeCanvas(canvas, fmt, quality), img };
    }
  }
  const img = await decodeSource(src, sourceBlob);
  try {
    return { blob: await canvasBlob(img, fmt, size, quality), img: snapshotSize(img) };
  } finally {
    img.close?.();
  }
}

function wrapPngAsSvg(dataUrl, width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${dataUrl}" width="${w}" height="${h}"/></svg>`;
}

/**
 * Fetch `url` and return a Blob in `format` plus a file name.
 * @param {string} url
 * @param {string} format png | jpg | webp | svg
 * @param {{ name?: string, width?: number, height?: number|string, quality?: number }} [options]
 */
export async function exportImage(url, format, { name = 'image', width, height, quality = QUALITY } = {}) {
  const fmt = DOWNLOAD_FORMATS.includes(format) ? format : 'png';
  const size = width ? sanitizeExportSize(width, height) : null;
  if (!url) throw new Error('The image could not be downloaded.');
  if (isTruncatedUrl(url)) {
    throw new Error('The image address is incomplete. Hover the image again and try downloading.');
  }

  let revoke = '';
  try {
    let src = url;
    let sourceBlob = null;

    if (!/^data:/i.test(url)) {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('The image could not be downloaded.');
      sourceBlob = await response.blob();
      src = URL.createObjectURL(sourceBlob);
      revoke = src;
    }

    if (fmt === 'svg') {
      if (!size && isSvgSource(url, sourceBlob?.type || '')) {
        const text = sourceBlob ? await sourceBlob.text() : decodeDataUrl(url);
        return { blob: new Blob([text], { type: MIME.svg }), filename: downloadFilename(name, 'svg') };
      }
      const { blob: png, img } = await rasterBlob(src, 'png', size, quality, sourceBlob);
      const dataUrl = await blobToDataUrl(png);
      const out = resolveExportSize(img, size);
      const svg = wrapPngAsSvg(dataUrl, out.w, out.h);
      return { blob: new Blob([svg], { type: MIME.svg }), filename: downloadFilename(name, 'svg') };
    }

    const { blob } = await rasterBlob(src, fmt, size, quality, sourceBlob);
    return { blob, filename: downloadFilename(name, fmt) };
  } finally {
    if (revoke) URL.revokeObjectURL(revoke);
  }
}

export function fileFormat(file) {
  const type = String(file?.type || '').toLowerCase();
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/svg+xml') return 'svg';
  const key = String(imageFormat(file?.name) || '').toLowerCase();
  if (key === 'jpeg' || key === 'jpg') return 'jpg';
  if (key === 'png' || key === 'webp' || key === 'svg') return key;
  return '';
}

export function fileMatchesFormat(file, format) {
  return fileFormat(file) === format;
}

export function acceptForFormat(format) {
  return (
    {
      png: 'image/png,.png',
      jpg: 'image/jpeg,.jpg,.jpeg',
      webp: 'image/webp,.webp',
      svg: 'image/svg+xml,.svg',
    }[format] || 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg'
  );
}

/** Keep SVG as vectors when only the display size changes. */
export function scaleSvgMarkup(text, width, height, sourceWidth, sourceHeight) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return String(text).replace(/<svg\b([^>]*)>/i, (_, attrs) => {
    let next = String(attrs);
    if (!/\bviewBox\s*=/i.test(next)) {
      const srcW = Math.max(1, Math.round(sourceWidth || w));
      const srcH = Math.max(1, Math.round(sourceHeight || h));
      next += ` viewBox="0 0 ${srcW} ${srcH}"`;
    }
    next = next.replace(/\swidth\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '').replace(/\sheight\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '');
    return `<svg${next} width="${w}" height="${h}">`;
  });
}

function isLosslessFormat(format) {
  return format === 'png' || format === 'svg';
}

/**
 * Convert or resize a local file. Same-format PNG/SVG with no size change
 * keeps the original bytes. JPEG/WebP are always clarified and re-encoded
 * so a soft or compressed original comes out clearer in a compact file.
 */
export async function convertFile(file, toFormat, { width, height, quality = ENCODE_QUALITY } = {}) {
  const fmt = DOWNLOAD_FORMATS.includes(toFormat) ? toFormat : 'png';
  const from = fileFormat(file);
  const size = width ? sanitizeExportSize(width, height) : null;
  if (from === fmt && !size && isLosslessFormat(from)) {
    return { blob: file, filename: downloadFilename(file.name, fmt) };
  }
  if (from === 'svg' && fmt === 'svg' && size) {
    const text = await file.text();
    if (/<svg\b/i.test(text)) {
      const url = URL.createObjectURL(file);
      try {
        const img = await loadBitmap(url);
        const out = resolveExportSize(img, size);
        if (out.w === (img.naturalWidth || img.width) && out.h === (img.naturalHeight || img.height)) {
          return { blob: file, filename: downloadFilename(file.name, 'svg') };
        }
        const scaled = scaleSvgMarkup(text, out.w, out.h, img.naturalWidth || img.width, img.naturalHeight || img.height);
        return { blob: new Blob([scaled], { type: MIME.svg }), filename: downloadFilename(file.name, 'svg') };
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    if (from === fmt && size && isLosslessFormat(from)) {
      const decoded = await decodeSource(url, file);
      try {
        const out = resolveExportSize(decoded, size);
        if (out.w === sourceWidth(decoded) && out.h === sourceHeight(decoded)) {
          return { blob: file, filename: downloadFilename(file.name, fmt) };
        }
      } finally {
        decoded.close?.();
      }
    }
    return await exportImage(url, fmt, { name: file.name, width, height, quality });
  } finally {
    URL.revokeObjectURL(url);
  }
}
