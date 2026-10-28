import { assert, describe, it } from '../test-runner.js';
import { crawlSite } from '../../services/site-crawler.js';
import { ERR } from '../../shared/constants.js';
import { createError, sleep } from '../../shared/helpers.js';

const ORIGIN = 'https://site.test';
const TARGET = { r: 2, g: 87, b: 67, a: 255 };

/**
 * In-memory site: path -> { links, status, contentType, redirectTo, fail, delay }.
 * Fake deps stand in for chrome.tabs; everything else is the real crawler.
 */
function createWorld(site) {
  const world = {
    opened: [],
    closed: [],
    open: new Set(),
    maxOpen: 0,
    scans: [],
    tabs: new Map(),
    nextId: 100,
  };
  const pathOf = (url) => new URL(url).pathname + new URL(url).search;

  world.deps = {
    async openTempTab(url) {
      const id = world.nextId++;
      world.tabs.set(id, url);
      world.opened.push(url);
      world.open.add(id);
      world.maxOpen = Math.max(world.maxOpen, world.open.size);
      return { id };
    },
    async closeTempTab(id) {
      world.closed.push(id);
      world.open.delete(id);
    },
    async waitForTabComplete(id, { signal } = {}) {
      const url = world.tabs.get(id);
      const page = site[pathOf(url)] || {};
      if (page.delay) await sleep(page.delay, signal);
      if (page.loadFails) return { url: 'chrome-error://chromewebsupport/' };
      return { url: page.redirectTo || url };
    },
    async scanTab(tabId, { signal }) {
      world.scans.push(tabId);
      const url = world.tabs.get(tabId) || world.startUrl;
      const page = site[pathOf(url)] || {};
      if (page.scanDelay) await sleep(page.scanDelay, signal);
      if (signal?.aborted) throw createError(ERR.CANCELLED, 'cancelled');
      if (page.fail) throw createError(page.fail, `fake ${page.fail}`);
      if (page.failOnce && !page.failedOnce) {
        page.failedOnce = true;
        throw createError(ERR.TIMEOUT, 'flaky');
      }
      return {
        url: page.redirectTo || url,
        title: page.title || pathOf(url),
        httpStatus: page.status ?? 200,
        contentType: page.contentType || 'text/html',
        elements: [{ elementId: 1 }],
        matches: page.noMatch ? [] : [{ elementId: 1, property: 'color' }],
        links: page.links || [],
      };
    },
  };
  return world;
}

async function crawl(site, { start = '/', crawl: crawlOptions = {}, signal } = {}) {
  const world = createWorld(site);
  world.startUrl = ORIGIN + start;
  const controller = new AbortController();
  const result = await crawlSite({
    startTabId: 1,
    startUrl: world.startUrl,
    scanId: 's1',
    target: TARGET,
    scanOptions: {},
    crawl: { renderDelayMs: 0, retries: 1, ...crawlOptions },
    signal: signal || controller.signal,
    deps: world.deps,
  });
  return { world, result, controller };
}

const urls = (result) => result.pages.map((p) => new URL(p.url).pathname).sort();

describe('Site crawler', () => {
  it('crawls linked same-origin pages breadth-first and scans each exactly once', async () => {
    const { result, world } = await crawl({
      '/': { links: ['/a', '/b', '/a/', '/a#frag', `${ORIGIN}/b?utm_source=x`] },
      '/a': { links: ['/', '/c'] },
      '/b': { links: ['/c'] },
      '/c': { links: [] },
    });
    assert.deepEqual(urls(result), ['/', '/a', '/b', '/c']);
    assert.equal(world.opened.length, 3, 'start page is scanned in the user tab, not a temp tab');
    assert.equal(result.coverage.complete, true);
    assert.equal(result.coverage.scanned, 4);
    assert.equal(result.coverage.failed, 0);
    assert.equal(result.coverage.limitReached, false);
  });

  it('excludes external domains, non-http schemes, assets and risky links', async () => {
    const { world, result } = await crawl({
      '/': {
        links: ['https://other.test/x', 'mailto:a@b.c', 'tel:123', 'javascript:void(0)', '/doc.pdf', '/logout', '/ok', 'ftp://site.test/x', 'https://sub.site.test/'],
      },
      '/ok': {},
    });
    assert.deepEqual(urls(result), ['/', '/ok']);
    assert.deepEqual(world.opened, [`${ORIGIN}/ok`]);
  });

  it('never opens more than maxPages and reports the limit honestly', async () => {
    const links = Array.from({ length: 12 }, (_, i) => `/p${i}`);
    const { result, world } = await crawl({ '/': { links } }, { crawl: { maxPages: 5 } });
    assert.equal(result.pages.length + result.failures.length, 5);
    assert.equal(world.opened.length, 4);
    assert.equal(result.coverage.limitReached, true);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.notScanned, 12 - 4);
  });

  it('respects the concurrency limit and always closes its temp tabs', async () => {
    const site = { '/': { links: Array.from({ length: 9 }, (_, i) => `/p${i}`) } };
    for (let i = 0; i < 9; i += 1) site[`/p${i}`] = { delay: 30 };
    const { world, result } = await crawl(site, { crawl: { concurrency: 3 } });
    assert.equal(result.pages.length, 10);
    assert.equal(world.maxOpen, 3, `max concurrently open temp tabs was ${world.maxOpen}`);
    assert.equal(world.open.size, 0, 'no temp tab left open');
    assert.equal(world.closed.length, world.opened.length);
  });

  it('reports pages that fail and does not claim complete coverage', async () => {
    const { result, world } = await crawl({
      '/': { links: ['/ok', '/missing', '/pdfish', '/offsite', '/broken', '/denied'] },
      '/ok': {},
      '/missing': { status: 404 },
      '/pdfish': { contentType: 'application/pdf' },
      '/offsite': { redirectTo: 'https://evil.test/landing' },
      '/broken': { loadFails: true },
      '/denied': { fail: ERR.INJECTION_FAILED },
    }, { crawl: { retries: 0 } });
    assert.deepEqual(urls(result), ['/', '/ok']);
    const byPath = Object.fromEntries(result.failures.map((f) => [new URL(f.url).pathname, f.code]));
    assert.equal(byPath['/missing'], ERR.HTTP_ERROR);
    assert.equal(byPath['/pdfish'], ERR.NOT_HTML);
    assert.equal(byPath['/offsite'], ERR.REDIRECTED_OFFSITE);
    assert.equal(byPath['/broken'], ERR.LOAD_FAILED);
    assert.equal(byPath['/denied'], ERR.INJECTION_FAILED);
    assert.equal(result.coverage.failed, 5);
    assert.equal(result.coverage.complete, false);
    assert.equal(world.open.size, 0);
  });

  it('retries transient failures once and succeeds, but does not retry HTTP errors', async () => {
    const site = { '/': { links: ['/flaky', '/gone'] }, '/flaky': { failOnce: true }, '/gone': { status: 410 } };
    const { result, world } = await crawl(site, { crawl: { retries: 1 } });
    assert.deepEqual(urls(result), ['/', '/flaky']);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].attempts, 1, 'HTTP errors are final');
    assert.equal(world.opened.filter((u) => u.endsWith('/flaky')).length, 2, 'flaky page opened twice');
    assert.equal(world.open.size, 0);
  });

  it('collapses redirects onto already-scanned pages', async () => {
    const { result } = await crawl({
      '/': { links: ['/a', '/alias'] },
      '/a': {},
      '/alias': { redirectTo: `${ORIGIN}/a` },
    });
    assert.deepEqual(urls(result), ['/', '/a']);
    assert.equal(result.coverage.duplicates, 1);
  });

  it('cancels promptly, closes every temp tab and flags the result as cancelled', async () => {
    const site = { '/': { links: Array.from({ length: 10 }, (_, i) => `/slow${i}`) } };
    for (let i = 0; i < 10; i += 1) site[`/slow${i}`] = { delay: 2000 };
    const world = createWorld(site);
    world.startUrl = `${ORIGIN}/`;
    const controller = new AbortController();
    const started = Date.now();
    const promise = crawlSite({
      startTabId: 1,
      startUrl: world.startUrl,
      scanId: 's2',
      target: TARGET,
      crawl: { renderDelayMs: 0, concurrency: 3 },
      signal: controller.signal,
      deps: world.deps,
    });
    await sleep(150);
    assert.ok(world.open.size > 0, 'tabs are open mid-scan');
    controller.abort();
    const result = await promise;
    assert.ok(Date.now() - started < 1500, 'cancel did not wait for the slow pages');
    assert.equal(result.coverage.cancelled, true);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.limitReached, false);
    assert.equal(world.open.size, 0, 'all temp tabs closed after cancel');
    assert.equal(result.failures.length, 0, 'cancelled pages are not failures');
  });

  it('throws if the start page itself cannot be scanned', async () => {
    const world = createWorld({});
    world.startUrl = `${ORIGIN}/`;
    world.deps.scanTab = async () => {
      throw createError(ERR.RESTRICTED_PAGE, 'nope');
    };
    let caught = null;
    try {
      await crawlSite({ startTabId: 1, startUrl: world.startUrl, scanId: 's3', target: TARGET, crawl: {}, signal: new AbortController().signal, deps: world.deps });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'rejected');
    assert.equal(caught.code, ERR.RESTRICTED_PAGE);
  });

  it('streams progress snapshots', async () => {
    const world = createWorld({ '/': { links: ['/a', '/b'] }, '/a': {}, '/b': {} });
    world.startUrl = `${ORIGIN}/`;
    const events = [];
    await crawlSite({
      startTabId: 1,
      startUrl: world.startUrl,
      scanId: 's4',
      target: TARGET,
      crawl: { renderDelayMs: 0 },
      signal: new AbortController().signal,
      onProgress: (p) => events.push(p),
      deps: world.deps,
    });
    assert.ok(events.length >= 1);
    assert.equal(events[0].phase, 'crawling');
    assert.equal(events[0].scanId, 's4');
    assert.ok(events.every((e) => e.maxPages === 50));
  });

  it('starts from a non-root URL and only follows same origin', async () => {
    const { result } = await crawl({ '/docs/start': { links: ['/docs/next', '/'] }, '/docs/next': {}, '/': {} }, { start: '/docs/start' });
    assert.deepEqual(urls(result), ['/', '/docs/next', '/docs/start']);
  });
});

/* ------------------------------------------------- Invisible (no tabs) mode */

/** Fake offscreen renderer: scanUrl instead of tabs. Any tab call fails the test. */
function createInvisibleWorld(site) {
  const world = { scanned: [], active: 0, maxActive: 0, tabCalls: 0 };
  const forbidden = async () => {
    world.tabCalls += 1;
    throw new Error('a tab was touched in invisible mode');
  };
  const pathOf = (url) => new URL(url).pathname + new URL(url).search;
  world.deps = {
    openTempTab: forbidden,
    closeTempTab: forbidden,
    waitForTabComplete: forbidden,
    async scanTab() {
      // the user's own tab (start page only)
      return { url: `${ORIGIN}/`, title: 'start', httpStatus: 200, contentType: 'text/html', elements: [], matches: [{ elementId: 1 }], links: site['/'].links };
    },
    async scanUrl(url, { signal, timeoutMs, origin }) {
      world.scanned.push(url);
      world.active += 1;
      world.maxActive = Math.max(world.maxActive, world.active);
      try {
        assert.equal(origin, ORIGIN);
        assert.ok(timeoutMs >= 5000);
        const page = site[pathOf(url)] || {};
        if (page.delay) await sleep(page.delay, signal);
        if (page.fail) throw createError(page.fail, `fake ${page.fail}`);
        return {
          url: page.redirectTo || url,
          title: pathOf(url),
          httpStatus: page.status ?? 200,
          contentType: page.contentType || 'text/html',
          elements: [],
          matches: [{ elementId: 1 }],
          links: page.links || [],
        };
      } finally {
        world.active -= 1;
      }
    },
  };
  return world;
}

async function crawlInvisible(site, crawlOptions = {}, signal) {
  const world = createInvisibleWorld(site);
  const result = await crawlSite({
    startTabId: 1,
    startUrl: `${ORIGIN}/`,
    scanId: 'inv',
    target: TARGET,
    crawl: { mode: 'background', retries: 0, ...crawlOptions },
    signal: signal || new AbortController().signal,
    deps: world.deps,
  });
  return { world, result };
}

describe('Site crawler: invisible mode (no tabs)', () => {
  it('is the default and never opens a tab or window', async () => {
    const { world, result } = await crawlInvisible({ '/': { links: ['/a', '/b'] }, '/a': { links: ['/c'] }, '/b': {}, '/c': {} });
    assert.deepEqual(urls(result), ['/', '/a', '/b', '/c']);
    assert.equal(world.tabCalls, 0);
    assert.equal(result.coverage.mode, 'background');
    assert.equal(result.coverage.complete, true);
  });

  it('de-duplicates, applies the page limit and respects concurrency', async () => {
    const site = { '/': { links: Array.from({ length: 10 }, (_, i) => `/p${i}`).concat(['/p1/', '/p1#x']) } };
    for (let i = 0; i < 10; i += 1) site[`/p${i}`] = { delay: 25 };
    const { world, result } = await crawlInvisible(site, { maxPages: 6, concurrency: 2 });
    assert.equal(world.scanned.length, 5);
    assert.equal(world.maxActive, 2);
    assert.equal(result.coverage.limitReached, true);
    assert.equal(new Set(world.scanned).size, 5);
  });

  it('reports failures, off-site redirects and non-HTML honestly', async () => {
    const { result } = await crawlInvisible({
      '/': { links: ['/ok', '/missing', '/pdf', '/off', '/boom'] },
      '/ok': {},
      '/missing': { status: 404 },
      '/pdf': { contentType: 'application/pdf' },
      '/off': { redirectTo: 'https://evil.test/x' },
      '/boom': { fail: ERR.LOAD_FAILED },
    });
    assert.deepEqual(urls(result), ['/', '/ok']);
    const byPath = Object.fromEntries(result.failures.map((f) => [new URL(f.url).pathname, f.code]));
    assert.equal(byPath['/missing'], ERR.HTTP_ERROR);
    assert.equal(byPath['/pdf'], ERR.NOT_HTML);
    assert.equal(byPath['/off'], ERR.REDIRECTED_OFFSITE);
    assert.equal(byPath['/boom'], ERR.LOAD_FAILED);
    assert.equal(result.coverage.complete, false);
  });

  it('cancels quickly without failures', async () => {
    const site = { '/': { links: Array.from({ length: 8 }, (_, i) => `/s${i}`) } };
    for (let i = 0; i < 8; i += 1) site[`/s${i}`] = { delay: 3000 };
    const controller = new AbortController();
    const started = Date.now();
    const promise = crawlInvisible(site, { concurrency: 3 }, controller.signal);
    await sleep(120);
    controller.abort();
    const { result, world } = await promise;
    assert.ok(Date.now() - started < 1500);
    assert.equal(result.coverage.cancelled, true);
    assert.equal(result.failures.length, 0);
    assert.equal(world.active, 0);
    assert.equal(world.tabCalls, 0);
  });

  it('uses tabs only when explicitly requested', async () => {
    const world = createWorld({ '/': { links: ['/a'] }, '/a': {} });
    world.startUrl = `${ORIGIN}/`;
    let scanUrlCalls = 0;
    world.deps.scanUrl = async () => {
      scanUrlCalls += 1;
      throw new Error('should not be used');
    };
    const result = await crawlSite({
      startTabId: 1, startUrl: world.startUrl, scanId: 'tabs', target: TARGET,
      crawl: { mode: 'tabs', renderDelayMs: 0 }, signal: new AbortController().signal, deps: world.deps,
    });
    assert.equal(scanUrlCalls, 0);
    assert.equal(world.opened.length, 1);
    assert.equal(result.coverage.mode, 'tabs');
  });
});
