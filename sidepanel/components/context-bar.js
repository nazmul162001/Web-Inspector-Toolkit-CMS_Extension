/** Shows which tab the tools will inspect, and whether it can be inspected. */

import { el, setChildren } from '../../shared/helpers.js';
import { icon } from './icons.js';

/** @param {HTMLElement} container */
export function createContextBar(container) {
  function render(tabContext) {
    const tab = tabContext?.tab;
    if (!tab) {
      setChildren(
        container,
        icon('globe', { className: 'context-bar__favicon' }),
        el('div', { class: 'context-bar__text' }, el('span', { class: 'context-bar__title' }, 'No active tab')),
      );
      return;
    }

    let host = tab.url;
    try {
      host = new URL(tab.url).host || tab.url;
    } catch {
      /* keep raw url */
    }
    const favicon = tab.favIconUrl && /^https?:/.test(tab.favIconUrl)
      ? el('img', {
          class: 'context-bar__favicon',
          src: tab.favIconUrl,
          alt: '',
          onError: (event) => event.target.replaceWith(icon('globe', { className: 'context-bar__favicon' })),
        })
      : icon('globe', { className: 'context-bar__favicon' });

    setChildren(
      container,
      favicon,
      el(
        'div',
        { class: 'context-bar__text', title: tab.url },
        el('span', { class: 'context-bar__title', 'data-i18n-skip': true }, tab.title || host),
        el('span', { class: 'context-bar__url', 'data-i18n-skip': true }, host),
      ),
      tabContext.restricted
        ? el('span', { class: 'badge', title: tabContext.restrictionReason || '' }, 'Not inspectable')
        : null,
    );
  }

  return { render };
}
