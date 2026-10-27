/** Extension header: icon, name, version indicator, settings placeholder. */

import { APP_NAME } from '../../shared/constants.js';
import { el } from '../../shared/helpers.js';
import { icon } from './icons.js';

/**
 * @param {HTMLElement} container
 * @param {{ version: string, onSettings: () => void }} options
 */
export function renderHeader(container, { version, onSettings }) {
  container.replaceChildren(
    el(
      'div',
      { class: 'brand' },
      el('img', { class: 'brand__logo', src: '../icons/icon48.png', alt: '', width: 26, height: 26 }),
      el('h1', { class: 'brand__title' }, APP_NAME),
      el('span', { class: 'badge', title: `Version ${version}` }, `v${version}`),
    ),
    el(
      'button',
      {
        class: 'icon-btn',
        type: 'button',
        title: 'Settings (coming soon)',
        'aria-label': 'Settings (coming soon)',
        onClick: onSettings,
      },
      icon('settings'),
    ),
  );
}
