/**
 * SNS Checker: hover previews an icon, click locks the selection (the href is
 * not followed). Size, side space, matching sizes in the row and even gaps are
 * re-checked as the window is resized. Frames and the suggestion card live in
 * a closed shadow root — the page is never given classes.
 */

import { MSG } from '../shared/constants.js';
import { broadcast } from '../services/message-service.js';
import { normalizeLanguage, translate } from '../services/i18n.js';
import {
  areSideBySide,
  checkSnsCluster,
  checkSnsIcon,
  classifySns,
  clearanceFromRects,
  cssPx,
  cssSourceExtras,
  describeRuleRange,
  formatCssDecl,
  looksLikeSnsIcon,
  px,
  screenKind,
} from '../services/sns-rules.js';
import { findDeclarationLine } from './css-utils.js';
import { bucketEntries, buildStylesheetIndex, pickWinner, safeMatches } from './stylesheet-scanner.js';

const HOST_ID = 'wit-sns-checker';
const SKIP_IDS = new Set([HOST_ID, 'wit-image-inspector', '__wit-highlight-host__']);

const LAYOUT_PROPS = new Set([
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'row-gap', 'column-gap',
]);
const LAYOUT_SHORTHANDS = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  gap: ['row-gap', 'column-gap'],
};

function layoutCovered(name) {
  if (LAYOUT_PROPS.has(name)) return [name];
  return LAYOUT_SHORTHANDS[name] || [];
}

let session = null;
let layoutIndex = null;
let layoutIndexKind = null;
let layoutIndexPending = null;
let layoutIndexPromise = null;

function resetLayoutIndex() {
  layoutIndex = null;
  layoutIndexKind = null;
  layoutIndexPending = null;
  layoutIndexPromise = null;
}

function ensureLayoutIndex() {
  const kind = screenKind(window.innerWidth);
  if (layoutIndex && layoutIndexKind === kind) return Promise.resolve(layoutIndex);
  if (layoutIndexPromise && layoutIndexPending === kind) return layoutIndexPromise;
  layoutIndexPending = kind;
  const mine = buildStylesheetIndex(document, { covered: layoutCovered }).then((index) => {
    if (layoutIndexPending === kind) {
      layoutIndex = index;
      layoutIndexKind = kind;
    }
    return index;
  });
  layoutIndexPromise = mine;
  return mine;
}

function publicSource(source) {
  if (!source) return null;
  return {
    origin: source.origin,
    selector: source.selector || null,
    property: source.property,
    value: source.value,
    important: !!source.important,
    conditions: source.conditions || [],
    stylesheetLabel: source.stylesheetLabel || null,
    stylesheetUrl: source.stylesheetUrl || null,
    line: source.line || null,
    lineBase: source.lineBase || null,
  };
}

const CSS_TEXT = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .frame {
    position: fixed; left: 0; top: 0; pointer-events: none; z-index: 2147483646;
    border: 2px solid #43c59e; border-radius: 8px;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.55), 0 0 0 4px rgba(67, 197, 158, 0.28);
    background: rgba(67, 197, 158, 0.12);
  }
  .frame.preview {
    border-style: dashed;
    background: rgba(67, 197, 158, 0.06);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.4);
  }
  .frame.error {
    border-color: #f2687a;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.55), 0 0 0 4px rgba(242, 104, 122, 0.32);
    background: rgba(242, 104, 122, 0.12);
  }
  .frame.preview.error {
    background: rgba(242, 104, 122, 0.06);
  }
  .gutter {
    position: absolute; top: -2px; bottom: -2px; width: 0;
    background: repeating-linear-gradient(-45deg, rgba(67, 197, 158, 0.18) 0 6px, rgba(67, 197, 158, 0.02) 6px 12px);
    border: 1px dashed rgba(67, 197, 158, 0.7);
  }
  .frame.error .gutter {
    background: repeating-linear-gradient(-45deg, rgba(242, 104, 122, 0.22) 0 6px, rgba(242, 104, 122, 0.04) 6px 12px);
    border-color: rgba(242, 104, 122, 0.75);
  }
  .gutter.left { right: 100%; }
  .gutter.right { left: 100%; }
  .chip {
    position: absolute; left: -2px; top: -2px; transform: translateY(-100%);
    padding: 2px 7px; border-radius: 5px 5px 5px 0; white-space: nowrap;
    font: 650 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #fff; background: #1f9d78; font-variant-numeric: tabular-nums;
  }
  .chip.inside { transform: none; border-radius: 0 0 5px 0; }
  .frame.error .chip { background: #c24153; }
  .card {
    position: fixed; left: 0; top: 0; width: min(340px, calc(100vw - 16px));
    pointer-events: none; z-index: 2147483647;
    padding: 12px 14px 10px; border-radius: 12px;
    color: #e9ebf1; background: rgba(22, 25, 32, 0.97); border: 1px solid #353c4b;
    box-shadow: 0 14px 38px rgba(0, 0, 0, 0.45);
    font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .card.error { border-color: #c24153; }
  .card.ok { border-color: #1f9d78; }
  .card-kicker {
    font-size: 10.5px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase;
    color: #b9b0ff; margin-bottom: 4px;
  }
  .card.error .card-kicker { color: #f2687a; }
  .card.ok .card-kicker { color: #43c59e; }
  .card-title { font: 700 14px/1.3 ui-sans-serif, system-ui, sans-serif; color: #fff; }
  .card-lead { margin-top: 4px; color: #a4abbd; font-size: 11.5px; }
  .card-rows { margin-top: 10px; padding-top: 9px; border-top: 1px solid #272c38; display: grid; gap: 4px; }
  .card-row { display: flex; gap: 10px; justify-content: space-between; align-items: baseline; }
  .card-row span:first-child { color: #8a92a5; flex: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .card-row span:last-child { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; text-align: right; }
  .css-block { display: grid; gap: 1px; padding: 2px 0; }
  .css-block + .css-block { border-top: 1px solid #272c38; }
  .css-decl { font: 650 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .css-meta {
    color: #8a92a5; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-word;
  }
  .bad { color: #f2687a !important; }
  .good { color: #43c59e !important; }
  .card-tips { margin: 8px 0 0; padding-left: 16px; color: #e9ebf1; display: grid; gap: 3px; }
  .card-hint { margin-top: 8px; font-size: 10.5px; color: #6e7688; }
`;

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
  const card = node('div', 'card');
  card.style.display = 'none';
  shadow.append(style, layer, card);
  return { host, layer, card };
}

function boxOf(element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

function visibleBox(element) {
  if (!element || element.nodeType !== 1) return null;
  const box = boxOf(element);
  return box.w > 1 && box.h > 1 ? box : null;
}

function signalsOf(element) {
  const link = element.closest?.('a') || (element.localName === 'a' ? element : null);
  const img = element.localName === 'img' ? element : element.querySelector?.('img');
  return {
    href: link?.href || link?.getAttribute?.('href') || '',
    alt: img?.alt || element.getAttribute?.('aria-label') || '',
    className: `${element.className || ''} ${link?.className || ''} ${img?.className || ''}`,
    src: img?.currentSrc || img?.src || '',
    text: (element.textContent || '').trim().slice(0, 80),
  };
}

function visualTarget(element) {
  if (!element) return null;
  if (element.localName === 'img' || element.localName === 'svg' || element.localName === 'image') return element;
  const img = element.querySelector?.('img, svg');
  if (img && visibleBox(img) && visibleBox(img).w <= 120 && visibleBox(img).h <= 120) return img;
  return element.closest?.('a') || element;
}

function isSkip(element) {
  return !element || SKIP_IDS.has(element.id) || element.closest?.(`#${HOST_ID}`);
}

function snsFromNode(start) {
  let nodeEl = start;
  for (let i = 0; i < 8 && nodeEl && nodeEl.nodeType === 1; i += 1) {
    if (isSkip(nodeEl)) return null;
    const target = visualTarget(nodeEl);
    const box = visibleBox(target);
    const info = signalsOf(target);
    const kind = classifySns(info);
    if (kind && box && (looksLikeSnsIcon(info, box) || box.w <= 120)) {
      return { element: target, box, info, kind };
    }
    nodeEl = nodeEl.parentElement;
  }
  return null;
}

function snsAtEvent(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const item of path) {
    if (item?.nodeType === 1) {
      const hit = snsFromNode(item);
      if (hit) return hit;
    }
  }
  if (event.target?.nodeType === 1) return snsFromNode(event.target);
  return null;
}

function snsAtPoint(x, y) {
  const stack = document.elementsFromPoint(x, y);
  for (const element of stack) {
    if (isSkip(element)) continue;
    const hit = snsFromNode(element);
    if (hit) return hit;
  }
  return null;
}

function ancestorSet(element) {
  const set = new Set();
  for (let nodeEl = element; nodeEl && nodeEl.nodeType === 1; nodeEl = nodeEl.parentElement) set.add(nodeEl);
  return set;
}

function collectOthers(iconEl, iconBox, clusterEls) {
  const ignore = ancestorSet(iconEl);
  for (const extra of clusterEls) {
    for (const nodeEl of ancestorSet(extra)) ignore.add(nodeEl);
    extra.querySelectorAll?.('*').forEach((nodeEl) => ignore.add(nodeEl));
  }
  iconEl.querySelectorAll?.('*').forEach((nodeEl) => ignore.add(nodeEl));
  const scope =
    iconEl.closest('header, footer, nav, [class*="header"], [class*="footer"], [class*="sns"], [class*="nav"]') ||
    iconEl.parentElement?.parentElement ||
    document.body;
  const others = [];
  for (const nodeEl of scope.querySelectorAll('a, img, svg, button, p, span, li, h1, h2, h3, h4, input, label, div')) {
    if (ignore.has(nodeEl) || isSkip(nodeEl)) continue;
    const style = getComputedStyle(nodeEl);
    if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) === 0) continue;
    const box = visibleBox(nodeEl);
    if (!box) continue;
    if (box.w > 900 && box.h > 200) continue;
    if (box.x <= iconBox.x + 1 && box.y <= iconBox.y + 1 && box.x + box.w >= iconBox.x + iconBox.w - 1 && box.y + box.h >= iconBox.y + iconBox.h - 1) continue;
    others.push(box);
  }
  return others;
}

function rowCluster(seed) {
  const scope =
    seed.element.closest('header, footer, nav, [class*="header"], [class*="footer"], [class*="sns"], [class*="nav"]') ||
    seed.element.parentElement?.parentElement ||
    document.body;
  const hits = [];
  const seen = new Set();
  for (const nodeEl of scope.querySelectorAll('a, img, svg')) {
    const hit = snsFromNode(nodeEl);
    if (!hit || seen.has(hit.element)) continue;
    seen.add(hit.element);
    hit.box = visibleBox(hit.element) || hit.box;
    hits.push(hit);
  }
  const cluster = [seed];
  let grew = true;
  while (grew) {
    grew = false;
    for (const hit of hits) {
      if (cluster.some((item) => item.element === hit.element)) continue;
      if (cluster.some((item) => areSideBySide(item.box, hit.box))) {
        cluster.push(hit);
        grew = true;
      }
    }
  }
  return cluster.sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
}

function snsWrap(element) {
  return element.closest?.('a') || (element.localName === 'a' ? element : element);
}

function snsImg(element) {
  return element.localName === 'img' ? element : element.querySelector?.('img') || element;
}

function classHint(element) {
  const raw = typeof element.className === 'string' ? element.className : element.getAttribute?.('class') || '';
  const names = raw.trim().split(/\s+/).filter(Boolean);
  const preferred = names.find((name) => name.startsWith('-w-') || /sns|icon|instagram|line|facebook/i.test(name));
  return preferred ? `.${preferred}` : element.localName;
}

function specified(element, prop) {
  return (element.style?.getPropertyValue(prop) || '').trim();
}

function readDecl(element, prop) {
  const inline = specified(element, prop);
  const computed = getComputedStyle(element).getPropertyValue(prop).trim();
  return {
    property: prop,
    value: inline || computed || '0px',
    px: cssPx(computed) || 0,
    inline: !!inline,
    selector: classHint(element),
  };
}

function relevantDecl(element, prop) {
  const longhandInline = specified(element, prop);
  const computed = cssPx(getComputedStyle(element).getPropertyValue(prop)) || 0;
  const shorthand = prop.startsWith('margin') ? 'margin' : prop.startsWith('padding') ? 'padding' : null;
  const shorthandInline = shorthand ? specified(element, shorthand) : '';
  if (longhandInline) return readDecl(element, prop);
  if (computed < 0.5) return null;
  if (shorthandInline) {
    return { property: shorthand, value: shorthandInline, px: computed, inline: true, selector: classHint(element), longhand: prop };
  }
  return readDecl(element, prop);
}

function readGap(element) {
  if (!element) return null;
  const display = getComputedStyle(element).display;
  if (!display.includes('flex') && !display.includes('grid')) return null;
  const inlineGap = specified(element, 'gap') || specified(element, 'column-gap');
  const column = getComputedStyle(element).getPropertyValue('column-gap').trim();
  const pxValue = cssPx(column) || 0;
  if (inlineGap) {
    return { property: specified(element, 'gap') ? 'gap' : 'column-gap', value: inlineGap, px: pxValue, inline: true, selector: classHint(element) };
  }
  if (pxValue >= 0.5 && column !== 'normal') {
    return { property: 'column-gap', value: column, px: pxValue, inline: false, selector: classHint(element) };
  }
  return null;
}

function readSizeDecls(element) {
  if (!element) return [];
  const decls = [];
  for (const prop of ['width', 'height']) {
    const inline = specified(element, prop);
    const computed = getComputedStyle(element).getPropertyValue(prop).trim();
    const attr = element.getAttribute?.(prop);
    if (inline) {
      decls.push({ property: prop, value: inline, px: cssPx(computed) || 0, inline: true, selector: classHint(element) });
    } else if (computed && computed !== 'auto' && cssPx(computed) != null) {
      decls.push({ property: prop, value: computed, px: cssPx(computed) || 0, inline: false, selector: classHint(element) });
    } else if (attr) {
      decls.push({ property: prop, value: /^\d+$/.test(attr) ? `${attr}px` : attr, px: Number.parseFloat(attr) || 0, inline: false, selector: classHint(element) });
    }
  }
  return decls;
}

function uniqueDecls(list) {
  const seen = new Set();
  const out = [];
  for (const decl of list || []) {
    const key = `${decl.property}:${decl.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(decl);
  }
  return out;
}

function shorthandOf(prop) {
  if (prop.startsWith('margin')) return 'margin';
  if (prop.startsWith('padding')) return 'padding';
  if (prop === 'column-gap' || prop === 'row-gap' || prop === 'gap') return 'gap';
  return null;
}

function inlineSource(element, prop) {
  const longhand = specified(element, prop);
  const short = shorthandOf(prop);
  const shortValue = short ? specified(element, short) : '';
  if (!longhand && !shortValue) return null;
  return {
    origin: 'inline',
    selector: 'element.style',
    property: longhand ? prop : short,
    value: longhand || shortValue,
    important: element.style.getPropertyPriority(longhand ? prop : short) === 'important',
    conditions: [],
    stylesheetLabel: null,
    stylesheetUrl: null,
    line: null,
    lineBase: null,
  };
}

function stylesheetSource(element, prop, index) {
  if (!element || !index) return null;
  const candidates = [];
  for (const entry of bucketEntries(index, prop, element)) {
    if (safeMatches(element, entry.selector)) candidates.push(entry);
  }
  const winner = pickWinner(candidates);
  if (!winner) return null;
  const source = {
    origin: 'stylesheet',
    selector: winner.selectorText || winner.selector || null,
    property: winner.declName,
    value: winner.value,
    important: !!winner.important,
    conditions: winner.conditions || [],
    stylesheetLabel: winner.sheet?.label || null,
    stylesheetUrl: winner.sheet?.href || null,
    line: null,
    lineBase: null,
  };
  if (winner.sheet?.kind === 'style') {
    const text = winner.sheet.sheet?.ownerNode?.textContent;
    if (text) {
      const line = findDeclarationLine(text, winner.selectorText, winner.declName, winner.value);
      if (line) {
        source.line = line;
        source.lineBase = 'style-element';
      }
    }
  }
  return source;
}

function attachSource(decl, element, index) {
  if (!decl || !element) return decl;
  const prop = decl.longhand || decl.property;
  const source = inlineSource(element, prop) || stylesheetSource(element, prop, index);
  return source ? { ...decl, source: publicSource(source) } : decl;
}

function sourceHint(decl) {
  const src = decl?.source;
  if (!src) return '';
  if (src.origin === 'inline') return 'the inline style';
  return (src.conditions || []).filter((item) => /^@media\b/i.test(item)).join(' › ');
}

function withFixHints(check) {
  if (!check || check.ok) return check;
  const extras = [];
  const decls = [...(check.cssSize || []), ...(check.cssSpacing?.left || []), ...(check.cssSpacing?.right || [])];
  for (const decl of decls) {
    const where = sourceHint(decl);
    if (!where) continue;
    extras.push(`Edit ${formatCssDecl(decl)} in ${where}.`);
  }
  if (!extras.length) return check;
  return { ...check, suggestions: [...new Set([...(check.suggestions || []), ...extras])] };
}

function readSnsCss(element, { last = false, index = null } = {}) {
  const wrap = snsWrap(element);
  const img = snsImg(element);
  const parent = wrap.parentElement;
  const imgSize = readSizeDecls(img);
  const sizeTarget = imgSize.length ? img : wrap;
  const cssSize = (imgSize.length ? imgSize : readSizeDecls(wrap)).map((decl) => attachSource(decl, sizeTarget, index));
  const left = [];
  const right = [];
  const ml = relevantDecl(wrap, 'margin-left');
  const pl = relevantDecl(wrap, 'padding-left');
  const mr = relevantDecl(wrap, 'margin-right');
  const pr = relevantDecl(wrap, 'padding-right');
  if (ml) left.push(attachSource(ml, wrap, index));
  if (pl) left.push(attachSource(pl, wrap, index));
  if (mr) right.push(attachSource(mr, wrap, index));
  if (pr) right.push(attachSource(pr, wrap, index));
  const gap = readGap(parent);
  if (gap && !last) right.push(attachSource(gap, parent, index));
  return { cssSize, cssSpacing: { left, right } };
}

function measure(item, clusterEls, { last = false } = {}) {
  const box = visibleBox(item.element);
  if (!box) return null;
  item.box = box;
  const spacing = clearanceFromRects(box, collectOthers(item.element, box, clusterEls), window.innerWidth);
  item.info = signalsOf(item.element);
  item.kind = classifySns(item.info) || item.kind;
  item.css = readSnsCss(item.element, { last, index: layoutIndex });
  item.cssSpacing = item.css.cssSpacing;
  item.check = withFixHints(checkSnsIcon({
    width: box.w,
    height: box.h,
    spacing,
    cssSpacing: item.css.cssSpacing,
    cssSize: item.css.cssSize,
    trailing: !last || item.css.cssSpacing.right.length > 0,
    viewportWidth: window.innerWidth,
  }));
  return item;
}

function makeItem(hit, id) {
  return { id, element: hit.element, kind: hit.kind, info: hit.info, box: hit.box, check: null };
}

function summaryOf(item) {
  return {
    id: item.id,
    kind: item.kind?.id || 'sns',
    kindLabel: item.kind?.label || 'SNS',
    href: item.info?.href || '',
    alt: item.info?.alt || '',
    size: item.check.size,
    spacing: item.check.spacing,
    cssSize: item.check.cssSize || [],
    cssSpacing: item.check.cssSpacing || { left: [], right: [] },
    requiredSpace: item.check.requiredSpace,
    requiredSize: item.check.requiredSize,
    ok: item.check.ok,
    issues: item.check.issues,
    suggestions: item.check.suggestions,
    summary: item.check.summary,
    screen: item.check.screen,
    screenLabel: item.check.screenLabel,
    viewportWidth: item.check.viewportWidth,
  };
}

function verdictOf(state) {
  const items = state.selected;
  const currentOk = items.length > 0 && items.every((item) => item.check?.ok) && (!state.cluster || state.cluster.ok);
  if (items.length && currentOk) {
    state.screens[screenKind(window.innerWidth)] = 'pass';
  } else if (items.length) {
    state.screens[screenKind(window.innerWidth)] = 'fail';
  }
  const perfect = state.screens.sp === 'pass' && state.screens.pc === 'pass';
  const suggestions = [
    ...items.flatMap((item) => item.check?.suggestions || []),
    ...(state.cluster?.suggestions || []),
  ];
  return { currentOk, perfect, suggestions: [...new Set(suggestions)] };
}

function payload(state) {
  const items = state.selected.map(summaryOf);
  const { currentOk, perfect, suggestions } = verdictOf(state);
  return {
    type: 'update',
    running: true,
    active: items.length > 0,
    viewportWidth: Math.round(window.innerWidth),
    screen: items[0]?.screen || screenKind(window.innerWidth),
    screenLabel: items[0]?.screenLabel || (window.innerWidth <= 768 ? 'Small screen' : 'PC'),
    currentOk,
    perfect,
    screens: { ...state.screens },
    failRange: currentOk ? null : describeRuleRange(window.innerWidth),
    cluster: state.cluster,
    suggestions,
    items,
  };
}

function paintFrame(item, { preview, error }) {
  const box = item.box;
  const check = item.check;
  const frame = node('div', `frame${preview ? ' preview' : ''}${error ? ' error' : ''}`);
  const gutterW = Math.max(4, check?.requiredSpace || 20);
  const left = node('div', 'gutter left');
  const right = node('div', 'gutter right');
  left.style.width = `${gutterW}px`;
  right.style.width = `${gutterW}px`;
  const chip = node('div', box.y < 28 ? 'chip inside' : 'chip', `${check.size.w} × ${check.size.h}`);
  frame.append(left, right, chip);
  Object.assign(frame.style, {
    transform: `translate(${box.x}px, ${box.y}px)`,
    width: `${Math.max(2, box.w)}px`,
    height: `${Math.max(2, box.h)}px`,
  });
  return frame;
}

function cardCopy(state, tr) {
  const { currentOk, perfect, suggestions } = verdictOf(state);
  const active = state.selected.length > 0;
  if (!active && state.hover) {
    return {
      kicker: tr('Preview'),
      title: tr('Click to select this icon'),
      lead: tr('Hover previews the rules. Click to lock the selection, then resize the window.'),
      tone: state.hover.check?.ok === false || (state.cluster && !state.cluster.ok) ? 'error' : '',
      suggestions,
    };
  }
  if (perfect) {
    return {
      kicker: tr('Pass'),
      title: tr('Perfect. Everything is okay.'),
      lead: tr('Small screen and PC both match the SNS rules.'),
      tone: 'ok',
      suggestions: [],
    };
  }
  if (!currentOk) {
    const range = describeRuleRange(window.innerWidth);
    const extra = state.screens.pc === 'pass' ? 'PC already passed.' : state.screens.sp === 'pass' ? 'Small screen already passed.' : '';
    return {
      kicker: tr('Needs work'),
      title: tr('This width breaks the SNS rules.'),
      lead: [tr(range), extra ? tr(extra) : '', tr('The red frame marks what fails. Update the CSS below at this screen size.')].filter(Boolean).join(' '),
      tone: 'error',
      suggestions,
    };
  }
  const needSmall = state.screens.sp !== 'pass';
  return {
    kicker: tr('This width is okay'),
    title: tr('Not finished yet'),
    lead: needSmall
      ? tr('Resize to a small screen (max 768 px) and confirm 40 × 40 px with 20 px sides.')
      : tr('Resize wider than 768 px and confirm the PC size and spacing.'),
    tone: '',
    suggestions,
  };
}

function paintCard(state) {
  const tr = (text) => translate(text, state.options.language);
  const focus = state.selected.length ? state.selected : state.hover ? [state.hover] : [];
  if (!focus.length) {
    state.card.style.display = 'none';
    state.card.replaceChildren();
    return;
  }
  const copy = cardCopy(state, tr);
  const sample = focus[0].check;
  const cluster = state.cluster;
  const rows = node('div', 'card-rows');
  const addRow = (label, value, tone = '') => {
    const row = node('div', 'card-row');
    row.append(node('span', '', tr(label)), node('span', tone, value));
    rows.append(row);
  };
  const addCss = (decl, tone) => {
    const block = node('div', 'css-block');
    block.append(node('div', `css-decl ${tone}`, formatCssDecl(decl)));
    for (const extra of cssSourceExtras(decl.source)) {
      block.append(node('div', 'css-meta', extra.kind === 'inline' ? tr(extra.text) : extra.text));
    }
    rows.append(block);
  };
  const cssSize = uniqueDecls(sample.cssSize);
  const cssSpace = uniqueDecls([...(sample.cssSpacing?.left || []), ...(sample.cssSpacing?.right || [])]);
  if (cssSize.length) {
    for (const decl of cssSize) addCss(decl, sample.issues.includes('size') ? 'bad' : 'good');
  } else {
    addRow('Size', `${sample.size.w} × ${sample.size.h} px`, sample.issues.includes('size') ? 'bad' : 'good');
  }
  if (cssSpace.length) {
    for (const decl of cssSpace) {
      const bad = sample.issues.includes('spacing') && Number(decl.px) + 0.6 < sample.requiredSpace;
      addCss(decl, bad ? 'bad' : 'good');
    }
  } else {
    addRow('Space on the left', `${px(sample.spacing.left)} px`, sample.issues.includes('spacing') && sample.spacing.left < sample.requiredSpace ? 'bad' : 'good');
    addRow('Space on the right', `${px(sample.spacing.right)} px`, sample.issues.includes('spacing') && sample.spacing.right < sample.requiredSpace ? 'bad' : 'good');
  }
  if (cluster && (cluster.sizes || []).length > 1) {
    addRow('Row sizes', cluster.sameSize ? tr('All the same') : tr('Not the same'), cluster.sameSize ? 'good' : 'bad');
    if (cluster.cssGaps?.length) {
      addRow('Space between icons', cluster.cssGaps.join(' · '), cluster.sameGap ? 'good' : 'bad');
    } else if (cluster.gaps?.length) {
      addRow('Space between icons', cluster.gaps.map((gap) => `${px(gap)} px`).join(' · '), cluster.sameGap ? 'good' : 'bad');
    }
  }
  const tips = copy.suggestions.length ? node('ul', 'card-tips') : null;
  for (const text of copy.suggestions) tips.append(node('li', '', tr(text)));
  const kicker = node('div', 'card-kicker', copy.kicker);
  const title = node('div', 'card-title', copy.title);
  const lead = node('div', 'card-lead', copy.lead);
  const hint = node('div', 'card-hint', tr(state.selected.length ? 'Resize the window to re-check · Esc to stop' : 'Click to select · Esc to stop'));
  state.card.className = `card${copy.tone ? ` ${copy.tone}` : ''}`;
  state.card.replaceChildren(...[kicker, title, lead, rows, tips, hint].filter(Boolean));

  const bounds = focus.reduce(
    (acc, item) => ({
      x: Math.min(acc.x, item.box.x),
      y: Math.min(acc.y, item.box.y),
      right: Math.max(acc.right, item.box.x + item.box.w),
      bottom: Math.max(acc.bottom, item.box.y + item.box.h),
    }),
    { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity },
  );
  state.card.style.display = 'block';
  const width = Math.min(340, window.innerWidth - 16);
  const height = state.card.offsetHeight;
  let left = bounds.x;
  let top = bounds.bottom + 10;
  if (top + height > window.innerHeight - 8) top = Math.max(8, bounds.y - height - 10);
  left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8));
  state.card.style.width = `${width}px`;
  state.card.style.transform = `translate(${left}px, ${top}px)`;
}

function paint(state) {
  state.layer.replaceChildren();
  const clusterError = state.cluster && !state.cluster.ok;
  for (const item of state.selected) {
    if (!item.check) continue;
    state.layer.append(paintFrame(item, { preview: false, error: !item.check.ok || clusterError }));
  }
  if (state.hover && !state.selected.some((item) => item.element === state.hover.element)) {
    if (state.hover.check) {
      state.layer.append(paintFrame(state.hover, { preview: true, error: !state.hover.check.ok || clusterError }));
    }
  }
  paintCard(state);
}

function emit(state) {
  broadcast(MSG.SNS_CHECK_EVENT, payload(state));
}

function refresh(state) {
  const keep = state.selected.filter((item) => item.element.isConnected && visibleBox(item.element));
  state.selected.splice(0, state.selected.length, ...keep);
  if (state.hover?.element && !(state.hover.element.isConnected && visibleBox(state.hover.element))) state.hover = null;

  const seed = state.selected[0] || state.hover;
  if (!seed) {
    state.cluster = null;
    paint(state);
    emit(state);
    return;
  }

  seed.box = visibleBox(seed.element) || seed.box;
  const row = rowCluster(seed);
  const els = row.map((hit) => hit.element);
  const lastWrap = snsWrap(row[row.length - 1].element);
  const measureOne = (item) => measure(item, els.filter((el) => el !== item.element), { last: snsWrap(item.element) === lastWrap });

  for (const item of state.selected) measureOne(item);
  if (state.hover && !state.selected.some((item) => item.element === state.hover.element)) measureOne(state.hover);

  const clusterItems = row.map((hit) => {
    const selected = state.selected.find((item) => item.element === hit.element);
    if (selected) return selected;
    if (state.hover?.element === hit.element) return state.hover;
    const extra = makeItem(hit, 0);
    measureOne(extra);
    return extra;
  });
  state.cluster = checkSnsCluster(clusterItems);
  paint(state);
  emit(state);
}

function toggleSelect(state, hit) {
  const existing = state.selected.findIndex((item) => item.element === hit.element);
  if (existing >= 0) {
    state.selected.splice(existing, 1);
    state.screens = { sp: null, pc: null };
    return;
  }
  const neighbour = state.selected.filter((item) => item.element !== hit.element && areSideBySide(item.box, hit.box));
  if (!neighbour.length && state.selected.length) state.selected.splice(0, state.selected.length);
  state.nextId += 1;
  state.selected.push(makeItem(hit, state.nextId));
  state.screens = { sp: null, pc: null };
  for (const item of state.selected) item.box = visibleBox(item.element) || item.box;
}

export function startSnsChecker(options = {}) {
  const settings = { language: normalizeLanguage(options.language) };
  if (session) {
    session.options = settings;
    ensureLayoutIndex().then(() => {
      if (session) refresh(session);
    });
    refresh(session);
    return { running: true };
  }

  const ui = buildHost();
  document.documentElement.append(ui.host);
  const state = {
    options: settings,
    selected: [],
    hover: null,
    cluster: null,
    screens: { sp: null, pc: null },
    nextId: 0,
    frame: 0,
    layer: ui.layer,
    card: ui.card,
    host: ui.host,
  };

  const schedule = () => {
    if (!state.frame) {
      state.frame = requestAnimationFrame(() => {
        state.frame = 0;
        refresh(state);
      });
    }
  };

  const onMove = (event) => {
    const hit = snsAtPoint(event.clientX, event.clientY);
    if (!hit) {
      if (state.hover) {
        state.hover = null;
        refresh(state);
      }
      return;
    }
    if (state.hover?.element === hit.element) return;
    state.nextId += 1;
    state.hover = makeItem(hit, state.nextId);
    refresh(state);
  };

  const onClick = (event) => {
    const hit = snsAtEvent(event);
    if (!hit) {
      if (state.selected.length) {
        state.selected.splice(0, state.selected.length);
        state.screens = { sp: null, pc: null };
        refresh(state);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    toggleSelect(state, hit);
    refresh(state);
  };

  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    stopSnsChecker();
    broadcast(MSG.SNS_CHECK_EVENT, { type: 'stopped' });
  };

  const listeners = [
    [window, 'mousemove', onMove, true],
    [window, 'click', onClick, true],
    [window, 'auxclick', onClick, true],
    [window, 'keydown', onKey, true],
    [window, 'resize', () => {
      const kind = screenKind(window.innerWidth);
      if (layoutIndexKind && layoutIndexKind !== kind) {
        layoutIndex = null;
        layoutIndexKind = null;
        ensureLayoutIndex().then(() => {
          if (session === state) refresh(state);
        });
      }
      schedule();
    }, false],
    [window, 'scroll', schedule, true],
  ];
  for (const [target, type, handler, capture] of listeners) target.addEventListener(type, handler, capture);

  state.stop = () => {
    cancelAnimationFrame(state.frame);
    for (const [target, type, handler, capture] of listeners) target.removeEventListener(type, handler, capture);
    ui.host.remove();
  };
  session = state;
  paint(state);
  emit(state);
  ensureLayoutIndex().then(() => {
    if (session === state) refresh(state);
  });
  return { running: true };
}

export function stopSnsChecker() {
  if (!session) return { running: false };
  session.stop();
  session = null;
  resetLayoutIndex();
  return { running: false };
}

export const isSnsCheckerRunning = () => session !== null;

export function snsCssIndexReady() {
  return layoutIndexPromise || Promise.resolve(layoutIndex);
}

export function selectedSnsIcons() {
  return session ? session.selected.map((item) => (item.check ? summaryOf(item) : { kind: item.kind?.id, id: item.id })) : [];
}

export function snsCheckerReport() {
  return session ? payload(session) : null;
}
