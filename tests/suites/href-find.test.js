import { afterEach, assert, describe as baseDescribe, it } from '../test-runner.js';
import { createHrefMatcher, isHrefQuery, parseHrefInput, sanitizeHrefQuery } from '../../services/href-matcher.js';
import { addressesInCode, linkValues, scanHrefDocument } from '../../content/href-scanner.js';
import { runScan } from '../../content/run-scan.js';
import { createBackgroundRenderer } from '../../services/background-renderer.js';
import { isScanTarget, parseScanRequest } from '../../shared/validators.js';
import { DEFAULT_SETTINGS } from '../../services/settings-service.js';

const href = (url, extra = {}) => sanitizeHrefQuery({ kind: 'href', url, ...extra });

const LINE = 'https://www.line.me/en/';
const INSTAGRAM = 'https://www.instagram.com/?locale=ja_%C3%A5JP';
const PAGE = 'https://www.example.com/shop/index.html';

/** Does a link written as `value` on PAGE match the typed `url`? */
function hit(url, value, extra, base = PAGE) {
  const query = href(url, extra);
  assert.ok(query, `query "${url}" is valid`);
  return createHrefMatcher(query).test(value, base);
}

const created = [];
function describe(name, define) {
  baseDescribe(name, () => {
    afterEach(() => {
      while (created.length) created.pop().remove();
    });
    define();
  });
}

describe('Link input', () => {
  it('accepts the example addresses and plain hosts, paths and fragments', () => {
    for (const input of [LINE, INSTAGRAM, 'line.me/en/', '/contact', '#top', 'about.html', 'mailto:hello@example.com', 'tel:+15555550123', ' https://a.example/x ']) {
      assert.ok(parseHrefInput(input).ok, input);
    }
    assert.equal(parseHrefInput(' https://a.example/x ').query.url, 'https://a.example/x');
  });

  it('rejects empty, spaced, javascript: and oversized input with a message', () => {
    for (const input of ['', '   ', 'two words', 'javascript:alert(1)', `https://a.example/${'x'.repeat(2100)}`]) {
      const result = parseHrefInput(input);
      assert.equal(result.ok, false, input);
      assert.ok(result.error.length > 5);
    }
  });

  it('defaults every option to on and sanitizes untrusted objects', () => {
    assert.deepEqual(parseHrefInput(LINE).query, { kind: 'href', url: LINE, exact: true, looseHost: true, includeButtons: true });
    assert.equal(parseHrefInput(LINE, { exact: false }).query.exact, false);
    assert.equal(sanitizeHrefQuery({ kind: 'href', url: 'a b' }), null);
    assert.equal(sanitizeHrefQuery({ kind: 'text', url: LINE }), null);
    assert.equal(isHrefQuery(href(LINE)), true);
    assert.equal('evil' in sanitizeHrefQuery({ kind: 'href', url: LINE, evil: 1 }), false);
  });
});

describe('Link matching - exact', () => {
  it('matches the same address written the same way', () => {
    assert.ok(hit(LINE, LINE));
    assert.ok(hit(INSTAGRAM, INSTAGRAM));
    assert.equal(hit(LINE, LINE).start, 0);
    assert.equal(hit(LINE, `  ${LINE}  `).start, 2);
  });

  it('resolves relative links against the page they are on', () => {
    assert.ok(hit(LINE, '/en/', {}, 'https://www.line.me/'));
    assert.ok(hit(LINE, 'en/', {}, 'https://www.line.me/'));
    assert.ok(hit(LINE, '../en/', {}, 'https://www.line.me/ja/about'));
    assert.equal(hit(LINE, '/en/', {}, 'https://www.example.com/'), null);
    assert.equal(hit(LINE, '/en/', {}, 'https://www.line.me/').resolved, LINE);
  });

  it('ignores differences that do not change where a link goes', () => {
    assert.ok(hit(LINE, 'HTTPS://WWW.LINE.ME/en/'), 'case of scheme and host');
    assert.ok(hit(LINE, 'https://www.line.me:443/en/'), 'default port');
    assert.ok(hit(LINE, 'https://www.line.me/en'), 'trailing slash');
    assert.ok(hit('https://www.line.me/en', LINE), 'trailing slash typed');
    assert.ok(hit(LINE, 'https://www.line.me/en/#section'), 'fragment');
    assert.ok(hit('https://a.example/p?b=2&a=1', 'https://a.example/p?a=1&b=2'), 'parameter order');
    assert.ok(hit('https://a.example/p?q=%c3%a5', 'https://a.example/p?q=%C3%A5'), 'escape case');
    assert.ok(hit('https://a.example/p?q=å', 'https://a.example/p?q=%C3%A5'), 'readable vs escaped');
    assert.ok(hit('https://a.example/p?q=%C3%A5', 'https://a.example/p?q=å'), 'escaped vs readable');
  });

  it('keeps differences that do change where a link goes', () => {
    assert.equal(hit(LINE, 'https://www.line.me/ja/'), null, 'other path');
    assert.equal(hit(LINE, 'https://www.line.me/en/page'), null, 'longer path');
    assert.equal(hit(LINE, 'https://www.line.me/en/?a=1'), null, 'extra parameter');
    assert.equal(hit(INSTAGRAM, 'https://www.instagram.com/'), null, 'missing parameter');
    assert.equal(hit(INSTAGRAM, 'https://www.instagram.com/?locale=en_US'), null, 'other parameter value');
    assert.equal(hit(LINE, 'https://m.line.me/en/'), null, 'other sub-domain');
    assert.equal(hit(LINE, 'https://www.line.me.evil.example/en/'), null, 'look-alike host');
    assert.equal(hit(LINE, 'https://www.line.me:8080/en/'), null, 'other port');
    assert.equal(hit('https://a.example/Path', 'https://a.example/path'), null, 'path case matters');
  });

  it('compares a typed fragment, and never matches a bare #fragment link by page address', () => {
    assert.ok(hit('https://a.example/p#team', 'https://a.example/p#team'));
    assert.equal(hit('https://a.example/p#team', 'https://a.example/p#other'), null);
    assert.ok(hit('https://a.example/p#team', '#team', {}, 'https://a.example/p'));
    assert.equal(hit('https://a.example/p', '#team', {}, 'https://a.example/p'), null);
  });

  it('treats http/https and www as the same unless asked not to', () => {
    assert.ok(hit(LINE, 'http://line.me/en/'));
    assert.ok(hit('http://line.me/en/', LINE));
    assert.equal(hit(LINE, 'http://line.me/en/', { looseHost: false }), null);
    assert.equal(hit(LINE, 'https://line.me/en/', { looseHost: false }), null);
    assert.ok(hit(LINE, 'https://www.line.me/en/', { looseHost: false }));
  });

  it('takes a typed address without a scheme as any scheme and www', () => {
    assert.ok(hit('line.me/en/', LINE, { looseHost: false }));
    assert.ok(hit('www.line.me/en/', 'http://line.me/en/'));
    assert.ok(hit('//line.me/en/', LINE));
  });

  it('matches other schemes exactly', () => {
    assert.ok(hit('mailto:hello@example.com', 'mailto:hello@example.com'));
    assert.equal(hit('mailto:hello@example.com', 'mailto:other@example.com'), null);
    assert.ok(hit('tel:+15555550123', 'tel:+15555550123'));
    assert.equal(hit('tel:+15555550123', 'https://a.example/'), null);
  });

  it('matches a typed path only on the page\'s own site', () => {
    assert.ok(hit('/contact', 'contact', {}, 'https://a.example/'));
    assert.ok(hit('/contact', '/contact/', {}, 'https://a.example/'));
    assert.ok(hit('/contact', 'https://a.example/contact', {}, 'https://a.example/'));
    assert.equal(hit('/contact', 'https://b.example/contact', {}, 'https://a.example/'), null);
    assert.equal(hit('/contact', '/contact?x=1', {}, 'https://a.example/'), null);
    assert.ok(hit('/search?q=a', '/search?q=a', {}, 'https://a.example/'));
  });

  it('compares other relative text with the link as it is written', () => {
    assert.ok(hit('#top', '#top'));
    assert.ok(hit('about.html', 'about.html'));
    assert.equal(hit('about.html', 'contact.html'), null);
    assert.equal(hit('#top', '#bottom'), null);
  });

  it('does not match empty or unparsable values', () => {
    assert.equal(hit(LINE, ''), null);
    assert.equal(hit(LINE, '   '), null);
    assert.equal(hit(LINE, 'http://'), null);
  });
});

describe('Link matching - contains', () => {
  const loose = { exact: false };

  it('finds links that contain the text, and reports where', () => {
    const result = hit('instagram.com', 'https://www.instagram.com/foo', loose);
    assert.deepEqual([result.start, result.end], [12, 25]);
    assert.ok(hit('line.me', 'https://www.line.me/en/', loose));
    assert.ok(hit('LINE.ME', 'https://www.line.me/en/', loose), 'ignores case');
    assert.equal(hit('line.me', 'https://www.example.com/', loose), null);
  });

  it('finds readable text inside escaped addresses and the other way round', () => {
    assert.ok(hit('ja_åJP', INSTAGRAM, loose));
    assert.ok(hit('ja_%C3%A5JP', 'https://a.example/?locale=ja_åJP', loose));
  });

  it('also looks at the resolved address of a relative link', () => {
    const result = hit('line.me/en', '/en/', loose, 'https://www.line.me/');
    assert.ok(result);
    assert.equal(result.start, 0);
  });
});

/* -------------------------------------------------------- Link reading */

describe('Link values of an element', () => {
  const make = (html) => {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    return holder.firstElementChild;
  };

  it('reads href always and the button-like sources only on request', () => {
    const a = make('<a href="/x" data-href="/y" onclick="location.href=\'/z\'">go</a>');
    assert.deepEqual(linkValues(a, false), [{ attribute: 'href', value: '/x' }]);
    assert.deepEqual(
      linkValues(a, true).map((v) => `${v.attribute}=${v.value}`),
      ['href=/x', 'data-href=/y', 'onclick=/z'],
    );
    assert.deepEqual(linkValues(make('<button formaction="/send">Send</button>'), true), [{ attribute: 'formaction', value: '/send' }]);
    assert.deepEqual(linkValues(make('<form action="/search"></form>'), true), [{ attribute: 'action', value: '/search' }]);
    assert.deepEqual(linkValues(make('<div>plain</div>'), true), []);
  });

  it('finds addresses written in click handlers', () => {
    assert.deepEqual(addressesInCode("location.href='/a'"), ['/a']);
    assert.deepEqual(addressesInCode('window.open("https://x.example/b", "_blank")'), ['https://x.example/b']);
    assert.deepEqual(addressesInCode("location.assign('/c')"), ['/c']);
    assert.deepEqual(addressesInCode('doTrack(); return false'), []);
  });
});

/* -------------------------------------------------------------- Scanning */

const PAGE_HTML = `
  <header>
    <nav>
      <a class="brand" href="https://www.line.me/en/">LINE <b>home</b></a>
      <a href="/en/">Relative</a>
      <a href="http://line.me/en">Without www</a>
      <a href="https://www.line.me/ja/">Japanese</a>
    </nav>
  </header>
  <main>
    <button class="cta" onclick="window.open('https://www.line.me/en/')">Open</button>
    <button data-href="https://www.line.me/en/">Data button</button>
    <form action="https://www.line.me/en/"><button type="submit" formaction="https://www.line.me/en/">Send</button></form>
    <a href="#top">Top</a>
    <a href="https://www.instagram.com/?locale=ja_%C3%A5JP"><img alt="Instagram" src="x.png"></a>
    <svg><a href="https://www.line.me/en/"><text>svg link</text></a><use href="#icon"/></svg>
  </main>
  <script>var u = "https://www.line.me/en/";</script>
  <template><a href="https://www.line.me/en/">in template</a></template>`;

async function scanDoc(target, { html = PAGE_HTML, base = 'https://www.line.me/' } = {}) {
  const doc = new DOMParser().parseFromString(`<head><base href="${base}"></head><body>${html}</body>`, 'text/html');
  return scanHrefDocument({ doc, target });
}

const summary = (result) => result.matches.map((m) => `${result.elements.find((e) => e.elementId === m.elementId).tag}:${m.attribute}`);

describe('Link scanning (parsed document)', () => {
  it('finds anchors, relative links, buttons, forms and svg links to the address', async () => {
    const result = await scanDoc(href(LINE));
    assert.deepEqual(summary(result), [
      'a:href', // absolute
      'a:href', // /en/
      'a:href', // http://line.me/en
      'button:onclick',
      'button:data-href',
      'form:action',
      'button:formaction',
      'a:href', // svg link
    ]);
    assert.equal(result.truncated, false);
  });

  it('leaves out buttons, forms and click handlers when switched off', async () => {
    const result = await scanDoc(href(LINE, { includeButtons: false }));
    assert.deepEqual(summary(result), ['a:href', 'a:href', 'a:href', 'a:href']);
  });

  it('is strict when asked to', async () => {
    const result = await scanDoc(href(LINE, { looseHost: false }));
    const values = result.matches.map((m) => m.text);
    assert.equal(values.includes('http://line.me/en'), false);
    assert.equal(values.includes('/en/'), true);
  });

  it('finds the instagram link with its escaped query', async () => {
    const result = await scanDoc(href(INSTAGRAM));
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].text, INSTAGRAM);
    assert.equal(result.matches[0].label, 'Instagram');
  });

  it('contains-search finds every link to a host', async () => {
    const result = await scanDoc(href('line.me', { exact: false }));
    assert.equal(result.matches.filter((m) => m.attribute === 'href').length, 5);
    assert.equal(result.matches.find((m) => m.text.includes('line.me')).text, 'line.me');
  });

  it('records the link text, the full address and the element', async () => {
    const result = await scanDoc(href(LINE));
    const first = result.matches[0];
    assert.equal(first.kind, 'href');
    assert.equal(first.label, 'LINE home');
    assert.equal(first.resolved, LINE);
    const relative = result.matches[1];
    assert.equal(relative.text, '/en/');
    assert.equal(relative.resolved, LINE);
    const element = result.elements.find((e) => e.elementId === first.elementId);
    assert.equal(element.tag, 'a');
    assert.equal(element.classes[0], 'brand');
    assert.equal(element.location.section, 'header');
    assert.equal(element.rendered, null);
  });

  it('ignores scripts and templates, and bare #fragment links', async () => {
    const result = await scanDoc(href(LINE));
    assert.equal(result.matches.some((m) => m.label === 'in template'), false);
    assert.equal((await scanDoc(href('https://www.line.me/'))).matches.length, 0);
    assert.equal((await scanDoc(href('#top'))).matches.length, 1);
  });

  it('finds nothing for an address nobody links to', async () => {
    assert.equal((await scanDoc(href('https://nobody.example/'))).matches.length, 0);
  });

  it('reports a link once per element and attribute', async () => {
    const result = await scanDoc(href('https://a.example/'), {
      html: '<button onclick="window.open(\'https://a.example/\'); location.href=\'https://a.example/\'">x</button>',
    });
    assert.equal(result.matches.length, 1);
  });
});

describe('Link scanning (live DOM)', () => {
  it('finds links on a rendered page and marks hidden ones', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<a id="shown" href="https://a.example/x">A</a><div style="display:none"><a id="gone" href="https://a.example/x">B</a></div>';
    document.body.append(root);
    created.push(root);
    const result = await scanHrefDocument({ root, target: href('https://a.example/x') });
    assert.equal(result.matches.length, 2);
    assert.deepEqual(
      result.elements.map((e) => [e.id, e.rendered]),
      [['shown', true], ['gone', false]],
    );
  });

  it('runScan dispatches link targets to the link scanner', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<a href="https://a.example/x">A</a>';
    document.body.append(root);
    created.push(root);
    const result = await runScan({ root, target: href('https://a.example/x') });
    assert.equal(result.matches[0].kind, 'href');
  });

  it('can be cancelled', async () => {
    const root = document.createElement('div');
    root.innerHTML = Array.from({ length: 3000 }, (_, i) => `<a href="/p${i}">p</a>`).join('');
    document.body.append(root);
    created.push(root);
    let calls = 0;
    await assert.rejects(
      scanHrefDocument({ root, target: href('/p1'), budgetMs: 0, isCancelled: () => (calls += 1) > 1 }),
    );
  });
});

/* -------------------------------------------------------- Renderer / API */

describe('Link search through requests and the invisible renderer', () => {
  it('accepts link queries as scan targets and sanitizes them', () => {
    assert.ok(isScanTarget(href(LINE)));
    assert.ok(!isScanTarget({ kind: 'href', url: 'two words' }));
    const request = parseScanRequest({ scanId: 's', tabId: 1, target: { kind: 'href', url: ` ${LINE} `, evil: 1 } });
    assert.equal(request.target.kind, 'href');
    assert.equal(request.target.url, LINE);
    assert.equal('evil' in request.target, false);
    assert.throws(() => parseScanRequest({ scanId: 's', tabId: 1, target: { kind: 'href', url: '' } }));
  });

  it('has sensible saved defaults', () => {
    assert.deepEqual(DEFAULT_SETTINGS.href, { query: '', exact: true, looseHost: true, includeButtons: true, groupMode: 'section' });
  });

  it('finds links of a served page without downloading stylesheets', async () => {
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
    const url = new URL('../fixtures/site/index.html', import.meta.url).href;
    const page = await renderer.scanUrl(url, { target: href('about.html', { exact: true }), options: { collectLinks: true }, timeoutMs: 15000 });
    assert.equal(page.matches.length >= 1, true);
    assert.equal(page.matches[0].text, 'about.html');
    assert.equal(page.matches[0].resolved, new URL('../fixtures/site/about.html', import.meta.url).href);
    assert.equal(requests.length, 1, 'only the HTML was downloaded');
    assert.equal(holder.querySelectorAll('iframe').length, 0);

    const byAddress = await renderer.scanUrl(url, { target: href(new URL('../fixtures/site/contact.html', import.meta.url).href), options: {}, timeoutMs: 15000 });
    assert.equal(byAddress.matches.length, 2, 'both relative contact.html links resolve against the served page');
    assert.equal(byAddress.matches[0].text, 'contact.html');
  });
});
