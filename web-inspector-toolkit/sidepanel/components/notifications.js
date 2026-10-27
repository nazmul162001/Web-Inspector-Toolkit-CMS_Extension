/** Toast notifications (non-blocking, announced to screen readers). */

import { el } from '../../shared/helpers.js';
import { icon } from './icons.js';

const ICONS = { success: 'check', error: 'alert', info: 'info' };

/** @param {HTMLElement} root */
export function createNotifier(root) {
  const MAX_VISIBLE = 3;

  function show(message, { type = 'info', timeoutMs = 3200 } = {}) {
    while (root.children.length >= MAX_VISIBLE) root.firstElementChild.remove();

    const toast = el(
      'div',
      { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' },
      icon(ICONS[type] || 'info'),
      el('span', {}, message),
    );
    root.append(toast);

    const dismiss = () => {
      toast.classList.add('toast--leaving');
      setTimeout(() => toast.remove(), 220);
    };
    setTimeout(dismiss, type === 'error' ? Math.max(timeoutMs, 5000) : timeoutMs);
    toast.addEventListener('click', dismiss);
  }

  return {
    show,
    success: (message) => show(message, { type: 'success' }),
    error: (message) => show(message, { type: 'error' }),
    info: (message) => show(message, { type: 'info' }),
  };
}
