/**
 * Screenshot Taker: the "Select Area" overlay.
 *
 * The page dims and the user drags a rectangle. After that the box stays on
 * the live page so they can drag it into place or pull a corner / edge to
 * resize it. The tool palette and the Copy / Save bar sit around the box and
 * move with it. The photo is taken only when they pick a tool, press Enter,
 * or use Copy / Save — of the box as it is then. Esc cancels. The overlay
 * removes itself before the photo.
 */

import { normalizeLanguage, translate } from '../services/i18n.js';
import { TOOLS } from '../services/screenshot-draw.js';
import { LAYOUT, MIN_SELECTION, clampPoint, moveRect, placeChrome, rectFromPoints, resizeRect } from '../services/screenshot-geometry.js';
import { createIcon } from './screenshot-icons.js';
import { adoptCss, node } from './screenshot-ui.js';

export const SELECTOR_HOST_ID = 'wit-screenshot-selector';

const CSS = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  .root {
    position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; touch-action: none; user-select: none; outline: none;
    font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;
    color: #e9ecf5; color-scheme: dark;
  }
  .root.ready { cursor: default; }
  .dim { position: absolute; inset: 0; background: rgba(9, 11, 18, 0.5); }
  .box {
    position: absolute; display: none; border: 1.5px solid #8f80ff; border-radius: 1px;
    box-shadow: 0 0 0 100vmax rgba(9, 11, 18, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.55) inset;
  }
  .root.ready .box { cursor: grab; }
  .root.ready .box:active { cursor: grabbing; }
  .handle {
    position: absolute; display: none; width: 10px; height: 10px; z-index: 2;
    background: #fff; border: 1.5px solid #8f80ff; border-radius: 1px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.28);
  }
  .handle::before { content: ""; position: absolute; inset: -7px; }
  .root.ready .handle { display: block; }
  .handle.nw { left: 0; top: 0; cursor: nwse-resize; transform: translate(-50%, -50%); }
  .handle.n  { left: 50%; top: 0; cursor: ns-resize; transform: translate(-50%, -50%); }
  .handle.ne { left: 100%; top: 0; cursor: nesw-resize; transform: translate(-50%, -50%); }
  .handle.e  { left: 100%; top: 50%; cursor: ew-resize; transform: translate(-50%, -50%); }
  .handle.se { left: 100%; top: 100%; cursor: nwse-resize; transform: translate(-50%, -50%); }
  .handle.s  { left: 50%; top: 100%; cursor: ns-resize; transform: translate(-50%, -50%); }
  .handle.sw { left: 0; top: 100%; cursor: nesw-resize; transform: translate(-50%, -50%); }
  .handle.w  { left: 0; top: 50%; cursor: ew-resize; transform: translate(-50%, -50%); }
  .size {
    position: absolute; display: none; padding: 4px 8px; border-radius: 7px; color: #fff; pointer-events: none; white-space: nowrap;
    background: rgba(27, 31, 43, 0.95); border: 1px solid rgba(255, 255, 255, 0.14);
    font: 600 11.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums;
  }
  .hint {
    position: absolute; top: 18px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
    padding: 9px 15px; border-radius: 12px; color: #e9ecf5; background: rgba(27, 31, 43, 0.96); border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4); font-weight: 600; font-size: 12.5px; pointer-events: none; transition: opacity 0.15s;
  }
  .hint kbd {
    padding: 2px 6px; border-radius: 5px; background: rgba(255, 255, 255, 0.12); font: 600 11px/1.3 ui-monospace, Menlo, monospace;
  }
  .hint.hidden { opacity: 0; }
  .panel {
    position: absolute; display: none; background: rgba(27, 31, 43, 0.97); border: 1px solid rgba(255, 255, 255, 0.11);
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
  }
  .root.ready .panel { display: flex; }
  .palette {
    flex-direction: column; align-items: center; gap: 3px; width: 52px; padding: 6px; border-radius: 15px;
    max-height: calc(100vh - 16px); overflow: auto; scrollbar-width: none;
  }
  .actions { align-items: center; gap: 6px; height: 46px; padding: 6px; border-radius: 14px; }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:focus-visible { outline: 2px solid #8f80ff; outline-offset: 1px; }
  .tool {
    flex: none; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 10px;
    background: transparent; color: #b4bbd0;
  }
  .tool:hover { background: rgba(255, 255, 255, 0.09); color: #fff; }
  .act {
    display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 13px; border: 0; border-radius: 10px;
    background: rgba(255, 255, 255, 0.09); color: #f1f3fa; font-weight: 600; font-size: 12.5px; white-space: nowrap;
  }
  .act:hover { background: rgba(255, 255, 255, 0.16); }
  .act.primary { background: linear-gradient(135deg, #7c6cf6, #4f8cff); color: #fff; }
  .act.icon-only { width: 34px; padding: 0; justify-content: center; }
  .bar-sep { width: 1px; height: 22px; background: rgba(255, 255, 255, 0.14); margin: 0 2px; }
`;

const HANDLES = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
const hit = (rect, x, y) => x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h;
const handleOf = (event) => event.target.closest?.('[data-handle]')?.getAttribute('data-handle') || null;

/**
 * Let the user drag out an area, then slide it before the photo.
 * @returns {{ promise: Promise<{x:number,y:number,w:number,h:number, action?:string, tool?:string}|null>, cancel: () => void }}
 */
export function selectArea({ language, shadowMode = 'closed' } = {}) {
  const tr = (text) => translate(text, normalizeLanguage(language));
  let finish;
  const promise = new Promise((resolve) => {
    finish = resolve;
  });

  const host = document.createElement('div');
  host.id = SELECTOR_HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: shadowMode });
  adoptCss(shadow, CSS);

  const box = node('div', { class: 'box' }, ...HANDLES.map((name) => node('div', { class: `handle ${name}`, 'data-handle': name, title: tr('Drag to resize') })));
  const size = node('div', { class: 'size' });
  const hint = node('div', { class: 'hint' });
  const palette = node('div', { class: 'panel palette', role: 'toolbar', 'aria-label': tr('Drawing tools') });
  const actions = node('div', { class: 'panel actions', role: 'toolbar', 'aria-label': tr('Screenshot actions') });
  const root = node('div', { class: 'root', tabindex: '-1' }, node('div', { class: 'dim' }), box, size, hint, palette, actions);
  shadow.append(root);

  for (const tool of TOOLS) {
    const title = `${tr(tool.label)} (${tool.key.toUpperCase()})${tool.hint ? `\n${tr(tool.hint)}` : ''}`;
    palette.append(node('button', { class: 'tool', type: 'button', title, 'aria-label': tr(tool.label), onClick: () => confirm({ action: 'edit', tool: tool.id }) }, createIcon(tool.id, 19)));
  }
  actions.append(
    node('button', { class: 'act', type: 'button', title: tr('Copy to clipboard'), onClick: () => confirm({ action: 'copy' }) }, createIcon('copy', 16), tr('Copy')),
    node('button', { class: 'act primary', type: 'button', title: tr('Save as PNG'), onClick: () => confirm({ action: 'save' }) }, createIcon('save', 16), tr('Save')),
    node('span', { class: 'bar-sep' }),
    node('button', { class: 'act icon-only', type: 'button', title: tr('Close'), 'aria-label': tr('Close'), onClick: () => end(null) }, createIcon('close', 17)),
  );

  let start = null;
  let moving = null;
  let resizing = null;
  let rect = null;
  let ready = false;
  let done = false;

  function end(value) {
    if (done) return;
    done = true;
    window.removeEventListener('keydown', onKey, true);
    host.remove();
    finish(value);
  }

  function confirm(extra = {}) {
    if (!rect || rect.w < MIN_SELECTION || rect.h < MIN_SELECTION) return;
    end({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, ...extra });
  }

  function setHint(mode) {
    hint.replaceChildren();
    if (mode === 'move') {
      hint.append(tr('Drag the area to move it, or a handle to resize'), node('kbd', {}, 'Enter'), tr('to capture'), node('kbd', {}, 'Esc'), tr('to cancel'));
    } else {
      hint.append(tr('Drag to select an area'), node('kbd', {}, 'Esc'), tr('to cancel'));
    }
  }

  function placeBars() {
    if (!ready || !rect) return;
    const viewport = { w: root.clientWidth, h: root.clientHeight };
    const chrome = placeChrome(viewport, { left: rect.x, top: rect.y, w: rect.w, h: rect.h }, { w: palette.offsetWidth || LAYOUT.palette.w, h: palette.offsetHeight || LAYOUT.palette.h }, { w: actions.offsetWidth || LAYOUT.actions.w, h: actions.offsetHeight || LAYOUT.actions.h });
    Object.assign(palette.style, { left: `${chrome.palette.left}px`, top: `${chrome.palette.top}px` });
    Object.assign(actions.style, { left: `${chrome.actions.left}px`, top: `${chrome.actions.top}px` });
  }

  function draw(next) {
    rect = next;
    const visible = !!next && (next.w > 0 || next.h > 0);
    box.style.display = visible ? 'block' : 'none';
    size.style.display = visible ? 'block' : 'none';
    root.firstElementChild.style.display = visible ? 'none' : 'block';
    if (!visible) return;
    Object.assign(box.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.w}px`, height: `${next.h}px` });
    size.textContent = `${Math.round(next.w)} × ${Math.round(next.h)}`;
    const below = next.y + next.h + 8 + 24 <= root.clientHeight;
    Object.assign(size.style, {
      left: `${Math.max(4, Math.min(root.clientWidth - 90, next.x))}px`,
      top: `${below ? next.y + next.h + 8 : Math.max(4, next.y - 30)}px`,
    });
    if (ready) placeBars();
  }

  function setReady(on) {
    ready = on;
    root.classList.toggle('ready', on);
    setHint(on ? 'move' : 'draw');
    hint.classList.toggle('hidden', false);
    if (on) placeBars();
  }

  function onChrome(event) {
    return event.target.closest('.palette, .actions');
  }

  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || onChrome(event)) return;
    event.preventDefault();
    const point = clampPoint({ x: event.clientX, y: event.clientY }, root.clientWidth, root.clientHeight);
    const handle = handleOf(event);
    if (ready && rect && handle) {
      resizing = { handle, origin: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        /* not an active pointer */
      }
      return;
    }
    if (ready && rect && hit(rect, point.x, point.y)) {
      moving = { x: point.x, y: point.y, origin: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        /* not an active pointer */
      }
      return;
    }
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      /* not an active pointer */
    }
    setReady(false);
    start = point;
    hint.classList.add('hidden');
    draw(null);
  });
  root.addEventListener('pointermove', (event) => {
    const point = clampPoint({ x: event.clientX, y: event.clientY }, root.clientWidth, root.clientHeight);
    if (resizing) {
      draw(resizeRect(resizing.origin, resizing.handle, point, { min: MIN_SELECTION, bounds: { w: root.clientWidth, h: root.clientHeight } }));
      return;
    }
    if (moving) {
      draw(moveRect(moving.origin, point.x - moving.x, point.y - moving.y, { w: root.clientWidth, h: root.clientHeight }));
      return;
    }
    if (!start) return;
    draw(rectFromPoints(start, point));
  });
  root.addEventListener('pointerup', (event) => {
    try {
      root.releasePointerCapture?.(event.pointerId);
    } catch {
      /* already released */
    }
    if (resizing) {
      resizing = null;
      return;
    }
    if (moving) {
      moving = null;
      return;
    }
    if (!start) return;
    const point = clampPoint({ x: event.clientX, y: event.clientY }, root.clientWidth, root.clientHeight);
    draw(rectFromPoints(start, point));
    start = null;
    if (rect && rect.w >= MIN_SELECTION && rect.h >= MIN_SELECTION) {
      setReady(true);
    } else {
      draw(null);
      setHint('draw');
      hint.classList.remove('hidden');
    }
  });
  root.addEventListener('pointercancel', () => {
    start = null;
    moving = null;
    resizing = null;
    if (!ready) {
      draw(null);
      hint.classList.remove('hidden');
    }
  });
  root.addEventListener('contextmenu', (event) => event.preventDefault());
  root.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
  palette.addEventListener('pointerdown', (event) => event.stopPropagation());
  actions.addEventListener('pointerdown', (event) => event.stopPropagation());

  function onKey(event) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      end(null);
    } else if (ready && (event.key === 'Enter' || event.key === 'NumpadEnter')) {
      event.preventDefault();
      confirm({ action: 'edit' });
    }
  }
  window.addEventListener('keydown', onKey, true);

  setHint('draw');
  document.documentElement.append(host);
  root.focus({ preventScroll: true });

  return { promise, cancel: () => end(null) };
}
