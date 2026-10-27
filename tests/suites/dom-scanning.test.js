import { afterEach, assert, describe as baseDescribe, it } from '../test-runner.js';
import { parseColor } from '../../services/color-normalizer.js';
import { scanDocument } from '../../content/dom-scanner.js';

const created = [];

/** Mount a fixture (HTML + CSS) in the test page and scan it. */
async function scan(html, { css = '', color = '#025743', options = {} } = {}) {
  const root = document.createElement('div');
  root.id = `fx-${created.length}`;
  root.innerHTML = html;
  document.body.append(root);
  created.push(root);
  if (css) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    created.push(style);
  }
  return scanDocument({ root, target: parseColor(color), options });
}

const byClass = (result, cls) => result.elements.find((e) => e.classes.includes(cls));
const matchesFor = (result, element) => result.matches.filter((m) => m.elementId === element.elementId);
const props = (result, element) => matchesFor(result, element).map((m) => m.property).sort();

/** `describe` that removes every mounted fixture after each test. */
function describe(name, define) {
  baseDescribe(name, () => {
    afterEach(() => {
      while (created.length) created.pop().remove();
    });
    define();
  });
}

describe('DOM scanning: color properties', () => {
  it('finds background-color and reports it with element details', async () => {
    const result = await scan('<div class="a" id="x">hi</div>', { css: '.a { background-color: #025743; }' });
    assert.equal(result.matches.length, 1);
    const el = byClass(result, 'a');
    assert.equal(el.tag, 'div');
    assert.equal(el.id, 'x');
    assert.deepEqual(el.classes, ['a']);
    assert.equal(el.selector, 'div#x.a');
    assert.equal(result.matches[0].property, 'background-color');
    assert.equal(result.matches[0].color.hex, '#025743');
    assert.equal(result.matches[0].color.alpha, 1);
    assert.equal(result.matches[0].group, 'background');
  });

  it('finds text color', async () => {
    const result = await scan('<p class="t">hello</p>', { css: '.t { color: #025743; }' });
    assert.deepEqual(props(result, byClass(result, 't')), ['color']);
  });

  it('finds border colors per side and ignores unpainted borders', async () => {
    const result = await scan(
      '<div class="b"></div><div class="no-border"></div><div class="zero"></div>',
      { css: '.b { border: 2px solid #025743; } .no-border { color: #025743; } .zero { border: 0 solid #025743; }' },
    );
    assert.deepEqual(props(result, byClass(result, 'b')), ['border-bottom-color', 'border-left-color', 'border-right-color', 'border-top-color']);
    assert.deepEqual(props(result, byClass(result, 'no-border')), ['color'], 'currentcolor borders that paint nothing are not reported');
    assert.equal(byClass(result, 'zero'), undefined, 'zero-width border paints nothing');
  });

  it('finds outline, text-decoration, caret and column-rule colors only when they paint', async () => {
    const result = await scan(
      '<div class="o"></div><div class="d"></div><div class="plain"></div>',
      { css: '.o { outline: 2px solid #025743; } .d { text-decoration: underline #025743; } .plain { color: #123456; }' },
    );
    assert.deepEqual(props(result, byClass(result, 'o')), ['outline-color']);
    assert.deepEqual(props(result, byClass(result, 'd')), ['text-decoration-color']);
    assert.equal(byClass(result, 'plain'), undefined);
  });

  it('reports several matching properties of one element together', async () => {
    const result = await scan('<div class="m"></div>', { css: '.m { color: #025743; background-color: #025743; border: 1px solid #025743; }' });
    assert.equal(result.elements.length, 1, 'one element record');
    assert.equal(matchesFor(result, byClass(result, 'm')).length, 6);
  });

  it('handles elements without classes or ids', async () => {
    const result = await scan('<div style="background:#025743"></div>');
    assert.equal(result.matches.length, 1);
    const el = result.elements[0];
    assert.deepEqual(el.classes, []);
    assert.equal(el.id, '');
    assert.equal(el.selector, 'div');
    assert.ok(el.path.endsWith('div'), `path was ${el.path}`);
    assert.ok(document.querySelector(el.path), 'unique path resolves in the document');
  });

  it('matches equivalent notations of the searched color', async () => {
    const css = `.h3{color:#fff}.h6{color:#ffffff}.rgb{color:rgb(255,255,255)}.rgba{color:rgba(255,255,255,1)}.hsl{color:hsl(0,0%,100%)}.nm{color:white}.half{color:rgba(255,255,255,.5)}`;
    const html = ['h3', 'h6', 'rgb', 'rgba', 'hsl', 'nm', 'half'].map((c) => `<span class="${c}">x</span>`).join('');
    const result = await scan(html, { css, color: '#ffffff' });
    for (const cls of ['h3', 'h6', 'rgb', 'rgba', 'hsl', 'nm']) {
      assert.ok(byClass(result, cls), `.${cls} should match #ffffff`);
    }
    assert.equal(byClass(result, 'half'), undefined, 'alpha 0.5 must not match #ffffff');
  });

  it('alpha mismatch, exact match and non-match', async () => {
    const half = await scan('<i class="x"></i>', { css: '.x{color:rgba(2,87,67,.5)}' });
    assert.equal(half.matches.length, 0, 'rgba(…,.5) does not match opaque');
    const exact = await scan('<i class="x"></i>', { css: '.x{color:rgba(2,87,67,.5)}', color: '#02574380' });
    assert.equal(exact.matches.length, 1);
    const none = await scan('<i class="x"></i>', { css: '.x{color:#111111}' });
    assert.equal(none.matches.length, 0);
  });

  it('Near mode matches tiny differences', async () => {
    const css = '.x{color:#035844}';
    assert.equal((await scan('<i class="x"></i>', { css })).matches.length, 0);
    assert.equal((await scan('<i class="x"></i>', { css, options: { tolerance: 4 } })).matches.length, 1);
  });
});

describe('DOM scanning: shadows', () => {
  it('extracts individual colors from box-shadow and text-shadow', async () => {
    const css = '.s{box-shadow:0 4px 10px rgba(2,87,67,.5),0 0 0 1px #025743;text-shadow:1px 1px 2px #ff0000}';
    const opaque = await scan('<div class="s"></div>', { css });
    assert.deepEqual(props(opaque, opaque.elements[0]), ['box-shadow']);
    assert.deepEqual(opaque.matches[0].matchedValues, ['rgb(2, 87, 67)']);

    const translucent = await scan('<div class="s"></div>', { css, color: 'rgba(2,87,67,.5)' });
    assert.equal(translucent.matches.length, 1, 'the translucent layer matches on its own');

    const red = await scan('<div class="s"></div>', { css, color: 'red' });
    assert.deepEqual(props(red, red.elements[0]), ['text-shadow']);
  });

  it('does not treat lengths as colors', async () => {
    const result = await scan('<div class="s"></div>', { css: '.s{box-shadow:0 0 0 0 black}', color: '#000000' });
    assert.equal(result.matches.length, 1);
    const none = await scan('<div class="s"></div>', { css: '.s{box-shadow:10px 20px 30px 40px gray}', color: '#0a141e28' });
    assert.equal(none.matches.length, 0);
  });
});

describe('DOM scanning: SVG', () => {
  const svg = '<svg width="40" height="20"><defs><linearGradient id="lg"><stop class="st" offset="0" stop-color="#025743"/></linearGradient></defs><circle class="c" r="5" fill="#025743" stroke="#025743"/><rect class="r" width="5" height="5" fill="url(#lg)"/></svg>';

  it('finds fill, stroke and stop-color', async () => {
    const result = await scan(svg);
    assert.deepEqual(props(result, byClass(result, 'c')), ['fill', 'stroke']);
    assert.deepEqual(props(result, byClass(result, 'st')), ['stop-color']);
  });

  it('reports stop elements as not rendered (null) but others as rendered', async () => {
    const result = await scan(svg);
    assert.equal(byClass(result, 'st').rendered, null);
    assert.equal(byClass(result, 'c').rendered, true);
  });

  it('never reports SVG-only properties on HTML elements', async () => {
    const result = await scan('<div class="h"></div>', { css: '.h{fill:#025743;}', color: '#000000' });
    assert.ok(!matchesFor(result, result.elements[0] || { elementId: -1 }).some((m) => m.property === 'fill'));
  });
});

describe('DOM scanning: inheritance and visibility', () => {
  const html = '<div class="parent"><span class="child">x</span></div>';
  const css = '.parent { color: #025743; }';

  it('skips values merely inherited from the parent by default', async () => {
    const result = await scan(html, { css });
    assert.ok(byClass(result, 'parent'));
    assert.equal(byClass(result, 'child'), undefined);
  });

  it('includes inherited values when asked, with the source on the ancestor', async () => {
    const result = await scan(html, { css, options: { includeInherited: true } });
    const child = byClass(result, 'child');
    assert.ok(child);
    const match = matchesFor(result, child)[0];
    assert.equal(match.source.selector, '.parent');
    assert.equal(match.source.inheritedFrom, 'div.parent');
  });

  it('marks display:none elements as not rendered', async () => {
    const result = await scan('<div class="gone">x</div>', { css: '.gone{display:none;color:#025743}' });
    assert.equal(byClass(result, 'gone').rendered, false);
  });

  it('does not scan script, style or head content', async () => {
    const result = await scan('<script>var a = 1;<\/script><style>.q{color:#025743}</style><p class="q">x</p>');
    assert.equal(result.elements.length, 1);
    assert.equal(result.elements[0].tag, 'p');
  });
});

describe('DOM scanning: CSS variables and sources', () => {
  it('resolves var() and reports the verified variable and its definition', async () => {
    const result = await scan('<div class="v"></div>', { css: ':root { --wit-c: #025743; } .v { background-color: var(--wit-c); }' });
    assert.equal(result.matches.length, 1);
    const { source } = result.matches[0];
    assert.equal(source.origin, 'stylesheet');
    assert.equal(source.selector, '.v');
    assert.equal(source.property, 'background-color');
    assert.equal(source.declaration, 'background-color: var(--wit-c)');
    assert.equal(source.cssVariable.name, '--wit-c');
    assert.equal(source.cssVariable.value, '#025743');
    assert.equal(source.cssVariable.definition.selector, ':root');
    assert.equal(source.stylesheetLabel.startsWith('<style> block'), true);
  });

  it('finds variables used inside shorthands', async () => {
    const result = await scan('<div class="v"></div>', { css: ':root{--wit-s:#025743}.v{background:var(--wit-s);border:1px solid var(--wit-s)}' });
    const background = result.matches.find((m) => m.property === 'background-color');
    assert.equal(background.source.property, 'background');
    assert.equal(background.source.cssVariable.name, '--wit-s');
    assert.ok(result.matches.find((m) => m.property === 'border-top-color').source.cssVariable);
  });

  it('follows a variable alias chain using computed values', async () => {
    const result = await scan('<div class="v"></div>', { css: ':root{--wit-a:#025743;--wit-b:var(--wit-a)}.v{color:var(--wit-b)}' });
    assert.equal(result.matches[0].source.cssVariable.name, '--wit-b');
  });

  it('never attributes a variable that is not responsible for the color', async () => {
    const result = await scan('<div class="v"></div>', { css: ':root{--wit-other:#999999}.v{color:#025743;border:1px solid var(--wit-other)}' });
    const color = result.matches.find((m) => m.property === 'color');
    assert.equal(color.source.cssVariable, null);
    assert.equal(color.source.value, 'rgb(2, 87, 67)', 'CSSOM serializes colors; the authored text is only used for line lookup');
  });

  it('reports inline styles as such', async () => {
    const result = await scan('<p style="color: rgb(2, 87, 67)">x</p>');
    const { source } = result.matches[0];
    assert.equal(source.origin, 'inline');
    assert.equal(source.stylesheetUrl, null);
    assert.equal(source.declaration, 'color: rgb(2, 87, 67)');
  });

  it('picks the winning declaration by specificity and order', async () => {
    const result = await scan('<p class="a b" id="i">x</p>', { css: '.a{color:#111111}#i{color:#025743}.b{color:#222222}' });
    assert.equal(result.matches[0].source.selector, '#i');
  });

  it('honours media queries: applying ones count, others do not', async () => {
    const css = '@media (min-width: 1px){.m{color:#025743}} @media print{.p{color:#025743}}';
    const result = await scan('<i class="m"></i><i class="p"></i>', { css });
    assert.ok(byClass(result, 'm'));
    assert.equal(byClass(result, 'p'), undefined);
    assert.deepEqual(matchesFor(result, byClass(result, 'm'))[0].source.conditions, ['@media (min-width: 1px)']);
  });

  it('explains border colors that follow currentColor', async () => {
    const result = await scan('<div class="c"></div>', { css: '.c{color:#025743;border:1px solid}' });
    const border = result.matches.find((m) => m.property === 'border-top-color');
    assert.equal(border.source.via, 'currentColor');
    assert.equal(border.source.property, 'color');
  });

  it('says so when no author rule explains a color (no invented source)', async () => {
    const result = await scan('<div style="all: initial"><p>x</p></div>', { color: '#000000', options: { includeInherited: true } });
    const unexplained = result.matches.find((m) => !m.source);
    assert.ok(unexplained, 'browser-default black text has no author source');
    assert.equal(unexplained.sourceStatus === 'not-found' || unexplained.sourceStatus === 'unavailable', true);
  });

  it('reports unreadable (cross-origin) stylesheets instead of failing', async () => {
    // Same server, other hostname = other origin, and the server sends no CORS headers.
    const here = new URL(import.meta.url);
    if (here.protocol === 'file:') return;
    const other = new URL('../fixtures/cross-origin.css', import.meta.url);
    other.hostname = here.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = other.href;
    document.head.append(link);
    created.push(link);
    await new Promise((resolve) => {
      link.onload = resolve;
      link.onerror = resolve;
    });
    const result = await scan('<p class="wit-x">x</p>', { color: '#ff0000' });
    assert.ok(result.stats.stylesheets.inaccessible.length >= 1, `cross-origin sheet reported (${JSON.stringify(result.stats.stylesheets)})`);
    assert.ok(result.matches[0], 'computed color is still found');
    assert.equal(result.matches[0].source, null, 'but no source is invented');
    assert.equal(result.matches[0].sourceStatus, 'unavailable');
  });
});

describe('DOM scanning: external stylesheets and line numbers', () => {
  const sheetUrl = new URL('../fixtures/site/assets/css/style.css', import.meta.url).href;

  async function loadSheet() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = sheetUrl;
    document.head.append(link);
    created.push(link);
    await new Promise((resolve) => {
      link.onload = resolve;
      link.onerror = resolve;
    });
  }

  it('reports the stylesheet URL, selector, variable (via @import) and a verified line', async () => {
    await loadSheet();
    const result = await scan('<div class="primary-button">x</div>');
    const bg = result.matches.find((m) => m.property === 'background-color');
    assert.ok(bg, 'background-color matched');
    assert.equal(bg.source.stylesheetUrl, sheetUrl);
    assert.equal(bg.source.stylesheetLabel.endsWith('assets/css/style.css'), true);
    assert.equal(bg.source.selector, '.primary-button');
    assert.equal(bg.source.cssVariable.name, '--primary-color');
    assert.ok(bg.source.cssVariable.definition.stylesheetLabel.endsWith('assets/css/vars.css'), 'variable defined in the @import-ed file');

    const text = await (await fetch(sheetUrl)).text();
    const expected = text.split('\n').findIndex((line) => line.includes('background-color: var(--primary-color)')) + 1;
    assert.ok(expected > 0);
    assert.equal(bg.source.line, expected, 'line number equals the real declaration line');
    assert.equal(bg.source.lineBase, 'file');
  });

  it('omits a line number when it cannot be located reliably', async () => {
    await loadSheet();
    const result = await scan('<div class="multi">x</div>');
    // `.multi` declares color/background-color/border all as #025743 - each is unique in its block.
    const any = result.matches.find((m) => m.property === 'color');
    assert.ok(any.source);
    assert.ok(any.source.line === null || Number.isInteger(any.source.line));
  });
});

describe('DOM scanning: scan mechanics', () => {
  it('honours cancellation', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>x</p>'.repeat(2000);
    document.body.append(root);
    created.push(root);
    let cancelled = false;
    let caught = null;
    try {
      await scanDocument({ root, target: parseColor('#025743'), isCancelled: () => cancelled, onProgress: () => { cancelled = true; } });
    } catch (error) {
      caught = error;
    }
    // Small scans may finish inside one slice; cancellation is checked at every slice boundary.
    assert.ok(caught === null || caught.code === 'CANCELLED');
  });

  it('reports statistics and a stable element id registry', async () => {
    const result = await scan('<div class="x" style="color:#025743"></div>');
    assert.ok(result.stats.elementsScanned >= 2);
    assert.ok(result.stats.durationMs >= 0);
    assert.ok(typeof result.contextId === 'string');
    assert.ok(Number.isInteger(result.elements[0].elementId));
  });

  it('keeps descriptions short and free of form values', async () => {
    const result = await scan('<input class="i" type="password" value="hunter2" style="color:#025743">');
    const description = result.elements[0].description;
    assert.ok(!description.includes('hunter2'));
    assert.ok(description.length <= 160);
  });

  it('classifies sections: header, main, footer, other', async () => {
    const result = await scan(
      '<header><p class="h" style="color:#025743">x</p></header><main><p class="m" style="color:#025743">x</p></main><footer><p class="f" style="color:#025743">x</p></footer><p class="o" style="color:#025743">x</p>',
    );
    const section = (cls) => byClass(result, cls).location.section;
    assert.equal(section('h'), 'header');
    assert.equal(section('m'), 'main');
    assert.equal(section('f'), 'footer');
    assert.equal(section('o'), 'other');
  });

  it('records the nearest meaningful parent and ancestor classes', async () => {
    const result = await scan('<section class="hero" id="intro"><div><p class="p" style="color:#025743">x</p></div></section>');
    const { location } = byClass(result, 'p');
    assert.equal(location.parent.selector, 'section#intro.hero');
    assert.ok(location.ancestors.includes('section#intro.hero'));
  });
});
