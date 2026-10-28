/**
 * Image Resolution: hover any image on the page and see its size.
 *
 * While the inspector runs, the pointer is followed and the pictures under it
 * are looked up from the whole stack of elements at that point
 * (`elementsFromPoint`), so an image is found even when text, buttons, links or
 * transparent layers sit on top of it. Two kinds of pictures are recognised:
 *
 *   - real images: <img> (and <picture>), <input type="image">, SVG <image>
 *   - CSS background images, including several layers, `background-size`,
 *     `-position`, `-repeat`, `-origin` and `-clip`, so the point must really be
 *     over the painted picture, not just over the element that owns it
 *
 * Nothing on the page is changed: the card and the outline are drawn in a
 * closed shadow root under <html> that ignores the pointer, and are removed
 * when the inspector stops.
 */

import { MSG } from '../shared/constants.js';
import { broadcast } from '../services/message-service.js';
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
  splitTopLevel,
} from '../services/image-geometry.js';

const HOST_ID = 'wit-image-inspector';
const MAX_CACHE = 300;
const MAX_STACK = 60;
const MAX_URL_SENT = 2000;

let session = null; // the running inspector, or null

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

/** <img>, <input type="image"> and SVG <image>. */
function realImageAt(element) {
  const tag = element.localName;
  let url = '';
  let kind = 'Image';
  if (tag === 'img') {
    url = element.currentSrc || element.src;
    if (element.parentElement?.localName === 'picture') kind = 'Picture';
  } else if (tag === 'input' && element.type === 'image') {
    url = element.src;
    kind = 'Image button';
  } else if (tag === 'image' && element.namespaceURI === 'http://www.w3.org/2000/svg') {
    url = element.href?.baseVal ? new URL(element.href.baseVal, element.baseURI).href : '';
    kind = 'SVG image';
  } else return null;
  if (!url) return null;

  const style = getComputedStyle(element);
  if (style.visibility !== 'visible' || Number(style.opacity) === 0) return null;

  const content = tag === 'image' ? (() => {
    const r = element.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })() : boxesOf(element, style)['content-box'];
  if (content.w <= 2 && content.h <= 2) return null; // tracking pixels and spacers are not worth reporting

  // The picture's real pixel size. With srcset the browser divides by the density, so read the file itself.
  let natural = { w: element.naturalWidth || 0, h: element.naturalHeight || 0 };
  if (tag !== 'image' && (element.hasAttribute('srcset') || kind === 'Picture')) {
    const raw = naturalSizeOf(url);
    if (raw.state === 'ok' && raw.w) natural = { w: raw.w, h: raw.h };
  } else if (tag === 'image') {
    const raw = naturalSizeOf(url);
    if (raw.state === 'ok') natural = { w: raw.w, h: raw.h };
  }
  const broken = tag === 'img' && element.complete && natural.w === 0;
  const loading = tag === 'img' && !element.complete;

  return makeHit({
    kind,
    url,
    display: { w: content.w, h: content.h },
    natural,
    outline: content,
    alt: tag === 'img' ? element.alt || '' : '',
    broken,
    loading,
  });
}

/** CSS background images of one element: the first picture really painted under the point. */
function backgroundImageAt(element, x, y) {
  const style = getComputedStyle(element);
  if (style.visibility !== 'visible' || style.backgroundImage === 'none') return null;
  const layers = splitTopLevel(style.backgroundImage);
  if (!layers.some((layer) => extractImageUrl(layer))) return null;

  const root = document.documentElement;
  const rootStyle = element === root ? style : getComputedStyle(root);
  // A background on <html>, or on <body> when <html> has none, paints the whole canvas.
  const rootIsPlain = rootStyle.backgroundImage === 'none' && /^(transparent|rgba\(\s*0,\s*0,\s*0,\s*0\s*\))$/.test(rootStyle.backgroundColor);
  const paintsCanvas = element === root || (element === document.body && rootIsPlain);
  const own = boxesOf(element, style);
  const positioning = paintsCanvas ? boxesOf(root, rootStyle) : own;
  const canvas = { x: 0, y: 0, w: root.clientWidth, h: root.clientHeight };

  const sizes = splitTopLevel(style.backgroundSize);
  const posX = splitTopLevel(style.backgroundPositionX);
  const posY = splitTopLevel(style.backgroundPositionY);
  const repeats = splitTopLevel(style.backgroundRepeat);
  const origins = splitTopLevel(style.backgroundOrigin);
  const clips = splitTopLevel(style.backgroundClip);

  for (let i = 0; i < layers.length; i += 1) {
    const url = extractImageUrl(layers[i]);
    if (!url) continue; // gradient or none: not a picture file

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
      kind: 'Background image',
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

/** The picture under a point, or null. Elements on top (text, links, overlays) are looked through. */
export function imageAtPoint(x, y, { backgrounds = true } = {}) {
  for (const element of stackAt(document, x, y)) {
    if (element.id === HOST_ID) continue;
    const real = realImageAt(element);
    if (real) return real;
    if (backgrounds) {
      const background = backgroundImageAt(element, x, y);
      if (background) return background;
    }
  }
  return null;
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
  .chip {
    position: absolute; left: -2px; top: -2px; transform: translateY(-100%);
    padding: 2px 7px; border-radius: 5px 5px 5px 0; white-space: nowrap;
    font: 650 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #fff; background: #5b4bd8; font-variant-numeric: tabular-nums;
  }
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
  .state { font-size: 11px; color: #f0b24a; }
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
    row.append(node('span', '', name), value);
    rows.append(row);
    return { row, value, mono };
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
  const hint = node('div', 'hint', 'Esc to stop');
  tip.append(top, main, rows, name, hint);

  shadow.append(style, outline, tip);
  return { host, outline, chip, tip, kind, state, thumb, thumbImage, big, label, fields, name };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/* -------------------------------------------------------- Inspector */

function paintCard(card, hit, point, options) {
  const { display, natural } = hit;
  card.kind.textContent = hit.kind;
  card.state.hidden = !(hit.broken || hit.loading);
  card.state.textContent = hit.broken ? 'Failed to load' : 'Loading…';

  // The headline is the picture's real (file) size. Only when that is unknown does the displayed size stand in.
  const known = natural.w > 0 && natural.h > 0;
  const headline = known ? natural : display;
  card.big.replaceChildren(formatSize(headline.w, headline.h), node('small', '', 'px'));
  card.label.textContent = known ? 'Actual image size' : hit.loading ? 'Still loading - showing displayed size' : 'Displayed size (actual size unknown)';

  const set = (field, value, tone = '') => {
    field.row.hidden = !value;
    field.value.textContent = value || '';
    field.value.className = [field.mono ? 'mono' : '', tone ? `tone-${tone}` : ''].filter(Boolean).join(' ');
  };
  set(card.fields.natural, known ? `${formatSize(display.w, display.h)} px` : '');
  set(card.fields.scale, hit.scale?.text || '', hit.scale?.tone);
  set(card.fields.ratio, hit.ratio);
  const file = [hit.format, formatBytes(hit.bytes)].filter(Boolean).join(' · ');
  set(card.fields.file, file);
  set(card.fields.box, hit.box ? `${formatSize(hit.box.w, hit.box.h)} px` : '');
  set(card.fields.alt, hit.alt ? (hit.alt.length > 48 ? `${hit.alt.slice(0, 47)}…` : hit.alt) : '');
  card.name.hidden = !hit.name;
  card.name.textContent = hit.name;
  card.name.title = hit.url.length > 300 ? `${hit.url.slice(0, 299)}…` : hit.url;

  const showThumb = options.preview && !hit.broken;
  card.thumb.hidden = !showThumb;
  if (showThumb && card.thumbImage.dataset.src !== hit.url) {
    card.thumbImage.dataset.src = hit.url;
    card.thumbImage.src = hit.url;
  }

  // The outline of the picture.
  if (options.outline && hit.outline) {
    const box = hit.outline;
    Object.assign(card.outline.style, { display: 'block', transform: `translate(${box.x}px, ${box.y}px)`, width: `${box.w}px`, height: `${box.h}px` });
    card.chip.textContent = `${formatPixels(headline.w)} × ${formatPixels(headline.h)}`;
    card.chip.classList.toggle('inside', box.y < 24);
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
  };
  if (session) {
    session.options = settings;
    session.refresh();
    return { running: true };
  }

  const card = buildCard();
  document.documentElement.append(card.host);
  const state = { options: settings, point: null, frame: 0, lastKey: '', refresh: null };

  const hide = () => {
    card.tip.style.display = 'none';
    card.outline.style.display = 'none';
  };

  const update = () => {
    state.frame = 0;
    if (!state.point) return hide();
    let hit = null;
    try {
      hit = imageAtPoint(state.point.x, state.point.y, { backgrounds: state.options.backgrounds });
    } catch {
      hit = null; // a page that throws on layout reads must never break the inspector
    }
    if (!hit) {
      hide();
      return;
    }
    paintCard(card, hit, state.point, state.options);
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
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    stopInspector();
    broadcast(MSG.IMAGE_INSPECT_EVENT, { type: 'stopped' });
  };

  const listeners = [
    [window, 'mousemove', onMove, { capture: true, passive: true }],
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
