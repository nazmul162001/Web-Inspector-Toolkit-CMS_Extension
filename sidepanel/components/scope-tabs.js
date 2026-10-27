/**
 * "This Page | Entire Site" tabs. Switching scope never starts a scan; it only
 * notifies the active feature.
 */

import { SCOPE } from '../../shared/constants.js';
import { el } from '../../shared/helpers.js';

const TABS = [
  { id: SCOPE.PAGE, label: 'This Page' },
  { id: SCOPE.SITE, label: 'Entire Site' },
];

/**
 * @param {HTMLElement} container
 * @param {{ initial?: string, onChange: (scope: string) => void }} options
 */
export function createScopeTabs(container, { initial = SCOPE.PAGE, onChange }) {
  let current = initial;
  container.setAttribute('role', 'tablist');
  const buttons = new Map();

  function render() {
    for (const [id, button] of buttons) {
      const selected = id === current;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }

  function select(id, { focus = false, silent = false } = {}) {
    if (id === current) return;
    current = id;
    render();
    if (focus) buttons.get(id).focus();
    if (!silent) onChange(id);
  }

  for (const tab of TABS) {
    const button = el(
      'button',
      {
        class: 'scope-tab',
        type: 'button',
        role: 'tab',
        id: `scope-tab-${tab.id}`,
        onClick: () => select(tab.id),
        onKeydown: (event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const other = TABS.find((t) => t.id !== tab.id);
          select(other.id, { focus: true });
        },
      },
      tab.label,
    );
    buttons.set(tab.id, button);
    container.append(button);
  }

  render();
  return { get: () => current, set: (id) => select(id, { silent: true }) };
}
