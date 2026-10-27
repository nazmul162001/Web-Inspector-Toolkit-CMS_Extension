/** Loading primitives: spinner, progress bar and skeleton placeholders. */

import { el } from '../../shared/helpers.js';

export const createSpinner = () => el('span', { class: 'spinner', role: 'status', 'aria-label': 'Loading' });

/**
 * Progress bar. `set(fraction)` takes 0..1; `set(null)` makes it indeterminate.
 * @returns {{ element: HTMLElement, set: (fraction: number|null) => void }}
 */
export function createProgressBar() {
  const bar = el('div', { class: 'progress__bar' });
  const element = el(
    'div',
    { class: 'progress progress--indeterminate', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 },
    bar,
  );
  return {
    element,
    set(fraction) {
      if (fraction === null || Number.isNaN(fraction)) {
        element.classList.add('progress--indeterminate');
        element.removeAttribute('aria-valuenow');
        bar.style.width = '';
        return;
      }
      const percent = Math.max(0, Math.min(1, fraction)) * 100;
      element.classList.remove('progress--indeterminate');
      element.setAttribute('aria-valuenow', String(Math.round(percent)));
      bar.style.width = `${percent}%`;
    },
  };
}

/** A few shimmering rows shown while results are being prepared. */
export function createSkeleton(rows = 3) {
  return el(
    'div',
    { class: 'skeleton-list', 'aria-hidden': 'true' },
    Array.from({ length: rows }, () => el('div', { class: 'skeleton', style: { height: '44px', marginTop: '8px' } })),
  );
}
