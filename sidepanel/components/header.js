/** Extension header: icon, name, version, the dark / light switch and the English / Japanese switch. */

import { APP_NAME } from '../../shared/constants.js';
import { el } from '../../shared/helpers.js';
import { LANGUAGES } from '../../services/i18n.js';
import { oppositeTheme } from '../../services/theme.js';
import { icon } from './icons.js';

/**
 * @param {HTMLElement} container
 * @param {{ version: string, language: string, onLanguage: (language: string) => void,
 *           shownTheme?: 'dark'|'light', onTheme?: (next: 'dark'|'light') => void }} options
 * @returns {{ setActive: (language: string) => void, setTheme: (shown: 'dark'|'light') => void }}
 */
export function renderHeader(container, { version, language, onLanguage, shownTheme = 'dark', onTheme = () => {} }) {
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

  // The button shows where it leads: a sun while dark (switch to light), a moon while light (switch to dark).
  let shown = shownTheme;
  const themeButton = el('button', { class: 'theme-toggle', type: 'button', onClick: () => onTheme(oppositeTheme(shown)) });
  function setTheme(next) {
    shown = next === 'light' ? 'light' : 'dark';
    const label = shown === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    themeButton.replaceChildren(icon(shown === 'dark' ? 'sun' : 'moon', { size: 16 }));
    themeButton.setAttribute('title', label);
    themeButton.setAttribute('aria-label', label);
    themeButton.dataset.theme = shown;
  }
  setTheme(shown);

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
      el('span', { class: 'brand__version', title: `Version ${version}` }, `v${version}`),
    ),
    el('div', { class: 'header-actions' }, themeButton, group),
  );
  return { setActive, setTheme };
}
