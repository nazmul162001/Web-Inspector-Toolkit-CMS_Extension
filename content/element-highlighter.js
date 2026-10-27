/**
 * Temporary element highlighting.
 *
 * The highlight is an overlay drawn in a closed shadow root attached to a
 * single host node under <html>. The page's own elements are never given
 * temporary classes or inline styles, so there is nothing to preserve or
 * restore on them - and the overlay (host node included) is removed
 * automatically after HIGHLIGHT_DURATION_MS, or when the next highlight starts.
 *
 * The overlay tracks the element's rectangle each frame so it stays correct
 * while the page is still scrolling or an element is sticky/animating.
 */

import { HIGHLIGHT_DURATION_MS, HIGHLIGHT_HOST_ID } from '../shared/constants.js';

let active = null; // { host, rafId, timer }

const OVERLAY_CSS = `
  :host { all: initial; }
  .box {
    position: fixed; box-sizing: border-box; pointer-events: none; z-index: 2147483647;
    border: 2px solid #7c6cf6; border-radius: 4px;
    background: rgba(124, 108, 246, 0.14);
    box-shadow: 0 0 0 4px rgba(124, 108, 246, 0.35), 0 0 24px rgba(124, 108, 246, 0.55);
  }
  .tag {
    position: fixed; pointer-events: none; z-index: 2147483647;
    font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #fff; background: #5b4bd8; padding: 2px 6px; border-radius: 4px; white-space: nowrap;
  }
`;

export function clearHighlight() {
  if (!active) return;
  cancelAnimationFrame(active.rafId);
  clearTimeout(active.timer);
  active.host.remove();
  active = null;
}

/** Nearest element (self or ancestor) that owns a layout box. */
function visibleTarget(element) {
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    if (node.getClientRects().length > 0) return node;
  }
  return null;
}

/**
 * @param {Element} element
 * @param {{ outline?: boolean, label?: string }} [options]
 * @returns {{ ok: boolean, code?: string, note?: string }}
 */
export function highlightElement(element, { outline = true, label = '' } = {}) {
  clearHighlight();
  const target = visibleTarget(element);
  if (!target) return { ok: false, code: 'NOT_VISIBLE' };
  const note = target === element ? undefined : 'The element itself is not rendered; its nearest visible ancestor was highlighted.';

  target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  if (!outline) return { ok: true, note };

  const host = document.createElement('div');
  host.id = HIGHLIGHT_HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  const box = document.createElement('div');
  box.className = 'box';
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.textContent = label || target.localName;
  root.append(style, box, tag);
  document.documentElement.append(host);

  const place = () => {
    const rect = target.getBoundingClientRect();
    const pad = 3;
    Object.assign(box.style, {
      left: `${rect.left - pad}px`,
      top: `${rect.top - pad}px`,
      width: `${Math.max(rect.width, 2) + pad * 2}px`,
      height: `${Math.max(rect.height, 2) + pad * 2}px`,
    });
    const above = rect.top > 26;
    Object.assign(tag.style, {
      left: `${Math.max(4, rect.left - pad)}px`,
      top: `${above ? rect.top - 26 : rect.bottom + 8}px`,
    });
  };

  const state = { host, rafId: 0, timer: 0 };
  const loop = () => {
    place();
    state.rafId = requestAnimationFrame(loop);
  };
  place();
  loop();
  active = state;

  if (typeof box.animate === 'function') {
    box.animate(
      [
        { transform: 'scale(1.06)', opacity: 0, offset: 0 },
        { transform: 'scale(1)', opacity: 1, offset: 0.2 },
        { opacity: 0.45, offset: 0.45 },
        { opacity: 1, offset: 0.65 },
        { opacity: 0.45, offset: 0.85 },
        { opacity: 0, offset: 1 },
      ],
      { duration: HIGHLIGHT_DURATION_MS, easing: 'ease-out', fill: 'forwards' },
    );
  }

  state.timer = setTimeout(() => {
    if (active === state) clearHighlight();
  }, HIGHLIGHT_DURATION_MS);

  return { ok: true, note };
}
