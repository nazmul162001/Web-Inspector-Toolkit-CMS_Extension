/**
 * One expandable Text Find result card. The header shows the match inside its
 * surrounding text; the detailed body is only built when first expanded.
 *
 * Page-derived strings only ever go through el()/textContent.
 */

import { el } from '../../../shared/helpers.js';
import { icon } from '../../components/icons.js';
import { labelsOf, shortLabelsOf } from '../../../services/width-matcher.js';
import { elementSection, kv, locationSection, section, sourceSection } from '../color-find/color-result-card.js';

/** `…before [match] after…` with the match emphasised. */
export function snippetNode(match, { className = 'tsnip', markClass = 'tmark' } = {}) {
  return el(
    'span',
    { class: className },
    match.moreBefore ? '…' : '',
    match.before,
    el('mark', { class: markClass }, match.text),
    match.after,
    match.moreAfter ? '…' : '',
  );
}

/* ------------------------------------------------------------ Font cards */

const quoteName = (name) => (/[\s,'"]/.test(name) ? `"${name}"` : name);
const ordinal = (n) => ({ 1: '1st', 2: '2nd', 3: '3rd' })[n] || `${n}th`;

/** The font list with the searched font marked: `Roboto, "Noto Sans JP", sans-serif`. */
function fontStackNode(match, className) {
  const wanted = new Set(match.matched);
  const parts = [];
  match.families.forEach((name, i) => {
    if (i) parts.push(', ');
    parts.push(wanted.has(name) ? el('mark', { class: 'tmark' }, quoteName(name)) : quoteName(name));
  });
  return el('span', { class: className }, ...parts);
}

const FACE_NOTES = {
  'font-face': 'Loaded by an @font-face rule on this page.',
  'google-fonts': 'Loaded from a Google Fonts stylesheet linked on this page.',
  generic: 'A generic family: the browser picks the actual font.',
  none: 'No @font-face rule or Google Fonts link was found for it. It is a font installed on the visitor\'s device, or comes from a source this page does not show.',
  unreadable: 'No @font-face rule was found, but some stylesheets could not be read, so a web font may still exist.',
};

function fontSection(item) {
  const { match } = item;
  const position = `${ordinal(match.position)} of ${match.families.length}`;
  return section(
    'Match',
    kv('Found in', 'Font list (font-family)'),
    kv('Matched font', match.matched.join(', '), { mono: true }),
    kv('Place in the list', match.position === 1 ? `${position} - the first choice` : `${position} - a fallback; earlier fonts are tried first`),
    kv('Font list', fontStackNode(match, 'tsnip tsnip--full tsnip--mono')),
    kv('Applied', match.inherited ? 'Inherited from a parent element' : 'Set on this element'),
  );
}

function fontFileSection(item) {
  const { face } = item.match;
  if (!face) return null;
  return section(
    'Font file',
    kv('Source', FACE_NOTES[face.status] || ''),
    face.status === 'font-face' && face.stylesheetLabel ? kv('Declared in', face.stylesheetLabel) : null,
    ...face.files.map((file) =>
      kv(
        file.format ? `File (${file.format})` : 'File',
        el(
          'span',
          { class: 'kv__stack' },
          el('code', { class: 'kv__code' }, file.url),
          file.weight || file.style ? el('span', { class: 'kv__dim' }, [file.style, file.weight && `weight ${file.weight}`].filter(Boolean).join(', ')) : null,
        ),
      ),
    ),
    face.google && face.status !== 'google-fonts' ? kv('Also', 'A Google Fonts stylesheet on this page lists this family.') : null,
  );
}

/* ------------------------------------------------- Half/Full width cards */

/** A run of ideographic spaces is invisible: show it as a visible box. */
const visibleSpaces = (text) => text.replace(/\u3000/g, '□');

function widthSection(item) {
  const { match } = item;
  const form = match.replacementForm === 'half' ? 'half-width' : 'full-width';
  const found = { ...match, text: visibleSpaces(match.text), before: match.before, after: match.after };
  return section(
    'Match',
    kv('Found in', 'Page text'),
    kv('Found', visibleSpaces(match.text), { mono: true }),
    kv('Kind', labelsOf(match.kinds).join(', ')),
    kv('Character codes', match.codes.join(',  '), { mono: true }),
    match.replacement !== match.text ? kv(`As ${form}`, match.replacement, { mono: true }) : null,
    kv('Context', snippetNode(found, { className: 'tsnip tsnip--full', markClass: 'tmark tmark--red' })),
  );
}

const HREF_FOUND_IN = {
  href: 'Link (href attribute)',
  formaction: 'Button / form submit (formaction)',
  action: 'Form action',
  onclick: 'Click handler (onclick)',
};

const FOUND_IN = (match) => {
  if (match.kind === 'href') return HREF_FOUND_IN[match.attribute] || `Data attribute "${match.attribute}"`;
  if (match.kind === 'attribute') return `Attribute "${match.attribute}"`;
  if (match.kind === 'link') return 'Phone link (tel:)';
  return 'Text content';
};

function matchSection(item) {
  const { match } = item;
  if (match.kind === 'font') return fontSection(item);
  if (match.kind === 'width') return widthSection(item);
  if (match.kind === 'href') {
    return section(
      'Match',
      kv('Found in', FOUND_IN(match)),
      kv('Link value', snippetNode(match, { className: 'tsnip tsnip--full tsnip--mono' })),
      match.resolved && match.resolved !== match.text ? kv('Full address', match.resolved, { mono: true }) : null,
      match.label ? kv('Link text', match.label) : null,
    );
  }
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
        match.kind === 'attribute' || (match.kind === 'href' && match.attribute !== 'href') ? el('span', { class: 'pill' }, match.attribute) : null,
        match.kind === 'width' ? el('span', { class: 'pill' }, shortLabelsOf(match.kinds)[0] + (match.kinds.length > 1 ? ` +${match.kinds.length - 1}` : '')) : null,
        match.kind === 'font' && match.position > 1 ? el('span', { class: 'pill' }, `fallback ${ordinal(match.position)}`) : null,
        match.kind === 'font' && match.inherited ? el('span', { class: 'pill pill--muted' }, 'inherited') : null,
        match.kind === 'link' ? el('span', { class: 'pill' }, 'tel link') : null,
        hidden ? el('span', { class: 'pill pill--muted' }, 'hidden') : null,
      ),
      match.kind === 'font'
        ? fontStackNode(match, 'tsnip tsnip--mono')
        : snippetNode({ ...match, text: match.kind === 'width' ? visibleSpaces(match.text) : match.text }, {
            className: match.kind === 'href' ? 'tsnip tsnip--mono' : 'tsnip',
            markClass: match.kind === 'width' ? 'tmark tmark--red' : 'tmark',
          }),
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
      body.append(
        ...(match.kind === 'font'
          ? [matchSection(item), fontFileSection(item), elementSection(item), locationSection(item), sourceSection(item, { noun: 'font' }), actionsRow(item, onAction, copyLabel)]
          : [matchSection(item), elementSection(item), locationSection(item), actionsRow(item, onAction, copyLabel)]
        ).filter(Boolean),
      );
    }
    onToggle?.(item.key, open);
  }

  header.addEventListener('click', () => setOpen(header.getAttribute('aria-expanded') !== 'true'));
  if (expanded) setOpen(true);
  return card;
}
