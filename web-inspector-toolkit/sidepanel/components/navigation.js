/** Feature navigation: one tile per tool; "Coming Soon" tools are disabled. */

import { FEATURE_STATUS } from '../../shared/constants.js';
import { el } from '../../shared/helpers.js';
import { icon } from './icons.js';

/**
 * @param {HTMLElement} container
 * @param {{ features: readonly object[], activeId: string, onSelect: (id: string) => void }} options
 */
export function createFeatureNav(container, { features, activeId, onSelect }) {
  const buttons = new Map();

  for (const feature of features) {
    const soon = feature.status !== FEATURE_STATUS.ACTIVE;
    const button = el(
      'button',
      {
        class: 'feature-item',
        type: 'button',
        disabled: soon,
        dataset: { feature: feature.id },
        title: soon ? `${feature.label} - coming soon` : feature.label,
        'aria-label': soon ? `${feature.label} (coming soon)` : feature.label,
        onClick: () => onSelect(feature.id),
      },
      icon(feature.icon),
      el('span', { class: 'feature-item__label' }, feature.label),
      soon && el('span', { class: 'badge badge--soon' }, 'Soon'),
    );
    buttons.set(feature.id, button);
    container.append(button);
  }

  function setActive(id) {
    for (const [featureId, button] of buttons) {
      if (featureId === id) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }

  setActive(activeId);
  return { setActive };
}
