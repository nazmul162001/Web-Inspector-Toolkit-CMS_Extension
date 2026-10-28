import { afterEach, assert, describe as baseDescribe, it } from '../test-runner.js';
import { createTextMatcher, foldCase, isTextQuery, sanitizeTextQuery } from '../../services/text-matcher.js';
import { scanTextDocument } from '../../content/text-scanner.js';
import { runScan } from '../../content/run-scan.js';
import { createBackgroundRenderer } from '../../services/background-renderer.js';
import { isScanTarget, parseScanRequest } from '../../shared/validators.js';
import { buildTextSummary, contextText, flattenTextResult, groupTextItems, sortTextItems } from '../../sidepanel/features/text-find/text-find-utils.js';

const query = (text, extra = {}) => ({ kind: 'text', text, ...extra });

/* ------------------------------------------------------------- Matching */

describe_('Text matcher', () => {
  it('sanitizes queries: collapses whitespace, trims, caps length, rejects empty', () => {
    assert.equal(sanitizeTextQuery(query('  Hello \n\t  world  ')).text, 'Hello world');
    assert.equal(sanitizeTextQuery(query('   ')), null);
    assert.equal(sanitizeTextQuery(query('')), null);
    assert.equal(sanitizeTextQuery({ r: 1, g: 2, b: 3, a: 255 }), null);
    assert.equal(sanitizeTextQuery(query('x'.repeat(900))).text.length, 500);
    assert.ok(isTextQuery(query('a')));
    assert.ok(!isTextQuery({ kind: 'text', text: '  ' }));
    assert.ok(!isTextQuery({ r: 1, g: 2, b: 3, a: 255 }));
  });

  it('is case-insensitive by default and case-sensitive on request', () => {
    const find = (q, hay) => createTextMatcher(q).find(createTextMatcher(q).fold(hay)).length;
    assert.equal(find(query('hello'), 'Hello HELLO hello'), 3);
    assert.equal(find(query('hello', { matchCase: true }), 'Hello HELLO hello'), 1);
  });

  it('keeps offsets valid when lower-casing would change the length', () => {
    assert.equal(foldCase('İA').length, 2);
    const matcher = createTextMatcher(query('a'));
    const found = matcher.find(matcher.fold('İa'));
    assert.deepEqual(found, [{ start: 1, end: 2 }]);
  });

  it('finds non-overlapping matches in order', () => {
    const matcher = createTextMatcher(query('aa'));
    assert.deepEqual(matcher.find(matcher.fold('aaaaa')), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });

  it('whole word respects word boundaries for spaced scripts', () => {
    const matcher = createTextMatcher(query('cat', { wholeWord: true }));
    const found = matcher.find(matcher.fold('cat concat cats cat. (cat) cat_x'));
    assert.deepEqual(found.map((m) => m.start), [0, 16, 22]);
  });

  it('whole word does not break Japanese / Chinese, which have no spaces between words', () => {
    const matcher = createTextMatcher(query('東京', { wholeWord: true }));
    assert.equal(matcher.find(matcher.fold('私は東京に住んでいます')).length, 1);
  });

  it('finds Japanese text and special characters literally (no regex meaning)', () => {
    const jp = createTextMatcher(query('お問い合わせ'));
    assert.equal(jp.find(jp.fold('お問い合わせはこちら。お問い合わせ')).length, 2);
    const special = createTextMatcher(query('a.b*(c)'));
    assert.equal(special.find(special.fold('axb a.b*(c) a.b*(c)')).length, 2);
  });
});

/* -------------------------------------------------------------- Scanning */

const created = [];

function describe_(name, define) {
  baseDescribe(name, () => {
    afterEach(() => {
      while (created.length) created.pop().remove();
    });
    define();
  });
}

/** Mount a fixture in the live test page and run the text scanner on it. */
async function scan(html, q, options = {}) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  created.push(root);
  return scanTextDocument({ root, target: sanitizeTextQuery(q), options });
}

const texts = (result) => result.matches.map((m) => m.text);
const byClass = (result, cls) => result.elements.find((e) => e.classes.includes(cls));

describe_('Text scanning (live DOM)', () => {
  it('finds text and reports the element, section and context', async () => {
    const result = await scan('<main><p class="a" id="x">Welcome to the Asteer site</p></main>', query('asteer'));
    assert.equal(result.matches.length, 1);
    const match = result.matches[0];
    assert.equal(match.text, 'Asteer');
    assert.equal(match.before, 'Welcome to the ');
    assert.equal(match.after, ' site');
    assert.equal(match.kind, 'text');
    const element = byClass(result, 'a');
    assert.equal(element.tag, 'p');
    assert.equal(element.id, 'x');
    assert.equal(element.location.section, 'main');
    assert.equal(match.elementId, element.elementId);
  });

  it('finds text split across inline elements and attributes it to the common parent', async () => {
    const result = await scan('<p class="p">Hello <b class="b">big</b> <a href="#">wor</a>ld</p>', query('hello big world'));
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].text, 'Hello big world');
    assert.equal(result.elements.find((e) => e.elementId === result.matches[0].elementId).tag, 'p');
  });

  it('attributes a match inside one inline element to that element', async () => {
    const result = await scan('<p class="p">Say <b class="b">cheese</b> now</p>', query('cheese'));
    assert.equal(result.elements.find((e) => e.elementId === result.matches[0].elementId).tag, 'b');
  });

  it('never joins text across different blocks', async () => {
    const result = await scan('<div>Hello</div><div>world</div>', query('hello world'));
    assert.equal(result.matches.length, 0);
    const br = await scan('<p>Hello<br>world</p>', query('hello world'));
    assert.equal(br.matches.length, 1, 'a <br> counts as a space');
  });

  it('ignores whitespace differences in the HTML', async () => {
    const result = await scan('<p>Hello\n      \t   world</p><p>Hello&nbsp;world</p>', query('hello   world'));
    assert.equal(result.matches.length, 2);
  });

  it('lists every occurrence, also several in one element', async () => {
    const result = await scan('<p class="p">go go go</p><p>go</p>', query('go'));
    assert.equal(result.matches.length, 4);
    assert.equal(new Set(result.matches.map((m) => m.elementId)).size, 2);
    assert.deepEqual(result.matches.map((m) => m.seq), [1, 2, 3, 4]);
  });

  it('skips script, style, noscript and template content', async () => {
    const result = await scan(
      '<p>needle</p><script>var s = "needle";</script><style>.needle{}</style><noscript>needle</noscript><template>needle</template>',
      query('needle'),
    );
    assert.equal(result.matches.length, 1);
  });

  it('ignores furigana (<rt>) so the base text still matches', async () => {
    const result = await scan('<p><ruby>漢字<rt>かんじ</rt></ruby>を読む</p>', query('漢字を読む'));
    assert.equal(result.matches.length, 1);
  });

  it('applies Match case and Whole word', async () => {
    const html = '<p>Cat concat cat</p>';
    assert.equal((await scan(html, query('cat'))).matches.length, 3);
    assert.equal((await scan(html, query('cat', { matchCase: true }))).matches.length, 2, 'concat + cat, not Cat');
    assert.equal((await scan(html, query('cat', { matchCase: true, wholeWord: true }))).matches.length, 1);
    assert.equal((await scan(html, query('cat', { wholeWord: true }))).matches.length, 2);
  });

  it('searches alt, title, placeholder, aria-label and button values only when asked', async () => {
    const html =
      '<img alt="Sunny beach"><a title="beach house" href="#">x</a><input placeholder="beach?"><button aria-label="Beach">b</button>' +
      '<input type="submit" value="Beach go"><input type="text" value="beach secret">';
    assert.equal((await scan(html, query('beach'))).matches.length, 0);
    const result = await scan(html, query('beach', { includeAttributes: true }));
    assert.deepEqual(result.matches.map((m) => m.attribute).sort(), ['alt', 'aria-label', 'placeholder', 'title', 'value']);
    assert.ok(result.matches.every((m) => m.kind === 'attribute'));
  });

  it('can limit results to visible text', async () => {
    const html = '<p class="v">needle</p><p class="h" style="display:none">needle</p><div style="display:none"><p class="n">needle</p></div>';
    assert.equal((await scan(html, query('needle'))).matches.length, 3);
    const visible = await scan(html, query('needle', { visibleOnly: true }));
    assert.equal(visible.matches.length, 1);
    assert.ok(byClass(visible, 'v'));
  });

  it('caps the number of matches and says so', async () => {
    const result = await scan(`<p>${'x '.repeat(6000)}</p>`, query('x'));
    assert.equal(result.truncated, true);
    assert.ok(result.matches.length <= 5000);
  });

  it('can be cancelled', async () => {
    let failed = null;
    try {
      const root = document.createElement('div');
      root.innerHTML = '<p>a</p>'.repeat(3000);
      document.body.append(root);
      created.push(root);
      await scanTextDocument({ root, target: sanitizeTextQuery(query('a')), budgetMs: 0, isCancelled: () => true });
    } catch (error) {
      failed = error;
    }
    assert.equal(failed?.code, 'CANCELLED');
  });

  it('runScan dispatches by target type', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>dispatch</p>';
    document.body.append(root);
    created.push(root);
    const text = await runScan({ root, target: sanitizeTextQuery(query('dispatch')) });
    assert.equal(text.matches[0].text, 'dispatch');
    const color = await runScan({ root, target: { r: 1, g: 2, b: 3, a: 255 } });
    assert.ok(Array.isArray(color.matches) && color.matches.length === 0);
  });
});

describe_('Text scanning (parsed document, no layout)', () => {
  it('works on an inert parsed document and does not claim elements are hidden', async () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><main><h1 class="t">Find me please</h1><p>and again: find ME</p></main></body></html>',
      'text/html',
    );
    const result = await scanTextDocument({ doc, target: sanitizeTextQuery(query('find me')) });
    assert.equal(result.matches.length, 2);
    assert.ok(result.elements.every((e) => e.rendered === null));
    assert.equal(result.elements[0].location.section, 'main');
  });
});

/* ------------------------------------------------------- Renderer + site */

const url = (path) => new URL(`../fixtures/site/${path}`, import.meta.url).href;

describe_('Text search through the invisible renderer', () => {
  it('searches a served page without stylesheets or an iframe', async () => {
    const holder = document.createElement('div');
    document.body.append(holder);
    created.push(holder);
    const requests = [];
    const renderer = createBackgroundRenderer({
      container: holder,
      fetchImpl: (input, init) => {
        requests.push(String(input));
        return fetch(input, init);
      },
    });
    const page = await renderer.scanUrl(url('index.html'), { target: sanitizeTextQuery(query('fixture home')), options: { collectLinks: true }, timeoutMs: 15000 });
    assert.ok(page.matches.length >= 1);
    assert.ok(page.matches.some((m) => m.text.toLowerCase() === 'fixture home'));
    assert.equal(page.renderMode, 'static');
    assert.ok(page.links.some((link) => link.endsWith('/about.html')), 'links resolve against the page URL');
    assert.equal(requests.length, 1, 'only the HTML was downloaded - no CSS');
    assert.equal(holder.querySelectorAll('iframe').length, 0);
  });

  it('loads stylesheets and a hidden frame only for "visible text only"', async () => {
    const holder = document.createElement('div');
    document.body.append(holder);
    created.push(holder);
    const requests = [];
    const renderer = createBackgroundRenderer({
      container: holder,
      fetchImpl: (input, init) => {
        requests.push(String(input));
        return fetch(input, init);
      },
    });
    const page = await renderer.scanUrl(url('index.html'), { target: sanitizeTextQuery(query('fixture home', { visibleOnly: true })), timeoutMs: 15000 });
    assert.ok(page.matches.length >= 1);
    assert.ok(requests.length > 1, 'stylesheets were downloaded to decide what is visible');
    assert.ok(page.elements.every((e) => typeof e.rendered === 'boolean' || e.rendered === null));
  });
});

/* ------------------------------------------------------------- Validators */

describe_('Text Find requests and results', () => {
  it('accepts text queries as a scan target next to colors', () => {
    assert.ok(isScanTarget(query('hello')));
    assert.ok(isScanTarget({ r: 1, g: 2, b: 3, a: 255 }));
    assert.ok(!isScanTarget(query('   ')));
    assert.ok(!isScanTarget(null));
    assert.ok(!isScanTarget({ kind: 'text' }));
  });

  it('parses a text scan request and keeps only known fields', () => {
    const request = parseScanRequest({ scanId: 's', tabId: 3, target: { ...query('  Hi  there '), matchCase: 1, evil: '<x>' }, options: {} });
    assert.deepEqual(request.target, {
      kind: 'text',
      text: 'Hi there',
      matchCase: true,
      wholeWord: false,
      includeAttributes: false,
      visibleOnly: false,
    });
    assert.throws(() => parseScanRequest({ scanId: 's', tabId: 3, target: query('  ') }));
    const color = parseScanRequest({ scanId: 's', tabId: 3, target: { r: 1, g: 2, b: 3, a: 255 } });
    assert.deepEqual(color.target, { r: 1, g: 2, b: 3, a: 255 });
  });

  function fakeScan() {
    const element = (id, tag, section) => ({
      elementId: id, tag, id: '', classes: [], selector: tag, path: tag, description: '', rendered: true,
      location: { section, sectionName: '', parent: null, ancestors: [] },
    });
    const match = (elementId, seq, kind = 'text') => ({ elementId, seq, kind, attribute: kind === 'attribute' ? 'alt' : null, text: 'x', before: 'a', after: 'b', moreBefore: true, moreAfter: false });
    return {
      pages: [
        { url: 'https://s.test/', elements: [element(1, 'p', 'main'), element(2, 'h1', 'header')], matches: [match(1, 2), match(2, 1), match(1, 3, 'attribute')] },
        { url: 'https://s.test/b', elements: [element(1, 'li', 'footer')], matches: [match(1, 1)] },
      ],
    };
  }

  it('flattens, summarizes, sorts and groups results', () => {
    const items = flattenTextResult(fakeScan());
    assert.equal(items.length, 4);
    const summary = buildTextSummary(items);
    assert.deepEqual(summary, { matches: 4, elements: 3, sections: 3, pages: 2, inAttributes: 1 });

    const dom = sortTextItems(items, 'dom');
    assert.deepEqual(dom.map((i) => `${i.pageIndex}:${i.match.seq}`), ['0:1', '0:2', '0:3', '1:1']);
    assert.deepEqual(sortTextItems(items, 'tag').map((i) => i.element.tag), ['h1', 'li', 'p', 'p']);

    assert.deepEqual(groupTextItems(dom, 'section').map((g) => g.id), ['header', 'main', 'footer']);
    assert.deepEqual(groupTextItems(dom, 'tag').map((g) => g.label), ['<h1>', '<li>', '<p>']);
    assert.equal(groupTextItems(dom, 'none').length, 1);
  });

  it('builds copyable context text', () => {
    const text = contextText({ before: 'a ', text: 'B', after: ' c', moreBefore: true, moreAfter: true });
    assert.equal(text, '…a B c…');
  });
});
