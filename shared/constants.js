/**
 * Shared constants. Imported by the side panel, the service worker and the
 * content scripts, so this file must stay free of any `chrome.*` / DOM access.
 */

export const APP_NAME = 'Web Inspector Toolkit';

/* ---------------------------------------------------------------- Scopes */

export const SCOPE = Object.freeze({
  PAGE: 'page',
  SITE: 'site',
});

/* -------------------------------------------------------------- Features */

export const FEATURE_STATUS = Object.freeze({
  ACTIVE: 'active',
  SOON: 'soon',
});

/**
 * Feature registry (metadata only). Adding a tool = add an entry here, add an
 * icon in sidepanel/components/icons.js and register a loader in
 * sidepanel/features/registry.js.
 */
export const FEATURES = Object.freeze([
  { id: 'color-find', label: 'Color Find', icon: 'palette', status: FEATURE_STATUS.ACTIVE },
  { id: 'text-find', label: 'Text Find', icon: 'text-search', status: FEATURE_STATUS.ACTIVE },
  { id: 'telephone', label: 'Telephone Number', icon: 'phone', status: FEATURE_STATUS.ACTIVE },
  { id: 'width-text', label: 'Half/Full Width Text', icon: 'width', status: FEATURE_STATUS.SOON },
  { id: 'image-resolution', label: 'Image Resolution', icon: 'image', status: FEATURE_STATUS.SOON },
  { id: 'font-find', label: 'Font Find', icon: 'font', status: FEATURE_STATUS.SOON },
]);

/* -------------------------------------------------------------- Messages */

/** Every message type used anywhere in the extension. */
export const MSG = Object.freeze({
  // side panel -> background
  GET_TAB_CONTEXT: 'wit/get-tab-context',
  CHECK_ACCESS: 'wit/check-access',
  SCAN_PAGE: 'wit/scan-page',
  SCAN_SITE: 'wit/scan-site',
  CANCEL_SCAN: 'wit/cancel-scan',
  HIGHLIGHT: 'wit/highlight',

  // background -> side panel (events)
  TAB_CONTEXT_CHANGED: 'wit/tab-context-changed',
  SCAN_PROGRESS: 'wit/scan-progress',
  SCAN_PAGE_RESULT: 'wit/scan-page-result', // one finished page of an Entire Site scan, streamed as it completes

  // background -> offscreen document (invisible page renderer for Entire Site)
  OFFSCREEN_PING: 'wit/offscreen/ping',
  OFFSCREEN_SCAN_URL: 'wit/offscreen/scan-url',
  OFFSCREEN_CANCEL: 'wit/offscreen/cancel',

  // background -> content script
  CONTENT_PING: 'wit/content/ping',
  CONTENT_SCAN: 'wit/content/scan',
  CONTENT_CANCEL: 'wit/content/cancel',
  CONTENT_HIGHLIGHT: 'wit/content/highlight',

  // content script -> extension (events)
  CONTENT_PROGRESS: 'wit/content/progress',
});

export const SESSION_PORT_PREFIX = 'wit-session:';

/* ---------------------------------------------------------------- Errors */

export const ERR = Object.freeze({
  INVALID_REQUEST: 'INVALID_REQUEST',
  NO_TAB: 'NO_TAB',
  RESTRICTED_PAGE: 'RESTRICTED_PAGE',
  FILE_ACCESS: 'FILE_ACCESS',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NO_RECEIVER: 'NO_RECEIVER',
  PORT_CLOSED: 'PORT_CLOSED',
  NO_RESPONSE: 'NO_RESPONSE',
  STALE_RESPONSE: 'STALE_RESPONSE',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  LOAD_FAILED: 'LOAD_FAILED',
  HTTP_ERROR: 'HTTP_ERROR',
  REDIRECTED_OFFSITE: 'REDIRECTED_OFFSITE',
  NOT_HTML: 'NOT_HTML',
  NOT_FOUND: 'NOT_FOUND',
  NOT_VISIBLE: 'NOT_VISIBLE',
  INJECTION_FAILED: 'INJECTION_FAILED',
  UNKNOWN: 'UNKNOWN',
});

/* ------------------------------------------------------------------ Scan */

export const MESSAGE_TIMEOUT_MS = 15000;
export const PAGE_SCAN_TIMEOUT_MS = 90000;

export const SCAN_LIMITS = Object.freeze({
  /** Hard cap on collected matches per page (protects memory + messaging). */
  MAX_MATCHES_PER_PAGE: 5000,
  /** Time-slice budget before the scanner yields to the page. */
  BATCH_BUDGET_MS: 12,
  /** Cap on internal links a single page may report. */
  MAX_LINKS_PER_PAGE: 3000,
  /** Cap on stylesheet line-number lookups per scan. */
  MAX_LINE_LOOKUPS: 400,
  MAX_DESCRIPTION_LENGTH: 160,
  MAX_TEXT_SNIPPET_LENGTH: 60,
});

export const MATCH_MODE = Object.freeze({
  EXACT: 'exact',
  NEAR: 'near',
});

/** Per-channel tolerance (0-255 units) used by the "Near" match mode. */
export const NEAR_TOLERANCE = 4;

/**
 * How Entire Site loads the other pages:
 *  - BACKGROUND: invisible. The HTML is fetched and rendered with its CSS in a
 *    hidden offscreen document - no tab or window is ever opened. The page's
 *    JavaScript is NOT run (static HTML + CSS).
 *  - TABS: each page is opened in a temporary background tab so its
 *    JavaScript runs too (visible as a short-lived tab).
 */
export const CRAWL_MODE = Object.freeze({
  BACKGROUND: 'background',
  TABS: 'tabs',
});

export const DEFAULT_CRAWL_OPTIONS = Object.freeze({
  mode: CRAWL_MODE.BACKGROUND,
  // Entire Site checks every page it can reach; this is only a runaway guard
  // (infinite calendars, faceted search ...) and is reported when hit.
  maxPages: 2000,
  concurrency: 12,
  pageTimeoutMs: 20000,
  retries: 1,
  renderDelayMs: 500,
});

export const CRAWL_LIMITS = Object.freeze({
  maxPages: { min: 1, max: 5000 },
  concurrency: { min: 1, max: 16 },
  pageTimeoutMs: { min: 5000, max: 120000 },
  retries: { min: 0, max: 3 },
  renderDelayMs: { min: 0, max: 5000 },
});

export const STORAGE_KEYS = Object.freeze({
  SETTINGS: 'wit.settings',
  TEMP_TABS: 'wit.tempTabs',
});

/* ------------------------------------------------------ Color properties */

export const PROPERTY_GROUP = Object.freeze({
  TEXT: 'text',
  BACKGROUND: 'background',
  BORDER: 'border',
  SVG: 'svg',
  SHADOW: 'shadow',
});

export const PROPERTY_GROUP_LABELS = Object.freeze({
  text: 'Text',
  background: 'Background',
  border: 'Border & outline',
  svg: 'SVG',
  shadow: 'Shadow',
});

const border = (side) => ({
  property: `border-${side}-color`,
  group: PROPERTY_GROUP.BORDER,
  gate: { type: 'line', style: `border-${side}-style`, width: `border-${side}-width` },
  currentColorDefault: true,
});

/**
 * Descriptors for every color-bearing computed property that is inspected.
 *
 * Why the `gate`s exist: many properties default to `currentcolor`, so their
 * computed value equals the text color on *every* element even though nothing
 * is painted (e.g. `border-top-color` with `border-style: none`). A gate makes
 * the scanner report a property only when it actually paints something.
 *
 *  - `line`:    needs a non-`none` style and a non-zero width
 *  - `nonNone`: needs the named property to be something other than `none`
 *
 * `inherited` properties are skipped when they merely repeat the parent's
 * value (unless "include inherited values" is on), otherwise every descendant
 * of a text-colored container would be reported.
 *
 * `svgTags` restricts presentation properties that exist on every SVG element
 * but are only meaningful on specific ones.
 */
export const COLOR_PROPERTIES = Object.freeze([
  // Text
  { property: 'color', group: PROPERTY_GROUP.TEXT, inherited: true },
  {
    property: 'text-decoration-color',
    group: PROPERTY_GROUP.TEXT,
    gate: { type: 'nonNone', property: 'text-decoration-line' },
    currentColorDefault: true,
  },
  {
    property: 'text-emphasis-color',
    group: PROPERTY_GROUP.TEXT,
    inherited: true,
    gate: { type: 'nonNone', property: 'text-emphasis-style' },
    currentColorDefault: true,
  },
  { property: 'caret-color', group: PROPERTY_GROUP.TEXT, inherited: true, gate: { type: 'caret' } },

  // Background
  { property: 'background-color', group: PROPERTY_GROUP.BACKGROUND },

  // Borders & outlines
  border('top'),
  border('right'),
  border('bottom'),
  border('left'),
  {
    property: 'outline-color',
    group: PROPERTY_GROUP.BORDER,
    gate: { type: 'line', style: 'outline-style', width: 'outline-width' },
    currentColorDefault: true,
  },
  {
    property: 'column-rule-color',
    group: PROPERTY_GROUP.BORDER,
    gate: { type: 'line', style: 'column-rule-style', width: 'column-rule-width' },
    currentColorDefault: true,
  },

  // SVG
  { property: 'fill', group: PROPERTY_GROUP.SVG, inherited: true, svgOnly: true },
  { property: 'stroke', group: PROPERTY_GROUP.SVG, inherited: true, svgOnly: true },
  { property: 'stop-color', group: PROPERTY_GROUP.SVG, svgTags: ['stop'] },
  { property: 'flood-color', group: PROPERTY_GROUP.SVG, svgTags: ['feflood', 'fedropshadow'] },
  {
    property: 'lighting-color',
    group: PROPERTY_GROUP.SVG,
    svgTags: ['fediffuselighting', 'fespecularlighting'],
  },

  // Shadows (values contain one or more colors among lengths / keywords)
  { property: 'box-shadow', group: PROPERTY_GROUP.SHADOW },
  { property: 'text-shadow', group: PROPERTY_GROUP.SHADOW, inherited: true },
]);

/**
 * Shorthands that can carry a color for one of the properties above.
 * Used when reading CSSOM source declarations (stylesheet-scanner.js).
 */
export const SHORTHAND_TO_LONGHANDS = Object.freeze({
  background: ['background-color'],
  border: ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-top': ['border-top-color'],
  'border-right': ['border-right-color'],
  'border-bottom': ['border-bottom-color'],
  'border-left': ['border-left-color'],
  'border-block': ['border-top-color', 'border-bottom-color'],
  'border-block-color': ['border-top-color', 'border-bottom-color'],
  'border-block-start': ['border-top-color'],
  'border-block-end': ['border-bottom-color'],
  'border-block-start-color': ['border-top-color'],
  'border-block-end-color': ['border-bottom-color'],
  'border-inline': ['border-left-color', 'border-right-color'],
  'border-inline-color': ['border-left-color', 'border-right-color'],
  'border-inline-start': ['border-left-color', 'border-right-color'],
  'border-inline-end': ['border-left-color', 'border-right-color'],
  'border-inline-start-color': ['border-left-color', 'border-right-color'],
  'border-inline-end-color': ['border-left-color', 'border-right-color'],
  outline: ['outline-color'],
  'column-rule': ['column-rule-color'],
  'text-decoration': ['text-decoration-color'],
  'text-emphasis': ['text-emphasis-color'],
});

/* ------------------------------------------------------------ DOM / page */

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elements whose subtree is never inspected. */
export const SKIPPED_TAGS = new Set([
  'script', 'style', 'meta', 'link', 'head', 'title', 'noscript', 'template', 'base',
]);

export const SECTION = Object.freeze({
  HEADER: 'header',
  MAIN: 'main',
  FOOTER: 'footer',
  OTHER: 'other',
});

export const SECTION_LABELS = Object.freeze({
  header: 'Header',
  main: 'Main Content',
  footer: 'Footer',
  other: 'Other',
});

export const SECTION_ORDER = Object.freeze(['header', 'main', 'footer', 'other']);

export const HIGHLIGHT_DURATION_MS = 2800;
export const HIGHLIGHT_HOST_ID = '__wit-highlight-host__';
