/**
 * Layout Overflow Finder: live overlay of elements that stick out of the
 * viewport. Frames live in a closed shadow root — the page is never given
 * classes. Resize re-checks. Esc stops.
 */

import { MSG } from '../shared/constants.js';
import { broadcast } from '../services/message-service.js';
import { normalizeLanguage, translate } from '../services/i18n.js';
import { DEFAULT_OVERFLOW_SKIP_IDS, findOverflow, formatPx } from '../services/overflow-rules.js';
import { CONTEXT_ID, registerElement } from './element-registry.js';
import { createPathBuilder, getReadableSelector } from './element-info.js';

const HOST_ID = 'wit-overflow-finder';
const SKIP_IDS = new Set([...DEFAULT_OVERFLOW_SKIP_IDS, HOST_ID]);

const CSS_TEXT = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .frame {
    position: fixed; left: 0; top: 0; pointer-events: none; z-index: 2147483646;
    border: 2px solid #f2687a; background: rgba(242, 104, 122, 0.12);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.45), 0 0 0 4px rgba(242, 104, 122, 0.22);
    border-radius: 3px;
  }
  .frame.is-focus {
    border-color: #ffd36a; background: rgba(255, 211, 106, 0.16);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5), 0 0 0 5px rgba(255, 211, 106, 0.35);
  }
  .chip {
    position: absolute; left: -2px; top: -2px; transform: translateY(-100%);
    display: flex; align-items: center; gap: 6px;
    padding: 2px 7px; border-radius: 5px 5px 5px 0; white-space: nowrap;
    font: 700 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #fff; background: #c94b5f; font-variant-numeric: tabular-nums;
  }
  .chip.inside { transform: none; border-radius: 0 0 5px 0; }
  .frame.is-focus .chip { background: #c7922b; color: #1a1404; }
  .hud {
    position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
    z-index: 2147483647; pointer-events: none;
    display: flex; align-items: center; gap: 10px;
    max-width: min(520px, calc(100vw - 24px));
    padding: 8px 12px; border-radius: 999px;
    color: #f7e9eb; background: rgba(28, 16, 20, 0.94);
    border: 1px solid rgba(242, 104, 122, 0.55);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
    font: 650 12px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .hud.is-ok {
    color: #d7f5e8; border-color: rgba(67, 197, 158, 0.5);
    background: rgba(16, 32, 28, 0.94);
  }
  .hud b { font-weight: 800; font-variant-numeric: tabular-nums; }
  .hud small { color: #c9b4b8; font-weight: 500; }
  .hud.is-ok small { color: #9dcebb; }
`;

let session = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function buildHost() {
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  const layer = node('div', 'layer');
  const hud = node('div', 'hud');
  shadow.append(style, layer, hud);
  return { host, layer, hud };
}

function serializeItem(entry, index, buildPath) {
  const element = entry.element;
  const overflow = entry.overflow;
  return {
    index: index + 1,
    tag: element.localName,
    selector: getReadableSelector(element),
    path: buildPath(element),
    elementId: registerElement(element),
    contextId: CONTEXT_ID,
    overflowPx: overflow.amount,
    right: overflow.right,
    left: overflow.left,
    box: overflow.box,
    kind: entry.kind,
    causes: entry.causes,
    css: entry.causes.map((cause) => cause.css).filter(Boolean),
  };
}

function reportKey(report) {
  return [
    report.ok ? 'ok' : 'bad',
    Math.round(report.viewport.width),
    Math.round(report.viewport.pageOverflow),
    report.items.map((item) => `${item.selector}|${item.overflowPx}`).join(';'),
  ].join('/');
}

function paintFrames(layer, items, focusIndex) {
  layer.replaceChildren();
  for (const item of items) {
    const box = item.box;
    if (!box || !(box.w > 0 && box.h > 0)) continue;
    const frame = node('div', `frame${item.index === focusIndex ? ' is-focus' : ''}`);
    frame.style.transform = `translate(${box.x}px, ${box.y}px)`;
    frame.style.width = `${box.w}px`;
    frame.style.height = `${box.h}px`;
    const chip = node('div', `chip${box.y < 22 ? ' inside' : ''}`, `#${item.index}  +${formatPx(item.overflowPx)}px`);
    frame.append(chip);
    layer.append(frame);
  }
}

function paintHud(hud, report, tr) {
  const width = formatPx(report.viewport.width);
  const extra = formatPx(report.viewport.pageOverflow);
  hud.classList.toggle('is-ok', report.ok);
  if (report.ok) {
    hud.replaceChildren(node('b', '', tr(`No overflow at ${width} px`)));
    return;
  }
  const count = report.items.length;
  const lead =
    report.viewport.pageOverflow >= 2
      ? tr(`Page is ${extra} px too wide`)
      : tr(`${count} overflowing ${count === 1 ? 'element' : 'elements'}`);
  hud.replaceChildren(node('b', '', lead), node('small', '', `${width} px · Esc`));
}

function scan(state) {
  const found = findOverflow({ root: document, win: window, skipIds: SKIP_IDS });
  const buildPath = createPathBuilder(document);
  const items = found.items.map((entry, index) => serializeItem(entry, index, buildPath));
  return {
    type: 'update',
    ok: found.ok,
    viewport: {
      width: found.viewport.width,
      height: found.viewport.height,
      scrollWidth: found.viewport.scrollWidth,
      pageOverflow: found.viewport.pageOverflow,
    },
    items,
    truncated: !!found.truncated,
    pageUrl: location.href,
    contextId: CONTEXT_ID,
  };
}

export function startOverflowFinder(options = {}) {
  const settings = { language: normalizeLanguage(options.language) };

  if (session) {
    session.options = settings;
    if (Number.isInteger(options.focusIndex)) session.focusIndex = options.focusIndex;
    session.refresh();
    return { running: true };
  }

  const ui = buildHost();
  document.documentElement.append(ui.host);
  const state = {
    options: settings,
    focusIndex: Number.isInteger(options.focusIndex) ? options.focusIndex : 0,
    frame: 0,
    lastKey: '',
    layer: ui.layer,
    hud: ui.hud,
    host: ui.host,
  };

  const update = () => {
    state.frame = 0;
    let report;
    try {
      report = scan(state);
    } catch {
      return;
    }
    const key = reportKey(report);
    paintFrames(state.layer, report.items, state.focusIndex);
    paintHud(state.hud, report, (text) => translate(text, state.options.language));
    if (key !== state.lastKey) {
      state.lastKey = key;
      broadcast(MSG.OVERFLOW_FIND_EVENT, report);
    }
  };

  const schedule = () => {
    if (!state.frame) state.frame = requestAnimationFrame(update);
  };
  state.refresh = schedule;

  const onClick = (event) => {
    if (event.button !== 0) return;
    let report;
    try {
      report = scan(state);
    } catch {
      return;
    }
    const hits = report.items.filter((item) => {
      const box = item.box;
      return box && event.clientX >= box.x && event.clientX <= box.x + box.w && event.clientY >= box.y && event.clientY <= box.y + box.h;
    });
    if (!hits.length) return;
    hits.sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h);
    state.focusIndex = hits[0].index;
    broadcast(MSG.OVERFLOW_FIND_EVENT, { ...report, selected: hits[0].index });
    schedule();
  };
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    stopOverflowFinder();
    broadcast(MSG.OVERFLOW_FIND_EVENT, { type: 'stopped' });
  };

  const listeners = [
    [window, 'resize', schedule, { passive: true }],
    [window, 'scroll', schedule, { capture: true, passive: true }],
    [window, 'click', onClick, { capture: true }],
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
    get focusIndex() {
      return state.focusIndex;
    },
    set focusIndex(value) {
      state.focusIndex = value;
    },
    refresh: schedule,
    stop() {
      cancelAnimationFrame(state.frame);
      for (const [target, type, handler, flags] of listeners) target.removeEventListener(type, handler, flags);
      ui.host.remove();
    },
  };
  schedule();
  return { running: true };
}

export function stopOverflowFinder() {
  if (!session) return { running: false };
  session.stop();
  session = null;
  return { running: false };
}

export const isOverflowFinderRunning = () => session !== null;

export function overflowFinderReport() {
  if (!session) return null;
  try {
    return scan(session);
  } catch {
    return null;
  }
}
