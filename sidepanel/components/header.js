/** Extension header: icon, name, version and the English / Japanese switch. */

import { APP_NAME } from '../../shared/constants.js';
import { el } from '../../shared/helpers.js';
import { LANGUAGES } from '../../services/i18n.js';

/**
 * @param {HTMLElement} container
 * @param {{ version: string, language: string, onLanguage: (language: string) => void }} options
 * @returns {{ setActive: (language: string) => void }}
 */
export function renderHeader(container, { version, language, onLanguage }) {
  const buttons = new Map();

  const group = el('div', { class: 'lang-switch', role: 'group', 'aria-label': 'Language' });
  for (const item of LANGUAGES) {
    const button = el(
      'button',
      {
        class: 'lang-switch__btn',
        type: 'button',
        lang: item.id,
        title: item.id === 'ja' ? 'Switch to Japanese' : 'Switch to English',
        onClick: () => onLanguage(item.id),
      },
      item.short,
    );
    buttons.set(item.id, button);
    group.append(button);
  }

  function setActive(active) {
    for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(id === active));
  }
  setActive(language);

  container.replaceChildren(
    el(
      'div',
      { class: 'brand' },
      el('img', { class: 'brand__logo', src: '../icons/icon48.png', alt: '', width: 26, height: 26 }),
      el('h1', { class: 'brand__title' }, APP_NAME),
      el('span', { class: 'badge', title: `Version ${version}` }, `v${version}`),
    ),
    group,
  );
  return { setActive };
}
