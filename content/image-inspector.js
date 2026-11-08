/**
 * Image Resolution: hover any image on the page and see its size. Click locks
 * that picture (the link does not open) so the side panel can show it and
 * download it; click the same picture again to unlock.
 *
 * While the inspector runs, the pointer is followed and the pictures under it
 * are looked up from the whole stack of elements at that point
 * (`elementsFromPoint`), so an image is found even when text, buttons, links or
 * transparent layers sit on top of it. These pictures are recognised:
 *
 *   - real images: <img> (and <picture>), <input type="image">, SVG <image>
 *   - CSS background images, including several layers, `background-size`,
 *     `-position`, `-repeat`, `-origin` and `-clip`, so the point must really be
 *     over the painted picture, not just over the element that owns it
 *   - CSS mask / -webkit-mask images (the usual way a CMS draws an icon with
 *     a colour fill), border-image and list-style-image
 *   - pictures on ::before / ::after (`content: url(...)`, background-image, mask)
 *
 * A parent with a stretched ::before overlay (whole-card links) or
 * `pointer-events: none` on the picture is still searched: those pictures are
 * missing from `elementsFromPoint`, so descendants under the point are visited too.
 *
 * Nothing on the page is changed: the card and the outline are drawn in a
 * closed shadow root under <html> that ignores the pointer, and are removed
 * when the inspector stops.
 */

import { MSG } from '../shared/constants.js';
import { broadcast } from '../services/message-service.js';
import { normalizeLanguage, translate } from '../services/i18n.js';
import {
  aspectRatio,
  dataUrlBytes,
  describeScale,
  extractImageUrl,
  formatBytes,
  formatPixels,
  formatSize,
  imageFormat,
  imageName,
  imageSetDensity,
  layerValue,
  layoutBackgroundLayer,
  splitSpaces,
  splitTopLevel,
} from '../services/image-geometry.js';
import { blobToDataUrl } from '../services/image-export.js';

const HOST_ID = 'wit-image-inspector';
const MAX_CACHE = 300;
const MAX_STACK = 60;
const MAX_URL_SENT = 2000;

let session = null; // the running inspector, or null
let lastHit = null; // last picture under the pointer; kept after stop so Download still works

/* ------------------------------------------------------- Image sizes */

/** url -> { state: 'loading' | 'ok' | 'error', w, h } : the pictures' own sizes, loaded once from the browser cache. */
const naturalSizes = new Map();

function naturalSizeOf(url) {
  let entry = naturalSizes.get(url);
  if (entry) return entry;
  entry = { state: 'loading', w: 0, h: 0 };
  naturalSizes.set(url, entry);
  if (naturalSizes.size > MAX_CACHE) naturalSizes.delete(naturalSizes.keys().next().value);

  const probe = new Image();
  probe.decoding = 'async';
  probe.addEventListener('load', () => {
    entry.state = 'ok';
    entry.w = probe.naturalWidth;
    entry.h = probe.naturalHeight;
    session?.refresh();
  });
  probe.addEventListener('error', () => {
    entry.state = 'error';
    session?.refresh();
  });
  probe.src = url;
  return entry;
}

/** The transferred size of a picture when the browser reports it (same-origin or CORS-enabled, not cached-empty). */
function fileSizeOf(url) {
  if (/^data:/i.test(url)) return dataUrlBytes(url);
  try {
    const entries = performance.getEntriesByName(url);
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].encodedBodySize > 0) return entries[i].encodedBodySize;
    }
  } catch {
    /* resource timing is optional */
  }
  return 0;
}

/* --------------------------------------------------------- Geometry */

const px = (value) => Number.parseFloat(value) || 0;

/** Make a CSS url() absolute so the side panel can fetch it. */
function absoluteCssUrl(url, element) {
  if (!url || /^(data:|blob:)/i.test(url)) return url;
  try {
    return new URL(url, element?.baseURI || document.baseURI).href;
  } catch {
    return url;
  }
}

/** `center` / `left` / `right` as the percentages `background-position` uses. */
function positionToken(token, fallback = '0%') {
  const text = String(token ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (text === 'center') return '50%';
  if (text === 'left' || text === 'top') return '0%';
  if (text === 'right' || text === 'bottom') return '100%';
  return token;
}

const intersect = (a, b) => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
};

const contains = (box, x, y) => x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;

/** border-box / padding-box / content-box rectangles of an element, in viewport coordinates. */
function boxesOf(element, style) {
  const rect = element.getBoundingClientRect();
  const border = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  const bl = px(style.borderLeftWidth);
  const bt = px(style.borderTopWidth);
  const br = px(style.borderRightWidth);
  const bb = px(style.borderBottomWidth);
  const padding = { x: border.x + bl, y: border.y + bt, w: Math.max(0, border.w - bl - br), h: Math.max(0, border.h - bt - bb) };
  const content = {
    x: padding.x + px(style.paddingLeft),
    y: padding.y + px(style.paddingTop),
    w: Math.max(0, padding.w - px(style.paddingLeft) - px(style.paddingRight)),
    h: Math.max(0, padding.h - px(style.paddingTop) - px(style.paddingBottom)),
  };
  return { 'border-box': border, 'padding-box': padding, 'content-box': content };
}

/* ------------------------------------------------------- Finding images */

/** Every element at a point, top to bottom, looking inside open shadow roots. */
function stackAt(root, x, y, depth = 0, out = []) {
  for (const element of root.elementsFromPoint(x, y)) {
    if (out.length >= MAX_STACK) break;
    if (element.shadowRoot && depth < 5) stackAt(element.shadowRoot, x, y, depth + 1, out);
    if (!out.includes(element)) out.push(element);
  }
  return out;
}

function makeHit(base) {
  const display = base.display;
  const natural = base.natural;
  const bytes = fileSizeOf(base.url);
  return {
    ...base,
    name: imageName(base.url),
    format: imageFormat(base.url),
    bytes,
    ratio: aspectRatio(natural.w || display.w, natural.h || display.h),
    scale: base.scale === undefined ? describeScale(display.w, natural.w) : base.scale,
    key: `${base.kind}|${base.url}|${Math.round(display.w)}x${Math.round(display.h)}`,
  };
}

/** Address of a replaced picture. `element.src` alone is the page URL when `src` is missing. */
function imageUrlOf(element) {
  const tag = element.localName;
  if (tag === 'img' || (tag === 'input' && element.type === 'image')) {
    if (element.currentSrc) return element.currentSrc;
    const src = element.getAttribute('src');
    if (src) return element.src || src;
    const lazy = element.getAttribute('data-src') || element.getAttribute('data-original') || '';
    return lazy;
  }
  if (tag === 'image' && element.namespaceURI === 'http://www.w3.org/2000/svg') {
    const href = element.href?.baseVal || element.getAttribute('href') || element.getAttribute('xlink:href') || '';
    return href ? new URL(href, element.baseURI).href : '';
  }
  if (tag === 'video') return element.poster || element.getAttribute('poster') || '';
  return '';
}

function boxOfRect(rect) {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** <img>, <picture>, <input type="image">, SVG <image> and video posters. */
function realImageAt(element, x, y) {
  if (!element) return null;
  const tag = element.localName;
  if (tag === 'picture') {
    const img = element.querySelector('img');
    return img ? realImageAt(img, x, y) : null;
  }

  let kind = 'Image';
  if (tag === 'img') {
    if (element.parentElement?.localName === 'picture') kind = 'Picture';
  } else if (tag === 'input' && element.type === 'image') kind = 'Image button';
  else if (tag === 'image' && element.namespaceURI === 'http://www.w3.org/2000/svg') kind = 'SVG image';
  else if (tag === 'video') kind = 'Video poster';
  else return null;

  const url = absoluteCssUrl(imageUrlOf(element), element);
  if (!url) return null;

  const style = getComputedStyle(element);
  if (style.display === 'none') return null;
  if (style.visibility === 'hidden') return null;

  let box = boxOfRect(element.getBoundingClientRect());
  const natural = { w: element.naturalWidth || 0, h: element.naturalHeight || 0 };
  const tinyBox = !(box.w > 2 && box.h > 2);
  const tinyFile = !(natural.w > 2 || natural.h > 2);
  if (tinyBox) {
    // Tracking pixels stay hidden. A loaded photo with height 0 / opacity 0 still
    // has a real file — use the wrapper that is actually under the pointer.
    if (tag === 'img' && !element.complete) return null;
    if (tinyFile) return null;
    const parent = element.parentElement;
    if (!parent) return null;
    box = boxOfRect(parent.getBoundingClientRect());
    if (!(box.w > 2 && box.h > 2)) return null;
  }
  if (Number.isFinite(x) && Number.isFinite(y) && !contains(box, x, y)) return null;

  let file = natural;
  if (tag !== 'image' && tag !== 'video' && (element.hasAttribute('srcset') || kind === 'Picture')) {
    const raw = naturalSizeOf(url);
    if (raw.state === 'ok' && raw.w) file = { w: raw.w, h: raw.h };
  } else if (tag === 'image' || tag === 'video') {
    const raw = naturalSizeOf(url);
    if (raw.state === 'ok') file = { w: raw.w, h: raw.h };
  }
  const broken = tag === 'img' && element.complete && file.w === 0;
  const loading = tag === 'img' && !element.complete;

  return makeHit({
    element,
    kind,
    url,
    display: { w: box.w, h: box.h },
    natural: file,
    outline: box,
    alt: tag === 'img' ? element.alt || '' : '',
    broken,
    loading,
  });
}

/** Quoted empty `content` still creates a ::before / ::after box; `none` / `normal` do not. */
function pseudoExists(style) {
  const content = String(style.content || '').trim();
  if (!content || content === 'none' || content === 'normal') return false;
  if (style.display === 'none' || style.visibility !== 'visible') return false;
  if (Number(style.opacity) === 0) return false;
  return true;
}

/** Alt text from `content: url("…") / "label"`. */
function contentAlt(content) {
  const match = /\/\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(String(content || ''));
  return match ? match[1].replace(/\\(.)/g, '$1') : '';
}

/** border / padding / content boxes of a rectangle already in viewport coordinates. */
function boxesFromRect(rect, style) {
  const border = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  const bl = px(style.borderLeftWidth);
  const bt = px(style.borderTopWidth);
  const br = px(style.borderRightWidth);
  const bb = px(style.borderBottomWidth);
  const padding = { x: border.x + bl, y: border.y + bt, w: Math.max(0, border.w - bl - br), h: Math.max(0, border.h - bt - bb) };
  const content = {
    x: padding.x + px(style.paddingLeft),
    y: padding.y + px(style.paddingTop),
    w: Math.max(0, padding.w - px(style.paddingLeft) - px(style.paddingRight)),
    h: Math.max(0, padding.h - px(style.paddingTop) - px(style.paddingBottom)),
  };
  return { 'border-box': border, 'padding-box': padding, 'content-box': content };
}

/**
 * Viewport box of ::before / ::after. Absolute / fixed boxes are resolved from
 * the host; static ones sit at the start (::before) or end (::after) of the content box.
 */
function pseudoRect(element, pseudoName, style) {
  const hostStyle = getComputedStyle(element);
  const host = boxesOf(element, hostStyle);
  const w = Math.max(0, px(style.width));
  const h = Math.max(0, px(style.height));
  const ml = px(style.marginLeft);
  const mr = px(style.marginRight);
  const mt = px(style.marginTop);
  const mb = px(style.marginBottom);
  const top = style.top === 'auto' ? null : px(style.top);
  const right = style.right === 'auto' ? null : px(style.right);
  const bottom = style.bottom === 'auto' ? null : px(style.bottom);
  const left = style.left === 'auto' ? null : px(style.left);
  const position = style.position;

  if (position === 'absolute' || position === 'fixed') {
    const area =
      position === 'fixed'
        ? { x: 0, y: 0, w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }
        : host['padding-box'];
    let width = w;
    let height = h;
    if (!(width > 0) && left !== null && right !== null) width = Math.max(0, area.w - left - right - ml - mr);
    if (!(height > 0) && top !== null && bottom !== null) height = Math.max(0, area.h - top - bottom - mt - mb);
    if (!(width > 0 && height > 0)) return null;
    let x;
    let y;
    if (left !== null) x = area.x + left + ml;
    else if (right !== null) x = area.x + area.w - right - width - mr;
    else x = area.x + ml;
    if (top !== null) y = area.y + top + mt;
    else if (bottom !== null) y = area.y + area.h - bottom - height - mb;
    else y = area.y + mt;
    return { x, y, w: width, h: height };
  }

  const content = host['content-box'];
  const width = w > 0 ? w : content.w;
  const height = h > 0 ? h : content.h;
  if (!(width > 0 && height > 0)) return null;
  const ox = left !== null ? left : right !== null ? -right : 0;
  const oy = top !== null ? top : bottom !== null ? -bottom : 0;
  if (pseudoName === '::after') {
    return { x: content.x + Math.max(0, content.w - width) - mr + ox, y: content.y + mt + oy, w: width, h: height };
  }
  return { x: content.x + ml + ox, y: content.y + mt + oy, w: width, h: height };
}

/** CSS background images using a computed style and its boxes (the element itself or a pseudo). */
function backgroundLayersAt(element, x, y, style, own, kind, paintsCanvas) {
  if (style.visibility !== 'visible' || style.backgroundImage === 'none') return null;
  const layers = splitTopLevel(style.backgroundImage);
  if (!layers.some((layer) => extractImageUrl(layer))) return null;

  const root = document.documentElement;
  const rootStyle = element === root ? style : getComputedStyle(root);
  const positioning = paintsCanvas ? boxesOf(root, rootStyle) : own;
  const canvas = { x: 0, y: 0, w: root.clientWidth, h: root.clientHeight };

  const sizes = splitTopLevel(style.backgroundSize);
  const posX = splitTopLevel(style.backgroundPositionX);
  const posY = splitTopLevel(style.backgroundPositionY);
  const repeats = splitTopLevel(style.backgroundRepeat);
  const origins = splitTopLevel(style.backgroundOrigin);
  const clips = splitTopLevel(style.backgroundClip);

  for (let i = 0; i < layers.length; i += 1) {
    const raw = extractImageUrl(layers[i]);
    if (!raw) continue; // gradient or none: not a picture file
    const url = absoluteCssUrl(raw, element);

    const clipName = layerValue(clips, i, 'border-box');
    if (clipName === 'text') continue;
    const clipBox = paintsCanvas ? canvas : own[clipName] || own['border-box'];
    if (!contains(clipBox, x, y)) continue;

    const natural = naturalSizeOf(url);
    if (natural.state !== 'ok') continue; // still loading (the inspector refreshes when it is) or broken

    const density = imageSetDensity(layers[i]);
    const origin = positioning[layerValue(origins, i, 'padding-box')] || positioning['padding-box'];
    const layout = layoutBackgroundLayer({
      natural: { w: natural.w / density, h: natural.h / density },
      area: { w: origin.w, h: origin.h },
      size: layerValue(sizes, i, 'auto'),
      posX: layerValue(posX, i, '0%'),
      posY: layerValue(posY, i, '0%'),
      repeat: layerValue(repeats, i, 'repeat'),
    });
    const tile = layout.tileAt(x - origin.x, y - origin.y);
    if (!tile || !(tile.w > 0 && tile.h > 0)) continue;

    const painted = { x: origin.x + tile.x, y: origin.y + tile.y, w: tile.w, h: tile.h };
    return makeHit({
      element,
      kind,
      url,
      display: { w: tile.w, h: tile.h },
      natural: { w: natural.w, h: natural.h },
      outline: intersect(painted, clipBox) || painted,
      box: { w: own['border-box'].w, h: own['border-box'].h },
      layers: layers.filter((layer) => extractImageUrl(layer)).length,
    });
  }
  return null;
}

/** CSS background images of one element: the first picture really painted under the point. */
function backgroundImageAt(element, x, y) {
  const style = getComputedStyle(element);
  if (style.visibility !== 'visible' || style.backgroundImage === 'none') return null;
  const root = document.documentElement;
  const rootStyle = element === root ? style : getComputedStyle(root);
  // A background on <html>, or on <body> when <html> has none, paints the whole canvas.
  const rootIsPlain = rootStyle.backgroundImage === 'none' && /^(transparent|rgba\(\s*0,\s*0,\s*0,\s*0\s*\))$/.test(rootStyle.backgroundColor);
  const paintsCanvas = element === root || (element === document.body && rootIsPlain);
  return backgroundLayersAt(element, x, y, style, boxesOf(element, style), 'Background image', paintsCanvas);
}

function firstStyleValue(style, names) {
  for (const name of names) {
    const value = style[name];
    if (value && value !== 'none') return value;
  }
  return '';
}

function maskAxes(style) {
  let posX = firstStyleValue(style, ['maskPositionX', 'webkitMaskPositionX']);
  let posY = firstStyleValue(style, ['maskPositionY', 'webkitMaskPositionY']);
  if (!posX || !posY) {
    const parts = splitSpaces(firstStyleValue(style, ['maskPosition', 'webkitMaskPosition']) || '0% 0%');
    posX = posX || positionToken(parts[0], '0%');
    posY = posY || positionToken(parts[1] || parts[0], '0%');
  }
  return { posX: positionToken(posX, '0%'), posY: positionToken(posY, '0%') };
}

/**
 * A CSS picture (mask, border-image, list-style-image, content:url).
 * If the painted tile cannot be resolved, the element's box is still reported
 * so a mask icon can be downloaded.
 */
function cssPictureAt(element, x, y, { style, own, kind, imageValue, sizeValue = 'auto', posX = '50%', posY = '50%', repeat = 'no-repeat', originName = 'border-box', clipName = 'border-box' }) {
  if (!imageValue || imageValue === 'none') return null;
  if (style.visibility !== 'visible' || Number(style.opacity) === 0) return null;
  const layers = splitTopLevel(imageValue);
  if (!layers.some((layer) => extractImageUrl(layer))) return null;

  const clipBox = own[clipName] || own['border-box'];
  if (!clipBox || !contains(clipBox, x, y)) return null;
  const origin = own[originName] || own['border-box'] || clipBox;
  const sizes = splitTopLevel(sizeValue);
  const repeats = splitTopLevel(repeat);

  for (let i = 0; i < layers.length; i += 1) {
    const raw = extractImageUrl(layers[i]);
    if (!raw) continue;
    const url = absoluteCssUrl(raw, element);
    const natural = naturalSizeOf(url);
    if (natural.state === 'loading') return null;

    let painted = { x: origin.x, y: origin.y, w: origin.w, h: origin.h };
    if (natural.state === 'ok' && natural.w > 0 && natural.h > 0) {
      const density = imageSetDensity(layers[i]);
      const layout = layoutBackgroundLayer({
        natural: { w: natural.w / density, h: natural.h / density },
        area: { w: origin.w, h: origin.h },
        size: layerValue(sizes, i, 'auto'),
        posX,
        posY,
        repeat: layerValue(repeats, i, 'no-repeat'),
      });
      const tile = layout.tileAt(x - origin.x, y - origin.y);
      if (tile && tile.w > 0 && tile.h > 0) painted = { x: origin.x + tile.x, y: origin.y + tile.y, w: tile.w, h: tile.h };
    }

    return makeHit({
      element,
      kind,
      url,
      display: { w: painted.w, h: painted.h },
      natural: { w: natural.w || 0, h: natural.h || 0 },
      outline: intersect(painted, clipBox) || painted,
      box: { w: own['border-box'].w, h: own['border-box'].h },
    });
  }
  return null;
}

function maskImageAt(element, x, y, style, own, kind = 'Mask image') {
  let imageValue = firstStyleValue(style, ['maskImage', 'webkitMaskImage']);
  if (!extractImageUrl(imageValue)) {
    const shorthand = firstStyleValue(style, ['mask', 'webkitMask']);
    if (extractImageUrl(shorthand)) imageValue = shorthand;
  }
  if (!imageValue) return null;
  const axes = maskAxes(style);
  return cssPictureAt(element, x, y, {
    style,
    own,
    kind,
    imageValue,
    sizeValue: firstStyleValue(style, ['maskSize', 'webkitMaskSize']) || 'auto',
    posX: axes.posX,
    posY: axes.posY,
    repeat: firstStyleValue(style, ['maskRepeat', 'webkitMaskRepeat']) || 'no-repeat',
    originName: firstStyleValue(style, ['maskOrigin', 'webkitMaskOrigin']) || 'border-box',
    clipName: firstStyleValue(style, ['maskClip', 'webkitMaskClip']) || 'border-box',
  });
}

function borderImageAt(element, x, y, style, own) {
  return cssPictureAt(element, x, y, {
    style,
    own,
    kind: 'Border image',
    imageValue: firstStyleValue(style, ['borderImageSource', 'webkitBorderImageSource']),
    sizeValue: firstStyleValue(style, ['borderImageWidth']) || 'auto',
    posX: '0%',
    posY: '0%',
    repeat: 'stretch',
  });
}

function listStyleImageAt(element, x, y, style, own) {
  return cssPictureAt(element, x, y, {
    style,
    own,
    kind: 'List image',
    imageValue: firstStyleValue(style, ['listStyleImage']),
    sizeValue: 'auto',
    posX: '0%',
    posY: '0%',
    repeat: 'no-repeat',
  });
}

function contentImageAt(element, x, y, style, own, kind = 'Content image') {
  const url = extractImageUrl(style.content);
  if (!url) return null;
  const box = own['content-box'] || own['border-box'];
  if (!box || !contains(box, x, y) || (box.w <= 2 && box.h <= 2)) return null;
  if (style.visibility !== 'visible' || Number(style.opacity) === 0) return null;
  const abs = absoluteCssUrl(url, element);
  const natural = naturalSizeOf(abs);
  if (natural.state === 'loading') return null;
  return makeHit({
    element,
    kind,
    url: abs,
    display: { w: box.w, h: box.h },
    natural: { w: natural.w || 0, h: natural.h || 0 },
    outline: box,
    box: { w: own['border-box'].w, h: own['border-box'].h },
    alt: contentAlt(style.content),
  });
}

function extraCssImagesAt(element, x, y, style, own, kindPrefix = '') {
  const maskKind = kindPrefix || 'Mask image';
  return maskImageAt(element, x, y, style, own, maskKind) || (!kindPrefix && borderImageAt(element, x, y, style, own)) || (!kindPrefix && listStyleImageAt(element, x, y, style, own));
}

/** `content: url()` or background-image on ::before / ::after. */
function pseudoImageAt(element, x, y, pseudoName, { backgrounds = true } = {}) {
  let style;
  try {
    style = getComputedStyle(element, pseudoName);
  } catch {
    return null;
  }
  if (!pseudoExists(style)) return null;
  const kind = pseudoName === '::before' ? '::before image' : '::after image';
  const rect = pseudoRect(element, pseudoName, style);
  if (!rect) return null;

  const contentUrl = extractImageUrl(style.content);
  if (contentUrl && contains(rect, x, y) && !(rect.w <= 2 && rect.h <= 2)) {
    const url = absoluteCssUrl(contentUrl, element);
    const natural = naturalSizeOf(url);
    if (natural.state === 'ok') {
      return makeHit({
        element,
        kind,
        url,
        display: { w: rect.w, h: rect.h },
        natural: { w: natural.w, h: natural.h },
        outline: rect,
        box: { w: rect.w, h: rect.h },
        alt: contentAlt(style.content),
      });
    }
    if (natural.state === 'loading') return null;
  }

  const own = boxesFromRect(rect, style);
  if (!contains(rect, x, y)) return null;
  if (backgrounds) {
    const background = backgroundLayersAt(element, x, y, style, own, kind, false);
    if (background) return background;
  }
  return maskImageAt(element, x, y, style, own, kind) || contentImageAt(element, x, y, style, own, kind);
}

/**
 * Direct children whose box contains the point. Used for pictures that
 * `elementsFromPoint` skips (`pointer-events: none`, or a parent ::before overlay).
 */
function kidsAtPoint(element, x, y) {
  const out = [];
  const children = element?.children;
  if (!children || !children.length) return out;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    const box = child.getBoundingClientRect();
    if (!(box.width > 2 && box.height > 2)) continue;
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
    out.push(child);
  }
  return out;
}

/** Pictures on one element, top to bottom. `under` is searched after ::before (overlay) and before the background. */
function pictureOn(element, x, y, { backgrounds = true, under = null } = {}) {
  const after = pseudoImageAt(element, x, y, '::after', { backgrounds });
  if (after) return after;
  const real = realImageAt(element, x, y);
  if (real) return real;
  const style = getComputedStyle(element);
  const own = boxesOf(element, style);
  const content = contentImageAt(element, x, y, style, own);
  if (content) return content;
  const before = pseudoImageAt(element, x, y, '::before', { backgrounds });
  if (before) return before;
  if (under) {
    const nested = under();
    if (nested) return nested;
  }
  if (backgrounds) {
    const background = backgroundImageAt(element, x, y);
    if (background) return background;
  }
  return extraCssImagesAt(element, x, y, style, own);
}

/** The picture under a point, or null. Elements on top (text, links, overlays) are looked through. */
export function imageAtPoint(x, y, { backgrounds = true } = {}) {
  const seen = new Set();
  const visit = (element, walkKids) => {
    if (!element || seen.has(element) || element.id === HOST_ID) return null;
    seen.add(element);
    return pictureOn(element, x, y, {
      backgrounds,
      under:
        walkKids && element.localName !== 'html' && element.localName !== 'body'
          ? () => {
              for (const child of kidsAtPoint(element, x, y)) {
                const nested = visit(child, true);
                if (nested) return nested;
              }
              return null;
            }
          : null,
    });
  };

  for (const element of stackAt(document, x, y)) {
    const hit = visit(element, true);
    if (hit) return hit;
  }
  return mediaFallbackAt(x, y);
}

/**
 * Last resort: any replaced picture whose box is under the pointer, even when
 * hit-testing never saw it (whole-card `a::before`, pointer-events, opacity 0).
 */
function mediaFallbackAt(x, y) {
  const stack = stackAt(document, x, y);
  let scope = document;
  for (const el of stack) {
    if (!el?.closest || el === document.documentElement || el === document.body) continue;
    scope = el.closest('a, li, figure, picture, section, article, [class*="image"]') || el;
    break;
  }
  if (!scope.querySelectorAll) scope = document;
  const nodes = scope.querySelectorAll('img, picture, input[type="image"], image, video[poster]');
  let best = null;
  let bestArea = Infinity;
  const limit = Math.min(nodes.length, 250);
  for (let i = 0; i < limit; i += 1) {
    const hit = realImageAt(nodes[i], x, y);
    if (!hit) continue;
    const area = hit.display.w * hit.display.h;
    if (area > 0 && area < bestArea) {
      best = hit;
      bestArea = area;
    }
  }
  return best;
}

/* ------------------------------------------------------------- Card */

const CSS_TEXT = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .outline {
    position: fixed; left: 0; top: 0; pointer-events: none; z-index: 2147483646;
    border: 2px solid #7c6cf6; background: rgba(124, 108, 246, 0.13);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55), 0 0 0 4px rgba(124, 108, 246, 0.25);
    border-radius: 2px; display: none;
  }
  .outline.preview {
    border-style: dashed;
    background: rgba(124, 108, 246, 0.06);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
  }
  .outline.lock {
    border-color: #2f9d78;
    background: rgba(47, 157, 120, 0.14);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55), 0 0 0 4px rgba(47, 157, 120, 0.25);
  }
  .chip {
    position: absolute; left: -2px; top: -2px; transform: translateY(-100%);
    padding: 2px 7px; border-radius: 5px 5px 5px 0; white-space: nowrap;
    font: 650 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #fff; background: #5b4bd8; font-variant-numeric: tabular-nums;
  }
  .chip.lock { background: #2f9d78; }
  .chip.inside { transform: none; border-radius: 0 0 5px 0; }
  .tip {
    position: fixed; left: 0; top: 0; width: 292px; pointer-events: none; z-index: 2147483647;
    display: none; padding: 12px; border-radius: 12px;
    color: #e9ebf1; background: rgba(22, 25, 32, 0.97); border: 1px solid #353c4b;
    box-shadow: 0 14px 38px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(0, 0, 0, 0.25);
    font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
  .kind {
    padding: 1px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 650; letter-spacing: 0.04em;
    text-transform: uppercase; color: #b9b0ff; background: rgba(124, 108, 246, 0.18);
  }
  .state { font-size: 11px; color: #f0b24a; font-weight: 700; }
  .state.action {
    padding: 1px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
    text-transform: uppercase; color: #e4e0ff; background: rgba(124, 108, 246, 0.28);
    border: 1px solid rgba(185, 176, 255, 0.4);
  }
  .state.lock {
    padding: 1px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
    text-transform: uppercase; color: #b7f0d8; background: rgba(47, 157, 120, 0.28);
    border: 1px solid rgba(67, 197, 158, 0.4);
  }
  .main { display: flex; gap: 11px; align-items: center; }
  .thumb {
    flex: none; width: 58px; height: 58px; border-radius: 8px; overflow: hidden; border: 1px solid #353c4b;
    background: repeating-conic-gradient(#2b303b 0% 25%, #1c2029 0% 50%) 50% / 12px 12px;
    display: grid; place-items: center;
  }
  .thumb img { max-width: 100%; max-height: 100%; display: block; }
  .sizes { min-width: 0; }
  .big {
    font: 700 22px/1.15 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums; color: #fff; white-space: nowrap;
  }
  .big small { font-size: 12px; font-weight: 600; color: #a4abbd; margin-left: 3px; letter-spacing: 0; }
  .label { margin-top: 2px; font-size: 11px; color: #a4abbd; }
  .rows { margin-top: 10px; padding-top: 9px; border-top: 1px solid #272c38; display: grid; gap: 4px; }
  .row { display: flex; gap: 10px; justify-content: space-between; align-items: baseline; }
  .row[hidden], .thumb[hidden], .state[hidden], .name[hidden] { display: none; }
  .row span:first-child { flex: none; color: #8a92a5; }
  .row span:last-child { min-width: 0; text-align: right; color: #e9ebf1; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .tone-ok { color: #43c59e !important; }
  .tone-warn { color: #f0b24a !important; }
  .tone-info { color: #e9ebf1; }
  .name {
    margin-top: 9px; padding: 5px 8px; border-radius: 6px; background: #1c2029; color: #a4abbd;
    font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .download-note {
    margin-top: 8px; padding: 7px 9px; border-radius: 7px;
    background: rgba(124, 108, 246, 0.28); color: #e4e0ff;
    border: 1px solid rgba(185, 176, 255, 0.45);
    font: 800 12px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    letter-spacing: -0.01em; text-align: center;
  }
  .hint { margin-top: 8px; font-size: 10.5px; color: #6e7688; }
`;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function buildCard() {
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;

  const outline = node('div', 'outline');
  const chip = node('div', 'chip');
  outline.append(chip);
  const lockOutline = node('div', 'outline lock');
  const lockChip = node('div', 'chip lock');
  lockOutline.append(lockChip);

  const tip = node('div', 'tip');
  const kind = node('span', 'kind');
  const state = node('span', 'state');
  const top = node('div', 'top');
  top.append(kind, state);

  const thumb = node('div', 'thumb');
  const thumbImage = document.createElement('img');
  thumbImage.alt = '';
  thumbImage.decoding = 'async';
  thumbImage.referrerPolicy = 'no-referrer';
  thumbImage.addEventListener('error', () => {
    thumb.hidden = true;
  });
  thumb.append(thumbImage);
  const big = node('div', 'big');
  const label = node('div', 'label', 'Displayed size');
  const sizes = node('div', 'sizes');
  sizes.append(big, label);
  const main = node('div', 'main');
  main.append(thumb, sizes);

  const rows = node('div', 'rows');
  const makeRow = (name, mono = false) => {
    const row = node('div', 'row');
    const value = node('span', mono ? 'mono' : '');
    const title = node('span', '', name);
    row.append(title, value);
    rows.append(row);
    return { row, value, mono, title, name };
  };
  const fields = {
    natural: makeRow('Displayed on page', true),
    scale: makeRow('Scale'),
    ratio: makeRow('Aspect ratio', true),
    file: makeRow('File'),
    box: makeRow('Element box', true),
    alt: makeRow('Alt text'),
  };
  const name = node('div', 'name');
  const downloadNote = node('div', 'download-note', 'Download this image from the sidebar');
  const hint = node('div', 'hint', 'Click to lock · Esc to stop');
  tip.append(top, main, rows, name, downloadNote, hint);

  shadow.append(style, lockOutline, outline, tip);
  return { host, outline, chip, lockOutline, lockChip, tip, kind, state, thumb, thumbImage, big, label, fields, name, downloadNote, hint };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/* -------------------------------------------------------- Inspector */

function sameImage(a, b) {
  if (!a || !b) return false;
  if (a.element && b.element) return a.element === b.element && a.url === b.url && a.kind === b.kind;
  return a.key === b.key;
}

function withAnchor(hit) {
  const el = hit.element;
  if (!el?.getBoundingClientRect) return hit;
  const rect = el.getBoundingClientRect();
  const box = hit.outline || boxOfRect(rect);
  return {
    ...hit,
    anchor: {
      x: box.x + box.w / 2 - rect.left,
      y: box.y + box.h / 2 - rect.top,
    },
  };
}

function setOutline(outline, chip, box, text) {
  if (!box || !(box.w > 0 && box.h > 0)) {
    outline.style.display = 'none';
    return;
  }
  Object.assign(outline.style, { display: 'block', transform: `translate(${box.x}px, ${box.y}px)`, width: `${box.w}px`, height: `${box.h}px` });
  chip.textContent = text;
  chip.classList.toggle('inside', box.y < 24);
}

function paintCard(card, hit, point, options, lockedHit = null) {
  const { display, natural } = hit;
  const tr = (text) => translate(text, options.language);
  const lockedHere = sameImage(hit, lockedHit);
  card.kind.textContent = tr(hit.kind);
  card.state.hidden = false;
  const status = hit.broken ? 'Failed to load' : hit.loading ? 'Loading…' : lockedHere ? 'Locked' : 'Click to lock';
  card.state.textContent = tr(status);
  card.state.classList.toggle('lock', status === 'Locked');
  card.state.classList.toggle('action', status === 'Click to lock');
  card.hint.textContent = tr(lockedHere ? 'Click again to unlock · Esc to stop' : 'Click to lock · Esc to stop');
  card.downloadNote.textContent = tr('Download this image from the sidebar');
  for (const field of Object.values(card.fields)) field.title.textContent = tr(field.name);

  // The headline is the picture's real (file) size. Only when that is unknown does the displayed size stand in.
  const known = natural.w > 0 && natural.h > 0;
  const headline = known ? natural : display;
  card.big.replaceChildren(formatSize(headline.w, headline.h), node('small', '', 'px'));
  card.label.textContent = tr(known ? 'Actual image size' : hit.loading ? 'Still loading - showing displayed size' : 'Displayed size (actual size unknown)');

  const set = (field, value, tone = '') => {
    field.row.hidden = !value;
    field.value.textContent = value || '';
    field.value.className = [field.mono ? 'mono' : '', tone ? `tone-${tone}` : ''].filter(Boolean).join(' ');
  };
  set(card.fields.natural, known ? `${formatSize(display.w, display.h)} px` : '');
  set(card.fields.scale, hit.scale ? tr(hit.scale.text) : '', hit.scale?.tone);
  set(card.fields.ratio, hit.ratio);
  const file = [hit.format, formatBytes(hit.bytes)].filter(Boolean).join(' · ');
  set(card.fields.file, file);
  set(card.fields.box, hit.box ? `${formatSize(hit.box.w, hit.box.h)} px` : '');
  set(card.fields.alt, hit.alt ? (hit.alt.length > 48 ? `${hit.alt.slice(0, 47)}…` : hit.alt) : '');
  card.name.hidden = !hit.name;
  card.name.textContent = tr(hit.name);
  card.name.title = hit.url.length > 300 ? `${hit.url.slice(0, 299)}…` : hit.url;

  const showThumb = options.preview && !hit.broken;
  card.thumb.hidden = !showThumb;
  if (showThumb && card.thumbImage.dataset.src !== hit.url) {
    card.thumbImage.dataset.src = hit.url;
    card.thumbImage.src = hit.url;
  }

  // Hover outline: solid when nothing is locked, dashed while another picture is locked.
  const showHoverOutline = options.outline && hit.outline && !lockedHere;
  card.outline.classList.toggle('preview', !!(lockedHit && showHoverOutline));
  if (showHoverOutline) {
    setOutline(card.outline, card.chip, hit.outline, `${formatPixels(headline.w)} × ${formatPixels(headline.h)}`);
  } else {
    card.outline.style.display = 'none';
  }

  // The card, kept inside the window and away from the pointer.
  card.tip.style.display = 'block';
  const width = card.tip.offsetWidth;
  const height = card.tip.offsetHeight;
  const maxX = document.documentElement.clientWidth;
  const maxY = document.documentElement.clientHeight;
  let left = point.x + 18;
  let top = point.y + 18;
  if (left + width > maxX - 8) left = point.x - width - 18;
  if (top + height > maxY - 8) top = point.y - height - 18;
  left = clamp(left, 8, Math.max(8, maxX - width - 8));
  top = clamp(top, 8, Math.max(8, maxY - height - 8));
  card.tip.style.transform = `translate(${left}px, ${top}px)`;
}

/** The part of a hit that is sent to the side panel (plain data, bounded in size). */
function summary(hit) {
  const url = hit.url.length > MAX_URL_SENT ? `${hit.url.slice(0, MAX_URL_SENT)}…` : hit.url;
  return {
    kind: hit.kind,
    url,
    isData: /^data:/i.test(hit.url),
    name: hit.name,
    format: hit.format,
    bytes: hit.bytes,
    display: { w: Math.round(hit.display.w * 10) / 10, h: Math.round(hit.display.h * 10) / 10 },
    natural: hit.natural,
    box: hit.box || null,
    ratio: hit.ratio,
    scale: hit.scale ? { text: hit.scale.text, tone: hit.scale.tone } : null,
    alt: hit.alt || '',
    pageUrl: location.href,
  };
}

/**
 * Start (or update the options of) the inspector in this page.
 * @param {{ backgrounds?: boolean, outline?: boolean, preview?: boolean }} [options]
 */
export function startInspector(options = {}) {
  const settings = {
    backgrounds: options.backgrounds !== false,
    outline: options.outline !== false,
    preview: options.preview !== false,
    language: normalizeLanguage(options.language),
  };
  if (session) {
    session.options = settings;
    session.refresh();
    return { running: true };
  }

  const card = buildCard();
  document.documentElement.append(card.host);
  const state = { options: settings, point: null, frame: 0, lastKey: '', locked: null, refresh: null };

  const hideHover = () => {
    card.tip.style.display = 'none';
    card.outline.style.display = 'none';
  };

  const paintLock = (locked) => {
    if (!state.options.outline || !locked?.outline) {
      card.lockOutline.style.display = 'none';
      return;
    }
    setOutline(card.lockOutline, card.lockChip, locked.outline, translate('Locked', state.options.language));
  };

  const liveLocked = () => {
    const locked = state.locked;
    if (!locked) {
      card.lockOutline.style.display = 'none';
      return null;
    }
    const el = locked.element;
    if (!el || !el.isConnected) {
      state.locked = null;
      if (session) session.locked = null;
      card.lockOutline.style.display = 'none';
      broadcast(MSG.IMAGE_INSPECT_EVENT, { type: 'unlock' });
      return null;
    }
    const rect = el.getBoundingClientRect();
    const x = rect.left + (locked.anchor?.x ?? Math.min(8, Math.max(0, rect.width / 2)));
    const y = rect.top + (locked.anchor?.y ?? Math.min(8, Math.max(0, rect.height / 2)));
    try {
      const next = imageAtPoint(x, y, { backgrounds: state.options.backgrounds });
      if (next && sameImage(next, locked)) {
        state.locked = withAnchor(next);
        lastHit = state.locked;
        if (session) session.locked = state.locked;
        paintLock(state.locked);
        return state.locked;
      }
    } catch {
      /* keep the last locked outline */
    }
    locked.outline = boxOfRect(rect);
    paintLock(locked);
    return locked;
  };

  const lookup = (x, y) => {
    try {
      return imageAtPoint(x, y, { backgrounds: state.options.backgrounds });
    } catch {
      return null; // a page that throws on layout reads must never break the inspector
    }
  };

  const hitFromNode = (element) => {
    if (!element || element.nodeType !== 1 || element.id === HOST_ID) return null;
    const box = element.getBoundingClientRect?.();
    if (!box || !(box.width > 2 && box.height > 2)) return null;
    return lookup(box.left + Math.min(8, box.width / 2), box.top + Math.min(8, box.height / 2));
  };

  const hitAtEvent = (event) => {
    const x = event.clientX;
    const y = event.clientY;
    const looksReal = Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0);
    if (looksReal) {
      const fromPoint = lookup(x, y);
      if (fromPoint) return fromPoint;
    }
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const node of path) {
      const hit = hitFromNode(node);
      if (hit) return hit;
    }
    return hitFromNode(event.target);
  };

  const setLocked = (hit) => {
    state.locked = hit ? withAnchor(hit) : null;
    if (session) session.locked = state.locked;
    if (state.locked) lastHit = state.locked;
  };

  const update = () => {
    state.frame = 0;
    const locked = liveLocked();
    if (!state.point) {
      hideHover();
      return;
    }
    const hit = lookup(state.point.x, state.point.y);
    if (!hit) {
      hideHover();
      return;
    }
    paintCard(card, hit, state.point, state.options, locked);
    if (locked) return;
    lastHit = hit;
    if (hit.key !== state.lastKey) {
      state.lastKey = hit.key;
      broadcast(MSG.IMAGE_INSPECT_EVENT, { type: 'hover', info: summary(hit) });
    }
  };

  const schedule = () => {
    if (!state.frame) state.frame = requestAnimationFrame(update);
  };
  state.refresh = schedule;

  const onMove = (event) => {
    state.point = { x: event.clientX, y: event.clientY };
    schedule();
  };
  const onLeave = () => {
    state.point = null;
    schedule();
  };
  const onClick = (event) => {
    if (event.button !== 0) return;
    const hit = hitAtEvent(event);
    if (!hit) {
      if (!state.locked) return;
      setLocked(null);
      broadcast(MSG.IMAGE_INSPECT_EVENT, { type: 'unlock' });
      schedule();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (sameImage(hit, state.locked)) {
      setLocked(null);
      lastHit = hit;
      broadcast(MSG.IMAGE_INSPECT_EVENT, { type: 'unlock' });
    } else {
      setLocked(hit);
      broadcast(MSG.IMAGE_INSPECT_EVENT, { type: 'lock', info: summary(hit) });
    }
    schedule();
  };
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    stopInspector();
    broadcast(MSG.IMAGE_INSPECT_EVENT, { type: 'stopped' });
  };

  const listeners = [
    [window, 'mousemove', onMove, { capture: true, passive: true }],
    [window, 'click', onClick, { capture: true }],
    [window, 'scroll', schedule, { capture: true, passive: true }],
    [window, 'resize', schedule, { passive: true }],
    [document.documentElement, 'mouseleave', onLeave, { passive: true }],
    [window, 'keydown', onKey, { capture: true }],
  ];
  for (const [target, type, handler, flags] of listeners) target.addEventListener(type, handler, flags);

  session = {
    get options() {
      return state.options;
    },
    set options(value) {
      state.options = value;
    },
    get locked() {
      return state.locked;
    },
    set locked(value) {
      state.locked = value;
    },
    refresh: schedule,
    stop() {
      cancelAnimationFrame(state.frame);
      for (const [target, type, handler, flags] of listeners) target.removeEventListener(type, handler, flags);
      card.host.remove();
    },
  };
  return { running: true };
}

/** Stop the inspector and remove everything it drew. */
export function stopInspector() {
  if (!session) return { running: false };
  session.stop();
  session = null;
  return { running: false };
}

export const isInspectorRunning = () => session !== null;

export const isInspectorLocked = () => !!session?.locked;

function absoluteUrl(url) {
  if (!url || /^data:/i.test(url) || /^blob:/i.test(url)) return url;
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

/**
 * The locked picture, or the last hovered one, with a full address the side
 * panel can fetch. blob: URLs are turned into data URLs because the panel cannot
 * read them.
 */
export async function inspectedImageSource() {
  if (!lastHit) return null;
  let url = absoluteUrl(lastHit.url);
  if (/^blob:/i.test(url)) {
    try {
      const blob = await fetch(url).then((response) => response.blob());
      url = await blobToDataUrl(blob);
    } catch {
      /* keep the blob URL; the panel will report the failure */
    }
  }
  return { url, name: lastHit.name, format: lastHit.format };
}
