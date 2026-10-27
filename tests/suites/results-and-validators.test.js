import { assert, describe, it } from '../test-runner.js';
import {
  buildSummary,
  collectFacets,
  declarationKey,
  describeCoverage,
  describeSourceLocation,
  filterItems,
  flattenScanResult,
  groupByPage,
  groupItems,
  sortItems,
} from '../../sidepanel/features/color-find/color-find-utils.js';
import {
  checkRestrictedUrl,
  isCanonicalColor,
  originPattern,
  parseScanRequest,
  sanitizeCrawlOptions,
  validateColorInput,
} from '../../shared/validators.js';
import { CRAWL_LIMITS, DEFAULT_CRAWL_OPTIONS } from '../../shared/constants.js';

const element = (elementId, tag, classes, section, domIndex, selector = tag) => ({
  elementId, tag, classes, domIndex, selector, location: { section },
});
const match = (elementId, property, group = 'text', source = null) => ({ elementId, property, group, source });

const scan = {
  pages: [{
    url: 'https://x.test/',
    elements: [
      element(1, 'footer', ['f'], 'footer', 30),
      element(2, 'div', ['hero', 'dark'], 'header', 5, 'div.hero'),
      element(3, 'p', ['dark'], 'main', 12, 'p.dark'),
      element(4, 'div', [], 'other', 40),
    ],
    matches: [
      match(1, 'color'),
      match(2, 'background-color', 'background', { origin: 'stylesheet', stylesheetLabel: 'a.css', line: 3, selector: '.hero', property: 'background-color', value: '#025743' }),
      match(2, 'color', 'text', { origin: 'inline' }),
      match(3, 'border-top-color', 'border'),
      match(99, 'color'), // orphan: no element record
    ],
  }],
};

describe('Result data helpers', () => {
  const items = flattenScanResult(scan);

  it('flattens matches joined to elements and drops orphans', () => {
    assert.equal(items.length, 4);
    assert.ok(items.every((i) => i.element && i.match));
  });

  it('summarizes elements, declarations, selectors and sections', () => {
    const s = buildSummary(items);
    assert.equal(s.elements, 3);
    assert.equal(s.declarations, 4);
    assert.equal(s.selectors, 3);
    assert.equal(s.sections, 3);
    assert.equal(s.withSource, 2);
  });

  it('sorts by DOM order by default, by property or tag on request', () => {
    assert.deepEqual(sortItems(items).map((i) => i.element.domIndex), [5, 5, 12, 30]);
    assert.equal(sortItems(items, 'tag')[0].element.tag, 'div');
    const byProp = sortItems(items, 'property').map((i) => i.match.property);
    assert.equal(byProp[0], 'color');
  });

  it('groups by section in fixed order (header, main, footer, other)', () => {
    const groups = groupItems(sortItems(items), 'section');
    assert.deepEqual(groups.map((g) => g.id), ['header', 'main', 'footer']);
    assert.deepEqual(groups.map((g) => g.label), ['Header', 'Main Content', 'Footer']);
  });

  it('groups by property and offers a flat mode', () => {
    const byProperty = groupItems(items, 'property');
    assert.ok(byProperty.some((g) => g.id === 'color' && g.items.length === 2));
    assert.equal(groupItems(items, 'none').length, 1);
  });

  it('filters by tag and class and collects facets', () => {
    assert.equal(filterItems(items, { tag: 'div' }).length, 2);
    assert.equal(filterItems(items, { cls: 'dark' }).length, 3);
    assert.equal(filterItems(items, { tag: 'p', cls: 'dark' }).length, 1);
    assert.equal(filterItems(items, {}).length, 4);
    const facets = collectFacets(items);
    assert.equal(facets.classes[0].value, 'dark');
    assert.equal(facets.classes[0].count, 3);
    assert.ok(facets.tags.some((t) => t.value === 'div' && t.count === 2));
  });

  it('groups by page for site scans', () => {
    const multi = flattenScanResult({ pages: [scan.pages[0], { ...scan.pages[0], url: 'https://x.test/b' }] });
    assert.equal(groupByPage(multi).length, 2);
  });

  it('describes source locations without inventing line numbers', () => {
    assert.equal(describeSourceLocation(null), '');
    assert.equal(describeSourceLocation({ origin: 'inline' }), 'Inline style attribute');
    assert.equal(describeSourceLocation({ origin: 'stylesheet', stylesheetLabel: 'a.css' }), 'a.css');
    assert.equal(describeSourceLocation({ origin: 'stylesheet', stylesheetLabel: 'a.css', line: 3 }), 'a.css:3');
    assert.ok(describeSourceLocation({ origin: 'stylesheet', stylesheetLabel: '<style> block', line: 3, lineBase: 'style-element' }).includes('of the block'));
  });

  it('builds a stable declaration key only when there is a source', () => {
    assert.equal(declarationKey(items[0]), null);
    assert.ok(declarationKey(items[1]).includes('.hero'));
  });

  it('describes coverage: complete, partial, limit and cancelled', () => {
    assert.equal(describeCoverage({ scope: 'page' }), null);
    const base = { scope: 'site', scanned: 5, discovered: 5, failed: 0, notScanned: 0, maxPages: 50, cancelled: false, limitReached: false };
    assert.equal(describeCoverage(base).state, 'complete');
    assert.equal(describeCoverage({ ...base, failed: 1 }).state, 'partial');
    assert.ok(describeCoverage({ ...base, limitReached: true, notScanned: 3 }).detail.includes('limit'));
    assert.ok(describeCoverage({ ...base, cancelled: true }).detail.includes('cancelled'));
  });
});

describe('Validators', () => {
  it('validates color input (accepts bare hex, rejects garbage)', () => {
    assert.ok(validateColorInput('#025743').ok);
    assert.ok(validateColorInput('025743').ok);
    assert.ok(validateColorInput('rgb(2, 87, 67)').ok);
    assert.ok(validateColorInput('hsla(120, 50%, 50%, .5)').ok);
    assert.ok(validateColorInput('rebeccapurple').ok);
    for (const bad of ['', '   ', '#12', '#gggggg', 'rgb(1,2)', 'notacolor', 'url(x)', 'var(--x)', 'currentcolor']) {
      const r = validateColorInput(bad);
      assert.equal(r.ok, false, bad);
      assert.ok(typeof r.error === 'string' && r.error.length > 0, `${bad} has an error message`);
    }
  });

  it('checks canonical colors', () => {
    assert.ok(isCanonicalColor({ r: 0, g: 255, b: 3, a: 255 }));
    assert.ok(!isCanonicalColor({ r: 0.5, g: 0, b: 0, a: 255 }));
    assert.ok(!isCanonicalColor({ r: 256, g: 0, b: 0, a: 255 }));
    assert.ok(!isCanonicalColor({ r: 0, g: 0, b: 0 }));
    assert.ok(!isCanonicalColor(null));
  });

  it('clamps crawl options into limits and fills defaults', () => {
    assert.deepEqual(sanitizeCrawlOptions({}), { ...DEFAULT_CRAWL_OPTIONS });
    const wild = sanitizeCrawlOptions({ maxPages: 9999, concurrency: 99, pageTimeoutMs: 1, retries: -4, renderDelayMs: 'abc' });
    assert.equal(wild.maxPages, CRAWL_LIMITS.maxPages.max);
    assert.equal(wild.concurrency, CRAWL_LIMITS.concurrency.max);
    assert.equal(wild.pageTimeoutMs, CRAWL_LIMITS.pageTimeoutMs.min);
    assert.equal(wild.retries, CRAWL_LIMITS.retries.min);
    assert.equal(wild.renderDelayMs, DEFAULT_CRAWL_OPTIONS.renderDelayMs);
  });

  it('detects pages extensions cannot inspect', () => {
    for (const url of ['chrome://extensions', 'chrome-extension://abc/x.html', 'about:blank', 'view-source:https://a.b', 'https://chromewebstore.google.com/detail/x', 'https://chrome.google.com/webstore/x', '']) {
      assert.equal(checkRestrictedUrl(url).restricted, true, url);
    }
    for (const url of ['https://example.com', 'http://localhost:8080/x', 'https://chrome.google.com/other']) {
      assert.equal(checkRestrictedUrl(url).restricted, false, url);
    }
    assert.equal(checkRestrictedUrl('file:///tmp/a.html').fileUrl, true);
  });

  it('builds origin match patterns', () => {
    assert.equal(originPattern('https://example.com/a/b?x=1'), 'https://example.com/*');
    assert.equal(originPattern('http://localhost:8765/x'), 'http://localhost:8765/*');
    assert.equal(originPattern('chrome://settings'), null);
    assert.equal(originPattern('nonsense'), null);
  });

  it('parses scan requests and rejects malformed payloads', () => {
    const good = { scanId: 'a', tabId: 3, target: { r: 1, g: 2, b: 3, a: 255 }, options: { tolerance: 99, includeInherited: 1 }, crawl: { maxPages: 10 } };
    const page = parseScanRequest(good);
    assert.equal(page.tabId, 3);
    assert.equal(page.crawl, null);
    assert.equal(page.scanOptions.tolerance, 4, 'tolerance clamped to NEAR_TOLERANCE');
    assert.equal(page.scanOptions.includeInherited, true);
    assert.equal(parseScanRequest(good, { site: true }).crawl.maxPages, 10);
    for (const bad of [null, {}, { ...good, scanId: '' }, { ...good, tabId: '3' }, { ...good, target: { r: 1 } }]) {
      assert.throws(() => parseScanRequest(bad));
    }
  });
});
