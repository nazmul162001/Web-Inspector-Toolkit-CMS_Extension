/**
 * Icons of the screenshot editor (24x24, stroke based, they take the colour of
 * the text). The editor lives in the page, so it cannot use the side panel's
 * icon set.
 */

const PATHS = {
  pen: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  line: '<path d="M5 19 19 5"/>',
  arrow: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
  ellipse: '<circle cx="12" cy="12" r="9"/>',
  rect: '<rect width="20" height="12" x="2" y="6" rx="2"/>',
  square: '<rect width="16" height="16" x="4" y="4" rx="2"/>',
  text: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  save: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPE = /<(\w+)([^>]*?)\/>/g;
const ATTRIBUTE = /([\w-]+)="([^"]*)"/g;

/**
 * An <svg> element for an icon name. The elements are made one by one (no
 * innerHTML), so pages that forbid HTML strings (Trusted Types) cannot break it.
 */
export function createIcon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attributes = { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
  for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, String(value));
  for (const [, tag, rest] of (PATHS[name] ?? '').matchAll(SHAPE)) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [, key, value] of rest.matchAll(ATTRIBUTE)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}
