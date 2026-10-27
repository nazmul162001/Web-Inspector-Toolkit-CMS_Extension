/**
 * One expandable result card. The collapsed header is cheap; the detailed
 * body (element, color, location, CSS source, actions) is only built the
 * first time the card is expanded, which keeps thousands of results fast.
 *
 * Every page-derived string goes through el()/textContent - never innerHTML.
 */

import { SECTION_LABELS } from '../../../shared/constants.js';
import { el } from '../../../shared/helpers.js';
import { icon } from '../../components/icons.js';
import { describeSourceLocation } from './color-find-utils.js';

const DASH = '—';

const swatchStyle = ({ r, g, b, a }) => `rgba(${r}, ${g}, ${b}, ${a / 255})`;

function kv(label, value, { mono = false } = {}) {
  const content =
    value instanceof Node ? value : el(mono ? 'code' : 'span', { class: mono ? 'kv__code' : '' }, value || DASH);
  return el('div', { class: 'kv' }, el('dt', {}, label), el('dd', {}, content));
}

function section(title, ...rows) {
  return el('section', { class: 'rcard__section' }, el('h4', {}, title), el('dl', {}, rows.filter(Boolean)));
}

/* ----------------------------------------------------------- Card sections */

function elementSection(item) {
  const { element } = item;
  return section(
    'Element',
    kv('Tag', `<${element.tag}>`, { mono: true }),
    kv('ID', element.id ? `#${element.id}` : '', { mono: true }),
    kv(
      'Classes',
      element.classes.length
        ? el('span', { class: 'chips' }, element.classes.map((name) => el('code', { class: 'chip' }, name)))
        : '',
    ),
    kv('Selector', element.selector, { mono: true }),
    kv('Path', element.path, { mono: true }),
    kv('Description', element.description, { mono: true }),
  );
}

function colorSection(item) {
  const { match } = item;
  return section(
    'Color',
    kv('Property', match.property, { mono: true }),
    kv('Computed', match.computed, { mono: true }),
    kv(
      'Normalized',
      el(
        'span',
        { class: 'kv__inline' },
        el('span', { class: 'swatch swatch--lg', style: { '--swatch': swatchStyle(match.color.rgba) } }),
        el('code', { class: 'kv__code' }, match.color.hex),
      ),
    ),
    kv('Alpha', String(match.color.alpha), { mono: true }),
  );
}

function locationSection(item) {
  const { element, page } = item;
  const { location } = element;
  const parent = location.parent;
  return section(
    'Location',
    kv('Page URL', page.url, { mono: true }),
    kv('Page title', page.title),
    kv('Parent', parent ? parent.selector : '', { mono: true }),
    kv('Section', SECTION_LABELS[location.section] || location.section),
    kv('Section name', location.sectionName, { mono: true }),
    kv('Ancestors', location.ancestors.length ? location.ancestors.join('  ‹  ') : '', { mono: true }),
    element.rendered === false
      ? kv('Visibility', 'Not rendered (display: none or zero size) - it cannot be highlighted.')
      : null,
  );
}

function sourceBody(item) {
  const { source, sourceStatus } = item.match;

  if (!source) {
    const blocked = item.page.stats?.stylesheets?.inaccessible || [];
    if (sourceStatus === 'unavailable') {
      return el(
        'div',
        { class: 'notice notice--warn' },
        el('strong', {}, 'Source information unavailable. '),
        `${blocked.length} stylesheet${blocked.length === 1 ? '' : 's'} on this page could not be read ` +
          '(cross-origin restrictions), and no readable rule explains this color.',
        el('ul', { class: 'plain-list' }, blocked.slice(0, 5).map((s) => el('li', {}, el('code', {}, s.label)))),
      );
    }
    return el(
      'div',
      { class: 'notice notice--info' },
      'No author CSS rule that produces this color could be verified. It may be a browser default, ' +
        'or come from a value that cannot be resolved here (for example color-mix()).',
    );
  }

  const lineNote = source.origin === 'inline'
    ? null
    : kv(
        'Line',
        source.line
          ? `${source.line}${source.lineBase === 'style-element' ? ' (within the <style> block)' : ''}`
          : 'Not available (could not be located reliably)',
        { mono: !!source.line },
      );

  return el(
    'dl',
    {},
    kv(
      'Stylesheet',
      source.origin === 'inline'
        ? 'Inline style attribute'
        : el(
            'span',
            { class: 'kv__stack' },
            el('span', {}, source.stylesheetLabel),
            source.stylesheetUrl && source.stylesheetUrl !== source.stylesheetLabel
              ? el('code', { class: 'kv__code kv__dim' }, source.stylesheetUrl)
              : null,
          ),
    ),
    kv('Selector', source.selector, { mono: true }),
    kv('Property', source.property, { mono: true }),
    kv('Declaration', source.declaration, { mono: true }),
    source.cssVariable
      ? kv(
          'CSS variable',
          el(
            'span',
            { class: 'kv__stack' },
            el('code', { class: 'kv__code' }, `${source.cssVariable.name}: ${source.cssVariable.value}`),
            source.cssVariable.definition
              ? el(
                  'span',
                  { class: 'kv__dim' },
                  `defined by ${source.cssVariable.definition.selector}` +
                    (source.cssVariable.definition.stylesheetLabel ? ` in ${source.cssVariable.definition.stylesheetLabel}` : ''),
                )
              : null,
          ),
        )
      : null,
    lineNote,
    source.conditions.length ? kv('Applies in', source.conditions.join(' › '), { mono: true }) : null,
    source.inheritedFrom ? kv('Inherited from', source.inheritedFrom, { mono: true }) : null,
    source.via === 'currentColor' ? kv('Note', 'Follows the element text color (currentColor).') : null,
  );
}

function sourceSection(item) {
  const { source } = item.match;
  const summary = source ? describeSourceLocation(source) : 'Not available';
  return el(
    'details',
    { class: 'rcard__section rcard__source' },
    el('summary', {}, el('h4', {}, 'CSS source'), el('span', { class: 'rcard__source-hint' }, summary)),
    sourceBody(item),
  );
}

function actionsRow(item, onAction) {
  const { source } = item.match;
  const button = (label, action, { iconName, disabled = false, primary = false } = {}) =>
    el(
      'button',
      {
        class: `btn btn--sm${primary ? ' btn--primary' : ''}`,
        type: 'button',
        disabled,
        onClick: () => onAction(action, item),
      },
      icon(iconName, { size: 13 }),
      label,
    );

  return el(
    'div',
    { class: 'rcard__actions' },
    button('Highlight', 'highlight', { iconName: 'eye', primary: true, disabled: item.element.rendered === false }),
    button('Scroll to', 'scroll', { iconName: 'scroll', disabled: item.element.rendered === false }),
    button('Copy HEX', 'copy-hex', { iconName: 'copy' }),
    button('Copy selector', 'copy-selector', { iconName: 'copy' }),
    button('Copy classes', 'copy-classes', { iconName: 'copy', disabled: item.element.classes.length === 0 }),
    button('Copy stylesheet URL', 'copy-stylesheet', { iconName: 'link', disabled: !source?.stylesheetUrl }),
  );
}

/* -------------------------------------------------------------------- Card */

/**
 * @param {object} item flattened result item (see color-find-utils.flattenScanResult)
 * @param {{ onAction: (action: string, item: object) => void, expanded?: boolean, onToggle?: (key: string, open: boolean) => void }} options
 */
export function createResultCard(item, { onAction, expanded = false, onToggle }) {
  const { element, match } = item;
  let bodyBuilt = false;

  const selectorRest = element.selector.slice(element.tag.length);
  const header = el(
    'button',
    { class: 'rcard__head', type: 'button', 'aria-expanded': 'false' },
    el('span', { class: 'swatch', style: { '--swatch': swatchStyle(match.color.rgba) } }),
    el(
      'span',
      { class: 'rcard__main' },
      el(
        'span',
        { class: 'rcard__title' },
        el('span', { class: 'tag-chip' }, element.tag),
        selectorRest
          ? el('code', { class: 'rcard__selector' }, selectorRest)
          : el('span', { class: 'rcard__selector rcard__selector--none' }, 'no id or class'),
      ),
      el(
        'span',
        { class: 'rcard__meta' },
        el('span', { class: 'prop' }, match.property),
        el('code', { class: 'hex' }, match.color.hex),
        match.source?.cssVariable ? el('span', { class: 'pill' }, match.source.cssVariable.name) : null,
        element.rendered === false ? el('span', { class: 'pill pill--muted' }, 'hidden') : null,
      ),
    ),
    icon('chevron', { size: 14, className: 'rcard__chev' }),
  );

  const quick = el(
    'button',
    {
      class: 'icon-btn rcard__quick',
      type: 'button',
      title: element.rendered === false ? 'Element is not rendered' : 'Highlight on page',
      'aria-label': 'Highlight on page',
      disabled: element.rendered === false,
      onClick: () => onAction('highlight', item),
    },
    icon('eye'),
  );

  const body = el('div', { class: 'rcard__body', hidden: true });
  const card = el(
    'article',
    { class: 'rcard', dataset: { key: item.key } },
    el('div', { class: 'rcard__bar' }, header, quick),
    body,
  );

  function setOpen(open) {
    header.setAttribute('aria-expanded', String(open));
    card.classList.toggle('rcard--open', open);
    body.hidden = !open;
    if (open && !bodyBuilt) {
      bodyBuilt = true;
      body.append(...[elementSection(item), colorSection(item), locationSection(item), sourceSection(item), actionsRow(item, onAction)].filter(Boolean));
    }
    onToggle?.(item.key, open);
  }

  header.addEventListener('click', () => setOpen(header.getAttribute('aria-expanded') !== 'true'));
  if (expanded) setOpen(true);

  return card;
}
