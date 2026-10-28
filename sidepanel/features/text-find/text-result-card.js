/**
 * One expandable Text Find result card. The header shows the match inside its
 * surrounding text; the detailed body is only built when first expanded.
 *
 * Page-derived strings only ever go through el()/textContent.
 */

import { el } from '../../../shared/helpers.js';
import { icon } from '../../components/icons.js';
import { elementSection, kv, locationSection, section } from '../color-find/color-result-card.js';

/** `…before [match] after…` with the match emphasised. */
export function snippetNode(match, { className = 'tsnip' } = {}) {
  return el(
    'span',
    { class: className },
    match.moreBefore ? '…' : '',
    match.before,
    el('mark', { class: 'tmark' }, match.text),
    match.after,
    match.moreAfter ? '…' : '',
  );
}

const FOUND_IN = (match) => {
  if (match.kind === 'attribute') return `Attribute "${match.attribute}"`;
  if (match.kind === 'link') return 'Phone link (tel:)';
  return 'Text content';
};

function matchSection(item) {
  const { match } = item;
  return section(
    'Match',
    kv('Found in', FOUND_IN(match)),
    kv(match.kind === 'link' ? 'Link value' : 'Matched text', match.text, { mono: true }),
    kv('Context', snippetNode(match, { className: 'tsnip tsnip--full' })),
  );
}

function actionsRow(item, onAction, copyLabel) {
  const button = (label, action, { iconName, disabled = false, primary = false } = {}) =>
    el(
      'button',
      { class: `btn btn--sm${primary ? ' btn--primary' : ''}`, type: 'button', disabled, onClick: () => onAction(action, item) },
      icon(iconName, { size: 13 }),
      label,
    );
  const hidden = item.element.rendered === false;
  return el(
    'div',
    { class: 'rcard__actions' },
    button('Highlight', 'highlight', { iconName: 'eye', primary: true, disabled: hidden }),
    button('Scroll to', 'scroll', { iconName: 'scroll', disabled: hidden }),
    button(copyLabel, 'copy-text', { iconName: 'copy' }),
    button('Copy selector', 'copy-selector', { iconName: 'copy' }),
    button('Copy classes', 'copy-classes', { iconName: 'copy', disabled: item.element.classes.length === 0 }),
  );
}

/**
 * @param {object} item flattened result item (see text-find-utils.flattenTextResult)
 * @param {{ onAction: (action: string, item: object) => void, expanded?: boolean, onToggle?: (key: string, open: boolean) => void }} options
 */
export function createTextResultCard(item, { onAction, expanded = false, onToggle, copyLabel = 'Copy text' }) {
  const { element, match } = item;
  let bodyBuilt = false;
  const hidden = element.rendered === false;
  const selectorRest = element.selector.slice(element.tag.length);

  const header = el(
    'button',
    { class: 'rcard__head rcard__head--text', type: 'button', 'aria-expanded': 'false' },
    el(
      'span',
      { class: 'rcard__main' },
      el(
        'span',
        { class: 'rcard__title' },
        el('span', { class: 'tag-chip' }, element.tag),
        selectorRest ? el('code', { class: 'rcard__selector' }, selectorRest) : null,
        match.kind === 'attribute' ? el('span', { class: 'pill' }, match.attribute) : null,
        match.kind === 'link' ? el('span', { class: 'pill' }, 'tel link') : null,
        hidden ? el('span', { class: 'pill pill--muted' }, 'hidden') : null,
      ),
      snippetNode(match),
    ),
    icon('chevron', { size: 14, className: 'rcard__chev' }),
  );

  const quick = el(
    'button',
    {
      class: 'icon-btn rcard__quick',
      type: 'button',
      title: hidden ? 'Element is not rendered' : 'Highlight on page',
      'aria-label': 'Highlight on page',
      disabled: hidden,
      onClick: () => onAction('highlight', item),
    },
    icon('eye'),
  );

  const body = el('div', { class: 'rcard__body', hidden: true });
  const card = el('article', { class: 'rcard', dataset: { key: item.key } }, el('div', { class: 'rcard__bar' }, header, quick), body);

  function setOpen(open) {
    header.setAttribute('aria-expanded', String(open));
    card.classList.toggle('rcard--open', open);
    body.hidden = !open;
    if (open && !bodyBuilt) {
      bodyBuilt = true;
      body.append(...[matchSection(item), elementSection(item), locationSection(item), actionsRow(item, onAction, copyLabel)].filter(Boolean));
    }
    onToggle?.(item.key, open);
  }

  header.addEventListener('click', () => setOpen(header.getAttribute('aria-expanded') !== 'true'));
  if (expanded) setOpen(true);
  return card;
}
