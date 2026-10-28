import { assert, describe, it } from '../test-runner.js';
import { createBackgroundRenderer } from '../../services/background-renderer.js';
import { parseColor } from '../../services/color-normalizer.js';
import { ERR } from '../../shared/constants.js';

const url = (path) => new URL(`../fixtures/site/${path}`, import.meta.url).href;
const TARGET = parseColor('#025743');

function makeRenderer() {
  const calls = [];
  const holder = document.createElement('div');
  document.body.append(holder);
  const renderer = createBackgroundRenderer({
    container: holder,
    fetchImpl: (input, init) => {
      calls.push(String(input));
      return fetch(input, init);
    },
  });
  return { renderer, calls, holder, dispose: () => holder.remove() };
}

const classesOf = (page) => page.elements.map((e) => e.classes.join(' '));
const forClass = (page, cls) => {
  const element = page.elements.find((e) => e.classes.includes(cls));
  return element ? page.matches.filter((m) => m.elementId === element.elementId) : [];
};

describe('Background renderer (no tabs)', () => {
  it('scans a page from its served HTML + CSS, like the live scanner', async () => {
    const { renderer, holder, dispose } = makeRenderer();
    try {
      const page = await renderer.scanUrl(url('index.html'), { target: TARGET, options: { collectLinks: true }, timeoutMs: 15000 });
      assert.ok(page.url.endsWith('/tests/fixtures/site/index.html'));
      assert.equal(page.httpStatus, 200);
      assert.ok(/html/.test(page.contentType));
      assert.equal(page.renderMode, 'static');
      assert.ok(page.title.startsWith('Fixture Home'));
      assert.ok(page.matches.length >= 15, `only ${page.matches.length} matches`);
      assert.equal(holder.querySelectorAll('iframe').length, 0, 'the iframe is removed afterwards');

      const button = forClass(page, 'primary-button');
      assert.ok(button.some((m) => m.property === 'background-color'));
      assert.ok(button.some((m) => m.property === 'border-top-color'));
      assert.equal(forClass(page, 'print-only').length, 0, '@media print does not apply');
      assert.ok(forClass(page, 'media-rule').length === 1, '@media (min-width: 1px) applies in a 1280px viewport');
      assert.ok(forClass(page, 'layered').length === 1, '@layer content is found');
      assert.equal(page.elements.find((e) => e.classes.includes('hidden-thing')).rendered, false);
    } finally {
      dispose();
    }
  });

  it('attributes rules to the right stylesheet, including @import-ed files and variables', async () => {
    const { renderer, dispose } = makeRenderer();
    try {
      const page = await renderer.scanUrl(url('index.html'), { target: TARGET, timeoutMs: 15000 });
      const bg = forClass(page, 'primary-button').find((m) => m.property === 'background-color');
      assert.equal(bg.source.stylesheetUrl, url('assets/css/style.css'));
      assert.ok(bg.source.stylesheetLabel.endsWith('assets/css/style.css'), bg.source.stylesheetLabel);
      assert.equal(bg.source.selector, '.primary-button');
      assert.equal(bg.source.cssVariable.name, '--primary-color');
      const definition = bg.source.cssVariable.definition;
      assert.equal(definition.stylesheetUrl, url('assets/css/vars.css'), 'variable lives in the @import-ed file, and says so');
      assert.equal(definition.selector, ':root');

      const text = await (await fetch(url('assets/css/style.css'))).text();
      const expected = text.split('\n').findIndex((l) => l.includes('background-color: var(--primary-color)')) + 1;
      assert.equal(bg.source.line, expected, 'verified line number in the real file');

      const inline = forClass(page, 'inline-block-rule')[0];
      assert.ok(inline.source.stylesheetLabel.startsWith('<style> block'), inline.source.stylesheetLabel);
      assert.equal(forClass(page, 'inline-style')[0].source.origin, 'inline');
    } finally {
      dispose();
    }
  });

  it('matches color equivalents the same way as the live scanner', async () => {
    const { renderer, dispose } = makeRenderer();
    try {
      const page = await renderer.scanUrl(url('index.html'), { target: parseColor('white'), timeoutMs: 15000 });
      const names = classesOf(page).join(' ');
      for (const cls of ['w-hex3', 'w-hex6', 'w-rgb', 'w-rgba', 'w-hsl', 'w-name']) assert.ok(names.includes(cls), cls);
      assert.ok(!names.includes('w-half'), 'alpha .5 is not white');
    } finally {
      dispose();
    }
  });

  it('collects internal links from the served HTML', async () => {
    const { renderer, dispose } = makeRenderer();
    try {
      const page = await renderer.scanUrl(url('index.html'), { target: TARGET, options: { collectLinks: true }, timeoutMs: 15000 });
      for (const wanted of ['about.html', 'products.html', 'contact.html', 'blog/']) {
        assert.ok(page.links.some((l) => l.endsWith(wanted)), wanted);
      }
      assert.ok(page.links.every((l) => /^[a-z][a-z0-9+.-]*:/i.test(l)), 'links are absolute; the crawler filters schemes');
    } finally {
      dispose();
    }
  });

  it('never runs scripts, never follows meta refresh, drops <noscript>', async () => {
    const { renderer, dispose } = makeRenderer();
    try {
      const page = await renderer.scanUrl(url('scripted.html'), { target: TARGET, timeoutMs: 15000 });
      const names = classesOf(page);
      assert.ok(names.includes('static-one'));
      assert.ok(!names.includes('from-script'), 'JavaScript must not run');
      assert.ok(!names.includes('in-noscript'), '<noscript> is not rendered');
      assert.ok(page.url.endsWith('scripted.html'), 'meta refresh ignored');
      assert.ok(
        page.stats.stylesheets.inaccessible.some((s) => s.href.endsWith('missing-sheet.css')),
        'a stylesheet that cannot be downloaded is reported, not hidden',
      );
    } finally {
      dispose();
    }
  });

  it('shares downloaded stylesheets between pages of a crawl', async () => {
    const { renderer, calls, dispose } = makeRenderer();
    try {
      await renderer.scanUrl(url('index.html'), { target: TARGET, timeoutMs: 15000 });
      await renderer.scanUrl(url('about.html'), { target: TARGET, timeoutMs: 15000 });
      const sheetFetches = calls.filter((c) => c.endsWith('assets/css/style.css'));
      assert.equal(sheetFetches.length, 1, `style.css downloaded ${sheetFetches.length}x`);
    } finally {
      dispose();
    }
  });

  it('fails with a clear code for HTTP errors, non-HTML and off-site redirects', async () => {
    const { renderer, dispose } = makeRenderer();
    const code = async (promise) => {
      try {
        await promise;
      } catch (error) {
        return error.code;
      }
      return null;
    };
    try {
      assert.equal(await code(renderer.scanUrl(url('missing.html'), { target: TARGET })), ERR.HTTP_ERROR);
      assert.equal(await code(renderer.scanUrl(url('assets/css/style.css'), { target: TARGET })), ERR.NOT_HTML);
      assert.equal(
        await code(renderer.scanUrl(url('index.html'), { target: TARGET, origin: 'https://some-other-site.test' })),
        ERR.REDIRECTED_OFFSITE,
      );
      assert.equal(await code(renderer.scanUrl('http://127.0.0.1:1/unreachable', { target: TARGET, timeoutMs: 8000 })), ERR.LOAD_FAILED);
    } finally {
      dispose();
    }
  });

  it('can be cancelled', async () => {
    const { renderer, holder, dispose } = makeRenderer();
    try {
      const controller = new AbortController();
      controller.abort();
      let code = null;
      try {
        await renderer.scanUrl(url('index.html'), { target: TARGET, signal: controller.signal });
      } catch (error) {
        code = error.code;
      }
      assert.equal(code, ERR.CANCELLED);

      const second = new AbortController();
      const running = renderer.scanUrl(url('index.html'), { target: TARGET, signal: second.signal, timeoutMs: 15000 });
      second.abort();
      code = null;
      try {
        await running;
      } catch (error) {
        code = error.code;
      }
      assert.equal(code, ERR.CANCELLED);
      assert.equal(holder.querySelectorAll('iframe').length, 0, 'no frame left behind');
    } finally {
      dispose();
    }
  });
});
