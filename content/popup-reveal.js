/**
 * Scroll-triggered popup banners (CMS `.popup` / `.-w-modal` with
 * `data-scrolly`). They stay in the HTML at opacity 0 until the page is
 * scrolled; Highlight must scroll first, then outline the match.
 */

export const POPUP_SELECTOR = [
  '[data-scrolly]',
  '.popup',
  '.-w-modal',
  'dialog',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(',');

export function popupRoot(element) {
  return element?.closest?.(POPUP_SELECTOR) || null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the banner is actually on screen, not waiting for a scroll. */
export function popupIsOpen(root) {
  if (!root || root.nodeType !== 1) return true;
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(root) : null;
  if (cs) {
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (Number.parseFloat(cs.opacity) < 0.1) return false;
  }
  if (root.hidden || root.getAttribute('aria-hidden') === 'true') {
    if (!cs || Number.parseFloat(cs.opacity) < 0.5) return false;
  }
  return !!root.getClientRects?.().length;
}

function maxScrollY() {
  const root = document.documentElement;
  const body = document.body;
  const height = Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0);
  return Math.max(0, height - (window.innerHeight || 0));
}

function fireScroll() {
  window.dispatchEvent(new Event('scroll'));
  document.dispatchEvent(new Event('scroll'));
  document.documentElement?.dispatchEvent(new Event('scroll'));
}

function scrollToY(top) {
  const y = Math.max(0, Math.min(maxScrollY(), top));
  const root = document.documentElement;
  if (root) root.scrollTop = y;
  if (document.body) document.body.scrollTop = y;
  window.scrollTo(0, y);
  fireScroll();
}

async function waitUntilOpen(root, ms) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (popupIsOpen(root)) return true;
    await delay(50);
  }
  return popupIsOpen(root);
}

/**
 * Scroll until a popup ancestor of `element` is shown. No-op when the match
 * is not inside a popup, or the popup is already open.
 */
export async function revealPopup(element) {
  const root = popupRoot(element);
  if (!root) return null;
  if (popupIsOpen(root)) return root;

  // A just-opened tab may still be binding its scroll listener.
  await delay(120);
  if (popupIsOpen(root)) return root;

  const fraction = Number.parseFloat(root.getAttribute('data-scrolly'));
  const limit = maxScrollY();
  if (Number.isFinite(fraction) && fraction > 0 && limit > 0) {
    scrollToY(limit * Math.min(1, fraction));
    if (await waitUntilOpen(root, 1800)) return root;
  } else {
    fireScroll();
    if (await waitUntilOpen(root, 400)) return root;
  }

  const step = Math.max(240, Math.round((window.innerHeight || 600) * 0.45));
  for (let y = step; y <= limit + step; y += step) {
    scrollToY(y);
    if (await waitUntilOpen(root, 280)) return root;
  }
  scrollToY(limit);
  await waitUntilOpen(root, 800);
  return root;
}
