/**
 * Layout Overflow Finder: horizontal overflow only (a tall page is normal).
 * Pure helpers plus a DOM walk so tests can run the same logic as the page.
 */

export const OVERFLOW_THRESHOLD_PX = 2;
export const MAX_OVERFLOW_ITEMS = 40;
export const MAX_OVERFLOW_SCAN = 4000;
export const SP_HINT_WIDTH = 768;

const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'head', 'br', 'wbr']);
const MEDIA_TAGS = new Set(['img', 'video', 'iframe', 'embed', 'object', 'svg', 'canvas', 'picture']);

export const DEFAULT_OVERFLOW_SKIP_IDS = Object.freeze([
  'wit-overflow-finder',
  'wit-image-inspector',
  'wit-sns-checker',
  'wit-screenshot-selector',
  'wit-screenshot-editor',
  '__wit-highlight-host__',
]);

export function parseCssPx(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'auto' || text === 'none' || text === 'min-content' || text === 'max-content') return null;
  if (text.endsWith('%') || text.includes('fit-content')) return null;
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : null;
}

export function formatPx(value) {
  const number = Math.round(Number(value) * 10) / 10;
  return Number.isInteger(number) ? String(number) : String(number);
}

export function viewportMetrics(win = window) {
  const doc = win.document;
  const root = doc.documentElement;
  const scroller = doc.scrollingElement || root;
  const width = Math.max(1, root.clientWidth || win.innerWidth || 0);
  const height = Math.max(1, root.clientHeight || win.innerHeight || 0);
  const scrollWidth = scroller.scrollWidth || width;
  const pageOverflow = Math.max(0, scrollWidth - width);
  return {
    width,
    height,
    scrollWidth,
    pageOverflow: Math.round(pageOverflow * 10) / 10,
    scrollX: win.scrollX || 0,
  };
}

export function elementOverflow(element, metrics) {
  if (!element?.getBoundingClientRect) return null;
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0.5 && rect.height > 0.5)) return null;
  const absLeft = rect.left + metrics.scrollX;
  const absRight = rect.right + metrics.scrollX;
  const right = absRight - metrics.width;
  const left = -absLeft;
  const amount = Math.max(right, left, 0);
  if (amount < OVERFLOW_THRESHOLD_PX) return null;
  return {
    amount: Math.round(amount * 10) / 10,
    right: Math.max(0, Math.round(right * 10) / 10),
    left: Math.max(0, Math.round(left * 10) / 10),
    box: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
  };
}

export function detectCauses(element, style, metrics) {
  const causes = [];
  const push = (id, text, css) => {
    causes.push({ id, text, css: css || '' });
  };

  const minW = parseCssPx(style.minWidth);
  if (minW != null && minW > metrics.width + 0.5) {
    push('min-width', 'min-width is wider than the viewport', `min-width: ${style.minWidth}`);
  }

  const width = parseCssPx(style.width);
  if (width != null && width > metrics.width + 0.5 && style.width !== style.minWidth) {
    push('width', 'Fixed width is wider than the viewport', `width: ${style.width}`);
  }

  const whiteSpace = String(style.whiteSpace || '');
  if (whiteSpace === 'nowrap') {
    push('nowrap', 'white-space: nowrap keeps content on one line', 'white-space: nowrap');
  } else if (whiteSpace.startsWith('pre') || element.localName === 'pre') {
    push('pre', 'Preformatted text does not wrap', whiteSpace ? `white-space: ${whiteSpace}` : '');
  }

  if (MEDIA_TAGS.has(element.localName)) {
    push('media', 'Image or media is wider than the viewport', style.width && style.width !== 'auto' ? `width: ${style.width}` : '');
  }

  const display = String(style.display || '');
  if (element.localName === 'table' || display === 'table' || display === 'inline-table' || display === 'table-cell' || display === 'table-row') {
    push('table', 'A table cell does not shrink', display ? `display: ${display}` : '');
  }

  if ((display === 'flex' || display === 'inline-flex') && style.flexWrap === 'nowrap') {
    push('flex', 'Flex row does not wrap', 'flex-wrap: nowrap');
  }

  if (style.position === 'absolute' || style.position === 'fixed') {
    push('position', 'Absolutely positioned past the edge', `position: ${style.position}`);
  }

  const marginLeft = parseCssPx(style.marginLeft);
  const marginRight = parseCssPx(style.marginRight);
  if ((marginLeft != null && marginLeft < -1) || (marginRight != null && marginRight < -1)) {
    const css = marginLeft != null && marginLeft < -1 ? `margin-left: ${style.marginLeft}` : `margin-right: ${style.marginRight}`;
    push('margin', 'Negative margin extends the box', css);
  }

  if (!causes.length) {
    push('box', 'Box sticks out of the viewport', width != null ? `width: ${style.width}` : '');
  }
  return causes;
}

function skipElement(element, skipIds) {
  if (!element || element.nodeType !== 1) return true;
  if (SKIP_TAGS.has(element.localName)) return true;
  if (skipIds.has(element.id)) return true;
  if (element.hidden) return true;
  return false;
}

function collectElements(root, skipIds, out, limit) {
  if (!root || out.length >= limit) return out;
  if (root.nodeType === 1 && root !== root.ownerDocument?.documentElement && !skipElement(root, skipIds)) {
    if (!out.includes(root)) out.push(root);
  }
  const list = root.querySelectorAll ? root.querySelectorAll('*') : [];
  for (let i = 0; i < list.length && out.length < limit; i += 1) {
    const element = list[i];
    if (skipElement(element, skipIds)) continue;
    out.push(element);
    if (element.shadowRoot) collectElements(element.shadowRoot, skipIds, out, limit);
  }
  return out;
}

function pickCulprits(entries) {
  const overflowing = new Set(entries.map((entry) => entry.element));
  const chosen = new Map();
  for (const entry of entries) {
    let pick = entry;
    let node = entry.element.parentElement;
    while (node && node.localName !== 'html' && node.localName !== 'body') {
      if (overflowing.has(node)) {
        const parent = entries.find((item) => item.element === node);
        if (parent && parent.causes.some((cause) => cause.id !== 'box')) pick = parent;
      }
      node = node.parentElement;
    }
    chosen.set(pick.element, pick);
  }
  return [...chosen.values()].sort((a, b) => b.overflow.amount - a.overflow.amount);
}

/**
 * Find elements that stick out of the layout viewport horizontally.
 * @param {{ root?: ParentNode, win?: Window, skipIds?: Iterable<string> }} [options]
 */
export function findOverflow(options = {}) {
  const win = options.win || (typeof window !== 'undefined' ? window : null);
  const root = options.root || win?.document;
  if (!win || !root) return { viewport: { width: 0, height: 0, scrollWidth: 0, pageOverflow: 0, scrollX: 0 }, items: [], ok: true };
  const skipIds = new Set(options.skipIds || DEFAULT_OVERFLOW_SKIP_IDS);
  const metrics = viewportMetrics(win);
  const nodes = collectElements(root, skipIds, [], MAX_OVERFLOW_SCAN);
  const found = [];
  for (const element of nodes) {
    let style;
    try {
      style = win.getComputedStyle(element);
    } catch {
      continue;
    }
    if (!style || style.display === 'none' || style.visibility === 'hidden') continue;
    const overflow = elementOverflow(element, metrics);
    if (!overflow) continue;
    const position = style.position;
    found.push({
      element,
      overflow,
      causes: detectCauses(element, style, metrics),
      kind: position === 'fixed' || position === 'sticky' ? 'visual' : 'page',
    });
  }
  const culprits = pickCulprits(found).slice(0, MAX_OVERFLOW_ITEMS);
  const pageOverflow = metrics.pageOverflow;
  const ok = pageOverflow < OVERFLOW_THRESHOLD_PX && culprits.length === 0;
  return { viewport: metrics, items: culprits, ok, truncated: found.length > MAX_OVERFLOW_ITEMS };
}
