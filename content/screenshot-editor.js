/**
 * Screenshot Taker: the editor that opens on the page after every capture
 * (Full Page, Current Screen and Select Area alike).
 *
 * The picture is shown with a tool palette (pen, line, arrow, circle / oval,
 * rectangle, square, text, highlighter, blur, number, colour and thickness, undo / redo) and
 * an action bar (copy to the clipboard, save as PNG, close). Nothing is
 * uploaded or shared anywhere.
 *
 * It is drawn in a closed shadow root under <html>, so the page's CSS cannot
 * touch it and it cannot touch the page. Annotations are kept as data (see
 * services/screenshot-draw.js): they are shown on a light layer while drawing
 * and painted onto the full-size picture only when it is copied or saved.
 */

import { normalizeLanguage, translate } from '../services/i18n.js';
import { COLORS, TEXT_FONT, TEXT_LINE_HEIGHT, TOOLS, WIDTHS, buildNumberMark, buildShape, drawAnnotation, drawAnnotations, drawSelection, hitTopAnnotation, isVisible, translateAnnotation } from '../services/screenshot-draw.js';
import { HIGHLIGHT_COLORS, colorById, placeRingCenter, sanitizeHighlightColor, swatchOffset } from '../services/highlighter.js';
import { LAYOUT, clampPoint, layoutEditor, screenshotFileName } from '../services/screenshot-geometry.js';
import { createIcon } from './screenshot-icons.js';
import { adoptCss, node } from './screenshot-ui.js';

export const EDITOR_HOST_ID = 'wit-screenshot-editor';
/** The drawing layer is kept at or below this many pixels (the saved picture is always full size). */
const MAX_LAYER_PIXELS = 20_000_000;
const TOAST_MS = 2600;

function normalizeHex(color) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!match) return '';
  let hex = match[1].toLowerCase();
  if (hex.length === 3) hex = [...hex].map((digit) => digit + digit).join('');
  return `#${hex}`;
}

const CSS = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  .root {
    position: fixed; inset: 0; z-index: 2147483647; color: #e9ecf5; outline: none;
    font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;
    -webkit-font-smoothing: antialiased; user-select: none; color-scheme: dark;
  }
  .backdrop { position: absolute; inset: 0; z-index: 0; background: rgba(9, 11, 18, 0.62); }
  .view {
    position: absolute; z-index: 1; overflow-x: hidden; overflow-y: hidden; overscroll-behavior: contain;
    background: #12141c; border-radius: 3px; scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.28) transparent;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.28), 0 18px 50px rgba(0, 0, 0, 0.55);
  }
  .view.scrolls { overflow-y: auto; }
  .stage { position: relative; line-height: 0; cursor: crosshair; touch-action: none; }
  .stage.text-tool { cursor: text; }
  .stage.number-tool { cursor: pointer; }
  .stage.over-mark { cursor: grab; }
  .stage.moving-mark { cursor: grabbing; }
  .stage canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
  .panel {
    position: absolute; background: rgba(27, 31, 43, 0.97); border: 1px solid rgba(255, 255, 255, 0.11);
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
  }
  .label {
    display: flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 8px; z-index: 2;
    font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; pointer-events: none;
  }
  .label.inside { background: rgba(15, 18, 27, 0.8); }
  .palette {
    display: flex; flex-direction: column; align-items: center; gap: 3px; width: 52px; padding: 6px; border-radius: 15px;
    max-height: calc(100vh - 16px); overflow: visible; z-index: 20;
  }
  .sep { width: 26px; height: 1px; margin: 4px 0; background: rgba(255, 255, 255, 0.12); flex: none; }
  button { font: inherit; color: inherit; cursor: pointer; overflow: visible; }
  button:focus-visible, input:focus-visible { outline: 2px solid #8f80ff; outline-offset: 1px; }
  .tool {
    position: relative; flex: none; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 10px;
    background: transparent; color: #b4bbd0; transition: background 0.12s, color 0.12s;
  }
  .tool:hover:not(:disabled) { background: rgba(255, 255, 255, 0.09); color: #fff; z-index: 4; }
  .tool:disabled { opacity: 0.35; cursor: default; }
  .tool[aria-pressed="true"] { background: linear-gradient(135deg, #7c6cf6, #4f8cff); color: #fff; box-shadow: 0 3px 10px rgba(91, 100, 240, 0.45); }
  .swatch-dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.85); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4); }
  .actions { display: flex; align-items: center; gap: 6px; height: 46px; padding: 6px; border-radius: 14px; overflow: visible; z-index: 20; }
  .tool-wrap, .act-wrap { position: relative; flex: none; overflow: visible; }
  .tool-wrap { display: grid; place-items: center; width: 38px; height: 38px; }
  .act-wrap { display: inline-flex; align-items: center; }
  .act {
    position: relative; display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 13px; border: 0; border-radius: 10px;
    background: rgba(255, 255, 255, 0.09); color: #f1f3fa; font-weight: 600; font-size: 12.5px; white-space: nowrap;
    transition: background 0.12s, filter 0.12s;
  }
  .act:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); }
  .act:disabled { opacity: 0.55; cursor: default; }
  .act.primary { background: linear-gradient(135deg, #7c6cf6, #4f8cff); color: #fff; }
  .act.primary:hover:not(:disabled) { filter: brightness(1.1); background: linear-gradient(135deg, #7c6cf6, #4f8cff); }
  .act.icon-only { width: 34px; padding: 0; justify-content: center; }
  .bar-sep { width: 1px; height: 22px; background: rgba(255, 255, 255, 0.14); margin: 0 2px; }
  .pop { display: grid; gap: 12px; width: 204px; padding: 12px; border-radius: 14px; z-index: 3; }
  .pop-title { margin: 0 0 6px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #8d95ab; }
  .colors { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; padding: 2px; }
  .color {
    width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 2px solid transparent; background-clip: padding-box;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22) inset; transition: transform 0.12s, box-shadow 0.12s, border-color 0.12s;
  }
  .color[aria-pressed="true"] {
    border-color: #fff; transform: scale(1.08);
    box-shadow: 0 0 0 2px #7c6cf6, 0 0 0 4px rgba(124, 108, 246, 0.28);
  }
  .custom { position: relative; overflow: hidden; background: conic-gradient(#f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e); }
  .custom input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .widths { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .width {
    display: grid; place-items: center; height: 34px; padding: 0; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 9px; background: transparent;
  }
  .width i { display: block; width: 26px; border-radius: 99px; background: #dfe3f1; }
  .width[aria-pressed="true"] { border-color: #8f80ff; background: rgba(124, 108, 246, 0.2); }
  .toast {
    position: absolute; top: 18px; left: 50%; transform: translateX(-50%); z-index: 5; display: flex; align-items: center; gap: 8px;
    max-width: calc(100vw - 32px); padding: 10px 15px; border-radius: 12px; font-weight: 600; font-size: 12.5px;
    animation: pop-in 0.18s ease-out;
  }
  .toast svg { flex: none; color: #43c59e; }
  .toast[data-tone="error"] svg { color: #f2687a; }
  .toast span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @keyframes pop-in { from { opacity: 0; transform: translate(-50%, -6px); } }
  .dialog-wrap { position: absolute; inset: 0; z-index: 6; display: grid; place-items: center; background: rgba(5, 6, 12, 0.45); }
  .dialog { position: static; width: min(340px, calc(100vw - 32px)); padding: 18px; border-radius: 16px; }
  .dialog h2 { margin: 0 0 5px; font-size: 15px; }
  .dialog p { margin: 0 0 16px; color: #aab1c5; }
  .dialog .row { display: flex; justify-content: flex-end; gap: 8px; }
  .text-input {
    position: absolute; z-index: 2; margin: 0; padding: 0; border: 1px dashed #8f80ff; border-radius: 2px; outline: none; resize: none;
    background: rgba(255, 255, 255, 0.06); overflow: hidden; white-space: pre; field-sizing: content; min-width: 3ch;
    font-weight: 600; line-height: ${TEXT_LINE_HEIGHT}; user-select: text;
  }
  .hl-ring { position: absolute; width: 0; height: 0; z-index: 4; pointer-events: none; }
  .hl-swatch {
    position: absolute; width: 30px; height: 30px; padding: 0; border: 2px solid #fff; border-radius: 50%;
    pointer-events: auto; cursor: pointer; transform: translate(-50%, -50%); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  }
  .hl-swatch[data-on="true"] { box-shadow: 0 0 0 3px #1b1f2b, 0 4px 14px rgba(0, 0, 0, 0.35); }
  .hl-swatch:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .tip-text {
    position: absolute; z-index: 50; display: none; padding: 7px 10px; border-radius: 9px;
    background: #11141c; color: #f4f6ff; border: 1px solid rgba(255, 255, 255, 0.16);
    font: 650 12px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    white-space: pre; width: max-content; max-width: 240px; pointer-events: none;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  }
  .tool-wrap:hover > .tip-text, .act-wrap:hover > .tip-text,
  .tool-wrap:focus-within > .tip-text, .act-wrap:focus-within > .tip-text { display: block; }
  .palette .tip-text { right: calc(100% + 8px); top: 50%; transform: translateY(-50%); }
  .palette[data-side="left"] .tip-text { right: auto; left: calc(100% + 8px); transform: translateY(-50%); }
  .actions .tip-text { left: 50%; right: auto; top: auto; bottom: calc(100% + 8px); transform: translateX(-50%); white-space: nowrap; }
  .tip {
    position: absolute; z-index: 40; display: none; padding: 7px 10px; border-radius: 9px; pointer-events: none;
    background: #11141c; color: #f4f6ff; border: 1px solid rgba(255, 255, 255, 0.16);
    font: 650 12px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    white-space: pre-wrap; width: max-content; max-width: min(260px, calc(100vw - 16px));
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  }
  .tip.is-on { display: block; }
`;

/** Copy a picture to the clipboard. Throws when the page does not allow it. */
export async function copyImageToClipboard(blob) {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return;
  }
  throw new Error('The clipboard is not available on this page.');
}

/** Save a picture through the browser's download. */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.documentElement.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Open the editor.
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas the captured picture (the editor takes it over)
 * @param {number} [options.pixelRatio] picture pixels per CSS pixel of the page
 * @param {'area'|'fit'|'scroll'} [options.mode] how to place the picture (see layoutEditor)
 * @param {{x:number,y:number,w:number,h:number}} [options.rect] the selected area, for mode "area"
 * @param {string} [options.language] 'en' | 'ja'
 * @param {string} [options.pageUrl] used for the file name
 * @param {() => void} [options.onClose]
 * @param {'closed'|'open'} [options.shadowMode] 'open' only in tests
 * @param {{ copyImage?: Function, download?: Function }} [options.deps] replaced in tests
 */
export function openEditor(options) {
  const { canvas, pixelRatio = 1, mode = 'fit', pageUrl = '', onClose = () => {}, shadowMode = 'closed', deps = {} } = options;
  let rect = options.rect ? { x: options.rect.x, y: options.rect.y, w: options.rect.w, h: options.rect.h } : null;
  const language = normalizeLanguage(options.language);
  const tr = (text) => translate(text, language);
  const copyImage = deps.copyImage || copyImageToClipboard;
  const download = deps.download || downloadBlob;

  const W = canvas.width;
  const H = canvas.height;
  const cssSize = { w: W / pixelRatio, h: H / pixelRatio };

  /* ----------------------------------------------------------- State */
  const state = {
    tool: 'arrow',
    color: COLORS[0],
    width: 'medium',
    annotations: [],
    history: [],
    redo: [],
    selected: -1,
    draft: null, // what is being drawn right now
    pending: null, // highlight box waiting for a colour
    highlightColor: HIGHLIGHT_COLORS[0].id,
    textInput: null,
    closed: false,
    busy: false,
  };
  const widthOf = () => WIDTHS.find((item) => item.id === state.width) || WIDTHS[1];
  const lineWidth = () => widthOf().px * pixelRatio;
  const textSize = () => widthOf().text * pixelRatio;

  /* ------------------------------------------------------------- DOM */
  const host = document.createElement('div');
  host.id = EDITOR_HOST_ID;
  host.tabIndex = -1;
  host.setAttribute('autofocus', '');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: shadowMode });
  adoptCss(shadow, CSS); // adopted sheets are not blocked by a page's style-src policy

  // The drawing layer (lighter than the picture when the picture is huge).
  const layerScale = Math.min(1, Math.sqrt(MAX_LAYER_PIXELS / (W * H)));
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.round(W * layerScale));
  layer.height = Math.max(1, Math.round(H * layerScale));
  const layerCtx = layer.getContext('2d');

  const ring = node('div', { class: 'hl-ring', hidden: true, role: 'toolbar', 'aria-label': tr('Highlight colour') });
  for (const item of HIGHLIGHT_COLORS) {
    const offset = swatchOffset(HIGHLIGHT_COLORS.indexOf(item));
    const swatch = node('button', {
      class: 'hl-swatch',
      type: 'button',
      title: tr(item.label),
      'aria-label': tr(item.label),
      'data-color': item.id,
      onPointerDown: (event) => {
        event.preventDefault();
        event.stopPropagation();
        pickHighlight(item.id);
      },
    });
    swatch.style.background = item.hex;
    swatch.style.left = `${offset.x}px`;
    swatch.style.top = `${offset.y}px`;
    ring.append(swatch);
  }
  const stage = node('div', { class: 'stage' }, canvas, layer, ring);
  const view = node('div', { class: 'view' }, stage);
  const label = node('div', { class: 'panel label' }, `${W} × ${H}`);
  const toolButtons = new Map();
  const palette = node('div', { class: 'panel palette', role: 'toolbar', 'aria-label': tr('Drawing tools') });
  const actions = node('div', { class: 'panel actions', role: 'toolbar', 'aria-label': tr('Screenshot actions') });
  const tip = node('div', { class: 'tip', hidden: true, role: 'tooltip' });
  const root = node('div', { class: 'root', tabindex: '-1', autofocus: '', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('Screenshot editor') }, node('div', { class: 'backdrop' }), view, label, palette, actions, tip);
  shadow.append(root);

  function hideTip() {
    tip.hidden = true;
    tip.classList.remove('is-on');
    tip.style.display = 'none';
  }
  function showTip(anchor, text) {
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    tip.classList.add('is-on');
    tip.style.cssText = [
      'position:absolute',
      'z-index:40',
      'display:block',
      'padding:7px 10px',
      'border-radius:9px',
      'pointer-events:none',
      'background:#11141c',
      'color:#f4f6ff',
      'border:1px solid rgba(255,255,255,0.16)',
      'font:650 12px/1.35 ui-sans-serif,system-ui,sans-serif',
      'white-space:pre-wrap',
      'width:max-content',
      'max-width:min(260px, calc(100vw - 16px))',
      'box-shadow:0 10px 28px rgba(0,0,0,0.45)',
    ].join(';');
    const pad = 8;
    const origin = root.getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    let left;
    let top;
    if (palette.contains(anchor)) {
      left = box.left - size.width - pad;
      top = box.top + (box.height - size.height) / 2;
      if (left < origin.left + pad) left = box.right + pad;
    } else {
      left = box.left + (box.width - size.width) / 2;
      top = box.top - size.height - pad;
      if (top < origin.top + pad) top = box.bottom + pad;
    }
    const maxLeft = origin.left + origin.width - size.width - pad;
    const maxTop = origin.top + origin.height - size.height - pad;
    tip.style.left = `${Math.max(pad, Math.min(maxLeft, left)) - origin.left}px`;
    tip.style.top = `${Math.max(pad, Math.min(maxTop, top)) - origin.top}px`;
  }
  function activateEditor() {
    if (state.closed || state.textInput) return;
    const active = shadow.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.closest?.('.dialog-wrap'))) return;
    try {
      window.focus();
    } catch {
      /* the tab may not be allowed to take focus */
    }
    host.focus({ preventScroll: true });
    if (!shadow.activeElement) root.focus({ preventScroll: true });
  }
  function tipFromEvent(event) {
    for (const node of event.composedPath()) {
      if (node?.getAttribute?.('data-tip')) return node;
    }
    return null;
  }
  function onPointerMove(event) {
    activateEditor();
    const hit = tipFromEvent(event);
    if (hit) showTip(hit, hit.getAttribute('data-tip'));
    else hideTip();
  }
  function withTip(element, text) {
    element.setAttribute('data-tip', text);
    const wrap = node('div', { class: element.classList.contains('act') ? 'act-wrap' : 'tool-wrap' });
    wrap.append(element, node('span', { class: 'tip-text' }, text));
    const show = () => showTip(element, text);
    wrap.addEventListener('pointerenter', show);
    wrap.addEventListener('pointerover', show);
    wrap.addEventListener('mouseenter', show);
    wrap.addEventListener('pointerleave', hideTip);
    wrap.addEventListener('mouseleave', hideTip);
    element.addEventListener('pointerenter', show);
    element.addEventListener('mouseenter', show);
    element.addEventListener('pointerleave', hideTip);
    element.addEventListener('focus', show);
    element.addEventListener('blur', hideTip);
    return wrap;
  }

  for (const tool of TOOLS) {
    const text = `${tr(tool.label)} (${tool.key.toUpperCase()})${tool.hint ? `\n${tr(tool.hint)}` : ''}`;
    const button = node('button', { class: 'tool', type: 'button', 'aria-label': tr(tool.label), 'aria-pressed': 'false', onClick: () => setTool(tool.id) }, createIcon(tool.id, 19));
    toolButtons.set(tool.id, button);
    palette.append(withTip(button, text));
  }
  const swatchDot = node('span', { class: 'swatch-dot' });
  const styleButton = node('button', { class: 'tool', type: 'button', 'aria-label': tr('Color and thickness'), 'aria-haspopup': 'true', 'aria-expanded': 'false', onClick: () => togglePopover() }, swatchDot);
  const undoButton = node('button', { class: 'tool', type: 'button', 'aria-label': tr('Undo'), onClick: () => undo() }, createIcon('undo', 19));
  const redoButton = node('button', { class: 'tool', type: 'button', 'aria-label': tr('Redo'), onClick: () => redo() }, createIcon('redo', 19));
  palette.append(
    node('div', { class: 'sep' }),
    withTip(styleButton, tr('Color and thickness')),
    node('div', { class: 'sep' }),
    withTip(undoButton, `${tr('Undo')} (⌘Z / Ctrl+Z)`),
    withTip(redoButton, `${tr('Redo')} (⌘⇧Z / Ctrl+Shift+Z)`),
  );

  const copyButton = node('button', { class: 'act', type: 'button', onClick: () => copy() }, createIcon('copy', 16), tr('Copy'));
  const saveButton = node('button', { class: 'act primary', type: 'button', onClick: () => save() }, createIcon('save', 16), tr('Save'));
  const closeButton = node('button', { class: 'act icon-only', type: 'button', 'aria-label': tr('Close'), onClick: () => requestClose() }, createIcon('close', 17));
  actions.append(
    withTip(copyButton, `${tr('Copy')} (⌘C / Ctrl+C)`),
    withTip(saveButton, `${tr('Save')} (⌘S / Ctrl+S)`),
    node('span', { class: 'bar-sep' }),
    withTip(closeButton, `${tr('Close')} (Esc)`),
  );

  /* ------------------------------------------------------------ Layout */
  function applyLayout() {
    const viewport = { w: root.clientWidth || window.innerWidth, h: root.clientHeight || window.innerHeight };
    const measure = (element, fallback) => ({ w: element.offsetWidth || fallback.w, h: element.offsetHeight || fallback.h });
    const plan = layoutEditor({
      viewport,
      image: cssSize,
      mode,
      rect,
      palette: measure(palette, LAYOUT.palette),
      actions: measure(actions, LAYOUT.actions),
    });
    stage.style.width = `${plan.stage.w}px`;
    stage.style.height = `${plan.stage.h}px`;
    Object.assign(view.style, { left: `${plan.view.left}px`, top: `${plan.view.top}px`, width: `${plan.view.w}px`, height: `${plan.view.h}px` });
    view.classList.toggle('scrolls', plan.view.scrolls);
    Object.assign(palette.style, { left: `${plan.palette.left}px`, top: `${plan.palette.top}px` });
    Object.assign(actions.style, { left: `${plan.actions.left}px`, top: `${plan.actions.top}px` });
    Object.assign(label.style, { left: `${plan.label.left}px`, top: `${plan.label.top}px` });
    label.classList.toggle('inside', plan.label.inside);
    paletteOnRight = plan.palette.left >= plan.view.left + plan.view.w;
    palette.dataset.side = paletteOnRight ? 'right' : 'left';
    if (popover) placePopover();
    if (state.pending) placeRing(state.pending);
    return plan;
  }
  let paletteOnRight = true;

  /* ----------------------------------------------------------- Drawing */
  let frame = 0;
  function redraw() {
    frame = 0;
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.clearRect(0, 0, layer.width, layer.height);
    layerCtx.setTransform(layerScale, 0, 0, layerScale, 0, 0);
    drawAnnotations(layerCtx, state.annotations, canvas);
    if (state.draft) drawAnnotation(layerCtx, state.draft, canvas);
    else if (state.selected >= 0 && state.annotations[state.selected]) drawSelection(layerCtx, state.annotations[state.selected]);
  }
  const scheduleRedraw = () => {
    if (!frame) frame = requestAnimationFrame(redraw);
  };

  function refreshButtons() {
    for (const [id, button] of toolButtons) button.setAttribute('aria-pressed', String(id === state.tool));
    stage.classList.toggle('text-tool', state.tool === 'text');
    stage.classList.toggle('number-tool', state.tool === 'number');
    swatchDot.style.background = state.color;
    undoButton.disabled = state.history.length === 0;
    redoButton.disabled = state.redo.length === 0;
  }

  function highlightStyle() {
    return { color: colorById(state.highlightColor).hex, width: lineWidth() };
  }

  function hideRing() {
    ring.hidden = true;
  }

  function placeRing(box) {
    const shown = (stage.clientWidth || 1) / W;
    const display = { x: box.x * shown, y: box.y * shown, w: box.w * shown, h: box.h * shown };
    const center = placeRingCenter(display, { w: stage.clientWidth || display.w, h: stage.clientHeight || display.h });
    ring.style.left = `${center.x}px`;
    ring.style.top = `${center.y}px`;
    ring.hidden = false;
    for (const swatch of ring.querySelectorAll('.hl-swatch')) {
      swatch.setAttribute('data-on', swatch.getAttribute('data-color') === state.highlightColor ? 'true' : 'false');
    }
  }

  function cancelPending() {
    if (!state.pending) return;
    state.pending = null;
    state.draft = null;
    hideRing();
    scheduleRedraw();
  }

  function pickHighlight(id) {
    const pending = state.pending;
    if (!pending) return;
    state.highlightColor = sanitizeHighlightColor(id);
    state.pending = null;
    hideRing();
    commit({ ...pending, type: 'highlight', color: colorById(state.highlightColor).hex });
  }

  function setTool(id) {
    if (!toolButtons.has(id)) return;
    commitText();
    cancelPending();
    state.tool = id;
    state.selected = -1;
    refreshButtons();
    scheduleRedraw();
  }
  function setColor(color) {
    const next = normalizeHex(color);
    if (!next) return;
    state.color = next;
    if (state.textInput) state.textInput.element.style.color = next;
    refreshButtons();
    syncPopover();
  }
  function setWidth(id) {
    if (!WIDTHS.some((item) => item.id === id)) return;
    state.width = id;
    refreshButtons();
    syncPopover();
  }

  function commit(annotation) {
    if (!annotation || !isVisible(annotation)) return;
    state.annotations.push(annotation);
    state.history.push({ type: 'add', annotation });
    state.redo = [];
    state.selected = state.annotations.length - 1;
    refreshButtons();
    scheduleRedraw();
  }
  function undo() {
    commitText();
    const op = state.history.pop();
    if (!op) return;
    if (op.type === 'add') {
      state.annotations.pop();
      state.selected = state.annotations.length - 1;
    } else {
      state.annotations[op.index] = op.before;
      state.selected = op.index;
    }
    state.redo.push(op);
    refreshButtons();
    scheduleRedraw();
  }
  function redo() {
    const op = state.redo.pop();
    if (!op) return;
    if (op.type === 'add') {
      state.annotations.push(op.annotation);
      state.selected = state.annotations.length - 1;
    } else {
      state.annotations[op.index] = op.after;
      state.selected = op.index;
    }
    state.history.push(op);
    refreshButtons();
    scheduleRedraw();
  }

  /** Pointer position in the picture's own pixels. */
  function toImage(event) {
    const box = stage.getBoundingClientRect();
    return clampPoint({ x: ((event.clientX - box.left) * W) / box.width, y: ((event.clientY - box.top) * H) / box.height }, W, H);
  }

  let start = null;
  let dragMark = null;

  function capturePointer(event) {
    try {
      stage.setPointerCapture(event.pointerId); // keeps the stroke going when the pointer leaves the picture
    } catch {
      /* not an active pointer: the stroke still works inside the picture */
    }
  }
  function releasePointer(event) {
    try {
      if (event && stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  }

  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || state.closed) return;
    closePopover();
    if (event.target.closest?.('.hl-ring')) return;
    if (state.textInput) {
      commitText(); // the click that ends a text only ends it
      event.preventDefault();
      return;
    }
    cancelPending();
    const point = toImage(event);
    const hit = hitTopAnnotation(state.annotations, point, state.selected);
    if (hit >= 0) {
      event.preventDefault();
      state.selected = hit;
      dragMark = { index: hit, start: point, before: structuredClone(state.annotations[hit]) };
      stage.classList.add('moving-mark');
      capturePointer(event);
      scheduleRedraw();
      return;
    }
    state.selected = -1;
    if (state.tool === 'text') {
      event.preventDefault();
      beginText(point);
      scheduleRedraw();
      return;
    }
    if (state.tool === 'number') {
      event.preventDefault();
      commit(buildNumberMark(point, state.annotations, { color: state.color, width: lineWidth() }));
      return;
    }
    capturePointer(event);
    start = point;
    const style = state.tool === 'highlight' ? highlightStyle() : { color: state.color, width: lineWidth() };
    state.draft = state.tool === 'pen' ? { type: 'pen', points: [point], ...style } : null;
    scheduleRedraw();
  });
  stage.addEventListener('pointermove', (event) => {
    const point = toImage(event);
    if (dragMark) {
      state.annotations[dragMark.index] = translateAnnotation(dragMark.before, point.x - dragMark.start.x, point.y - dragMark.start.y);
      scheduleRedraw();
      return;
    }
    if (!start) {
      stage.classList.toggle('over-mark', hitTopAnnotation(state.annotations, point, state.selected) >= 0);
      return;
    }
    const style = state.tool === 'highlight' ? highlightStyle() : { color: state.color, width: lineWidth() };
    if (state.tool === 'pen') {
      const points = state.draft.points;
      const previous = points[points.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 1.5) points.push(point);
    } else {
      state.draft = buildShape(state.tool, start, point, style, { constrain: event.shiftKey });
    }
    scheduleRedraw();
  });
  const finishMove = (event, keep) => {
    if (!dragMark) return false;
    releasePointer(event);
    const { index, before } = dragMark;
    const after = state.annotations[index];
    dragMark = null;
    stage.classList.remove('moving-mark');
    if (!keep || JSON.stringify(before) === JSON.stringify(after)) {
      state.annotations[index] = before;
    } else {
      state.history.push({ type: 'move', index, before, after });
      state.redo = [];
    }
    refreshButtons();
    scheduleRedraw();
    return true;
  };
  const finishStroke = (event, keep) => {
    if (finishMove(event, keep)) return;
    if (!start) return;
    releasePointer(event);
    const finished = state.draft;
    start = null;
    state.draft = null;
    if (keep && finished && finished.type === 'highlight') {
      state.pending = finished;
      state.draft = finished;
      placeRing(finished);
      scheduleRedraw();
      return;
    }
    if (keep && finished) commit(finished);
    else scheduleRedraw();
  };
  stage.addEventListener('pointerup', (event) => finishStroke(event, true));
  stage.addEventListener('pointercancel', (event) => finishStroke(event, false));

  /* -------------------------------------------------------------- Text */
  function beginText(point) {
    const box = stage.getBoundingClientRect();
    const shown = box.width / W; // display pixels per picture pixel
    const size = textSize();
    const element = node('textarea', { class: 'text-input', rows: '1', spellcheck: 'false', 'aria-label': tr('Text'), wrap: 'off' });
    Object.assign(element.style, {
      left: `${point.x * shown}px`,
      top: `${point.y * shown}px`,
      color: state.color,
      fontSize: `${size * shown}px`,
      fontFamily: TEXT_FONT,
    });
    element.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        commitText();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelText();
      }
    });
    element.addEventListener('blur', () => commitText());
    state.textInput = { element, point, size };
    stage.append(element);
    element.focus();
  }
  function endText() {
    const input = state.textInput;
    state.textInput = null;
    input?.element.remove();
    return input;
  }
  function commitText() {
    const input = state.textInput;
    if (!input) return;
    const text = input.element.value.replace(/\s+$/g, '');
    endText();
    if (text) commit({ type: 'text', x: input.point.x, y: input.point.y, text, color: state.color, size: input.size });
    root.focus({ preventScroll: true });
  }
  function cancelText() {
    endText();
    root.focus({ preventScroll: true });
  }

  /* ---------------------------------------------- Colour and thickness */
  let popover = null;
  let popoverButtons = null;

  function buildPopover() {
    const colorButtons = COLORS.map((color) => {
      const button = node('button', { class: 'color', type: 'button', title: color, 'aria-label': color, 'aria-pressed': 'false', onClick: () => setColor(color) });
      button.style.backgroundColor = color;
      return button;
    });
    const picker = node('input', { type: 'color', 'aria-label': tr('Custom color'), value: state.color });
    picker.addEventListener('input', () => setColor(picker.value));
    const custom = node('span', { class: 'color custom', title: tr('Custom color'), 'aria-pressed': 'false' }, picker);
    const widthButtons = WIDTHS.map((item) => {
      const bar = node('i');
      bar.style.height = `${item.px}px`;
      return node('button', { class: 'width', type: 'button', title: tr(item.label), 'aria-label': tr(item.label), 'aria-pressed': 'false', onClick: () => setWidth(item.id) }, bar);
    });
    popoverButtons = { colorButtons, widthButtons, custom, picker };
    return node(
      'div',
      { class: 'panel pop', role: 'group', 'aria-label': tr('Color and thickness') },
      node('div', {}, node('p', { class: 'pop-title' }, tr('Color')), node('div', { class: 'colors' }, colorButtons, custom)),
      node('div', {}, node('p', { class: 'pop-title' }, tr('Thickness')), node('div', { class: 'widths' }, widthButtons)),
    );
  }
  function syncPopover() {
    if (!popoverButtons) return;
    let matched = false;
    popoverButtons.colorButtons.forEach((button, index) => {
      const on = COLORS[index] === state.color;
      button.setAttribute('aria-pressed', String(on));
      if (on) matched = true;
    });
    if (popoverButtons.custom) popoverButtons.custom.setAttribute('aria-pressed', String(!matched));
    if (popoverButtons.picker && /^#[0-9a-f]{6}$/i.test(state.color)) popoverButtons.picker.value = state.color;
    popoverButtons.widthButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(WIDTHS[index].id === state.width)));
  }
  function placePopover() {
    const anchor = styleButton.getBoundingClientRect();
    const width = popover.offsetWidth || 204;
    const height = popover.offsetHeight || 150;
    const left = paletteOnRight ? anchor.left - 8 - width : anchor.right + 8;
    popover.style.left = `${Math.max(4, Math.min(root.clientWidth - width - 4, left))}px`;
    popover.style.top = `${Math.max(4, Math.min(root.clientHeight - height - 4, anchor.top))}px`;
  }
  function togglePopover() {
    if (popover) return closePopover();
    popover = buildPopover();
    root.append(popover);
    styleButton.setAttribute('aria-expanded', 'true');
    syncPopover();
    placePopover();
    return undefined;
  }
  function closePopover() {
    if (!popover) return;
    popover.remove();
    popover = null;
    popoverButtons = null;
    styleButton.setAttribute('aria-expanded', 'false');
  }
  root.addEventListener('pointerdown', (event) => {
    if (popover && !event.composedPath().includes(popover) && !event.composedPath().includes(styleButton)) closePopover();
  });

  /* ---------------------------------------------------- Copy and save */
  let toastTimer = 0;
  function toast(message, tone = 'ok', duration = TOAST_MS) {
    shadow.querySelector('.toast')?.remove();
    clearTimeout(toastTimer);
    const element = node('div', { class: 'panel toast', role: 'status', 'data-tone': tone }, createIcon(tone === 'error' ? 'alert' : 'check', 17), node('span', {}, message));
    root.append(element);
    toastTimer = setTimeout(() => element.remove(), duration);
  }

  /** The picture with every annotation painted on it, at full size. */
  function exportCanvas() {
    commitText();
    if (state.pending) pickHighlight(state.highlightColor);
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    drawAnnotations(ctx, state.annotations, canvas);
    return out;
  }
  function exportBlob() {
    const out = exportCanvas();
    return new Promise((resolve, reject) => {
      out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be encoded.'))), 'image/png');
    });
  }

  async function withBusy(task) {
    if (state.busy || state.closed) return;
    state.busy = true;
    copyButton.disabled = true;
    saveButton.disabled = true;
    try {
      await task();
    } finally {
      state.busy = false;
      if (!state.closed) {
        copyButton.disabled = false;
        saveButton.disabled = false;
      }
    }
  }
  const copy = () =>
    withBusy(async () => {
      try {
        await copyImage(await exportBlob());
        close();
      } catch {
        toast(tr('Could not copy the picture. Use Save instead.'), 'error');
      }
    });
  const save = () =>
    withBusy(async () => {
      try {
        const name = screenshotFileName(pageUrl);
        await download(await exportBlob(), name);
        close();
      } catch {
        toast(tr('Could not save the picture.'), 'error');
      }
    });

  /* ------------------------------------------------------------- Close */
  let dialog = null;
  function closeDialog() {
    dialog?.remove();
    dialog = null;
    root.focus({ preventScroll: true });
  }
  function requestClose() {
    commitText();
    cancelPending();
    if (state.annotations.length === 0) return close();
    if (dialog) return undefined;
    const keep = node('button', { class: 'act', type: 'button', onClick: closeDialog }, tr('Keep editing'));
    const discard = node('button', { class: 'act primary', type: 'button', onClick: () => close() }, tr('Discard'));
    dialog = node(
      'div',
      { class: 'dialog-wrap' },
      node('div', { class: 'panel dialog', role: 'alertdialog', 'aria-label': tr('Discard this screenshot?') }, node('h2', {}, tr('Discard this screenshot?')), node('p', {}, tr('Your drawings will be lost. Save or copy the picture first to keep them.')), node('div', { class: 'row' }, keep, discard)),
    );
    root.append(dialog);
    keep.focus();
    return undefined;
  }

  function close() {
    if (state.closed) return;
    state.closed = true;
    cancelAnimationFrame(frame);
    clearTimeout(toastTimer);
    for (const [target, type, handler, capture] of keyBindings) target.removeEventListener(type, handler, capture);
    window.removeEventListener('resize', onResize);
    host.remove();
    onClose();
  }

  /* ---------------------------------------------------------- Keyboard */
  function commandLetter(event) {
    if (event.code && event.code.startsWith('Key') && event.code.length === 4) return event.code.slice(3).toLowerCase();
    const key = event.key || event.detail?.letter || '';
    return key.length === 1 ? key.toLowerCase() : '';
  }
  function runCopyOrSave(letter) {
    hideTip();
    if (letter === 's') save();
    else copy();
  }
  function onKey(event) {
    if (state.closed) return;
    if (event._witShotKey) return;
    event._witShotKey = true;
    const mod = event.ctrlKey || event.metaKey;
    const letter = commandLetter(event);
    if (mod && (letter === 's' || letter === 'c')) {
      stop(event);
      if (event.repeat) return;
      runCopyOrSave(letter);
      return;
    }
    if (state.textInput) return; // the text box handles its own keys
    if (event.key === 'Escape') {
      stop(event);
      if (dialog) closeDialog();
      else if (popover) closePopover();
      else if (state.pending) cancelPending();
      else requestClose();
      return;
    }
    if (dialog) {
      if (event.key === 'Tab') return;
      stop(event);
      return;
    }
    if (mod && letter === 'z') {
      stop(event);
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && letter === 'y') {
      stop(event);
      redo();
    } else if (!mod && !event.altKey && TOOLS.some((item) => item.key === letter)) {
      stop(event);
      setTool(TOOLS.find((item) => item.key === letter).id);
    } else {
      event.stopPropagation(); // keys typed here are not for the page behind
    }
  }
  function onBridgeKey(event) {
    if (state.closed) return;
    const letter = event.detail?.letter;
    if (letter === 's' || letter === 'c') runCopyOrSave(letter);
  }
  function onCopy(event) {
    if (state.closed || state.textInput) return;
    stop(event);
    copy();
  }
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };
  const onResize = () => applyLayout();
  const keyBindings = [
    [window, 'keydown', onKey, true],
    [document, 'keydown', onKey, true],
    [host, 'keydown', onKey, true],
    [root, 'keydown', onKey, true],
    [window, 'wit-screenshot-key', onBridgeKey, false],
    [window, 'copy', onCopy, true],
    [document, 'copy', onCopy, true],
  ];
  for (const [target, type, handler, capture] of keyBindings) target.addEventListener(type, handler, capture);
  window.addEventListener('resize', onResize);

  // Scrolling inside the editor must not scroll the page behind it.
  root.addEventListener(
    'wheel',
    (event) => {
      if (!(view.classList.contains('scrolls') && event.composedPath().includes(view))) event.preventDefault();
    },
    { passive: false },
  );

  /* -------------------------------------------------------------- Open */
  document.documentElement.append(host);
  refreshButtons();
  applyLayout();
  redraw();
  root.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerdown', activateEditor);
  activateEditor();

  return {
    host,
    shadow,
    size: { width: W, height: H },
    get annotations() {
      return state.annotations.map((item) => ({ ...item }));
    },
    get tool() {
      return state.tool;
    },
    get isClosed() {
      return state.closed;
    },
    setTool,
    setColor,
    setWidth,
    undo,
    redo,
    copy,
    save,
    exportBlob,
    notify: toast,
    relayout: applyLayout,
    requestClose,
    close,
  };
}
