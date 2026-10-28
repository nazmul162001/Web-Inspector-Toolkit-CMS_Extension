import { afterEach, assert, describe as baseDescribe, it } from '../test-runner.js';
import {
  createFontMatcher,
  describeFontQuery,
  extractFontNames,
  familiesOfDeclaration,
  fontFaceFiles,
  googleFontFamilies,
  isFontQuery,
  parseFontInput,
  sanitizeFontQuery,
  splitFontStack,
} from '../../services/font-matcher.js';
import { scanFontDocument } from '../../content/font-scanner.js';
import { runScan } from '../../content/run-scan.js';
import { createBackgroundRenderer } from '../../services/background-renderer.js';
import { isScanTarget, parseScanRequest } from '../../shared/validators.js';
import { DEFAULT_SETTINGS } from '../../services/settings-service.js';

const font = (input, extra = {}) => {
  const parsed = parseFontInput(input, extra);
  assert.ok(parsed.ok, `"${input}" is valid`);
  return parsed.query;
};

/** Names of a stack that a query matches, or null. */
const find = (input, stack, extra) => createFontMatcher(font(input, extra)).match(splitFontStack(stack));

const created = [];
function describe(name, define) {
  baseDescribe(name, () => {
    afterEach(() => {
      while (created.length) created.pop().remove();
    });
    define();
  });
}

describe('Font input', () => {
  it('accepts plain, quoted, Japanese and multi-word names', () => {
    for (const input of ['Roboto', '"Noto Sans JP"', "'Noto Sans JP', Meiryo", '游ゴシック', 'Hiragino Kaku Gothic ProN', 'sans-serif', 'Font Awesome 6 Free']) {
      assert.ok(parseFontInput(input).ok, input);
    }
    assert.deepEqual(font("'Noto Sans JP', Meiryo").families, ['Noto Sans JP', 'Meiryo']);
    assert.deepEqual(font('  Noto   Sans  JP ').families, ['Noto Sans JP']);
    assert.deepEqual(font('"A, B"').families, ['A, B']);
  });

  it('removes duplicates and rejects bad input with a message', () => {
    assert.deepEqual(font('Roboto, roboto, "ROBOTO"').families, ['Roboto']);
    const tooMany = Array.from({ length: 11 }, (_, i) => `Font${i}`).join(',');
    for (const input of ['', '   ', ',,', 'a{b}', 'x;y', '<b>', tooMany, 'x'.repeat(101)]) {
      const result = parseFontInput(input);
      assert.equal(result.ok, false, input);
      assert.ok(result.error.length > 5);
    }
  });

  it('defaults the options and sanitizes untrusted objects', () => {
    assert.deepEqual(font('Roboto'), { kind: 'font', families: ['Roboto'], use: 'first', exact: true, primaryOnly: false, includeInherited: false });
    assert.equal(font('Roboto', { exact: false, primaryOnly: true, includeInherited: true }).primaryOnly, true);
    const clean = sanitizeFontQuery({ kind: 'font', families: ['Noto Sans JP', 'A, B', 7], exact: false, evil: 1 });
    assert.deepEqual(clean.families, ['Noto Sans JP', 'A, B']);
    assert.equal(clean.exact, false);
    assert.equal('evil' in clean, false);
    assert.equal(sanitizeFontQuery({ kind: 'font', families: [] }), null);
    assert.equal(sanitizeFontQuery({ kind: 'text', families: ['A'] }), null);
    assert.equal(isFontQuery(font('Roboto')), true);
  });
});

describe('Font input - any way of writing it', () => {
  const NOTO = ['Noto Sans JP'];
  const names = (input) => {
    const result = extractFontNames(input);
    assert.ok(result.ok, input);
    return result.names;
  };

  it('reads the same font from a name, a list and a pasted CSS declaration', () => {
    for (const input of [
      'Noto Sans JP',
      '"Noto Sans JP"',
      "'noto sans jp'",
      'font-family: "Noto Sans JP"',
      'font-family: "Noto Sans JP";',
      '    font-family: "Noto Sans JP"',
      'FONT-FAMILY :   "Noto Sans JP"  ;  ',
      'font-family:"Noto Sans JP"!important;',
      '\n\tfont-family:\n\t  "Noto Sans JP";\n',
      '.title { font-family: "Noto Sans JP"; }',
      '<p style="font-family: \'Noto Sans JP\'">',
      '/* heading */ font-family: "Noto Sans JP" /* jp */;',
    ]) {
      assert.deepEqual(font(input).families.map((n) => n.toLowerCase()), ['noto sans jp'], input);
    }
    assert.deepEqual(names('Noto Sans JP'), NOTO);
  });

  it('reads a whole list, however it is written', () => {
    const want = ['Noto Sans JP', 'arial', 'sans-serif'];
    for (const input of [
      '"Noto Sans JP", arial, sans-serif',
      'font-family: "Noto Sans JP", arial, sans-serif;',
      '    font-family: "Noto Sans JP", arial, sans-serif',
      'font-family: "Noto Sans JP",\n    arial,\n    sans-serif;',
      "font-family: 'Noto Sans JP' , arial , sans-serif !important",
      'body { margin: 0; font-family: "Noto Sans JP", arial, sans-serif; color: red }',
      'Noto Sans JP, arial, sans-serif',
      '"Noto Sans JP", arial, sans-serif;',
      'font-family: "Noto Sans JP", arial, sans-serif,',
    ]) {
      assert.deepEqual(names(input), want, input);
    }
  });

  it('reads the font shorthand and several declarations', () => {
    assert.deepEqual(names('font: italic 700 16px/1.5 "Noto Sans JP", arial'), ['Noto Sans JP', 'arial']);
    assert.deepEqual(names('a { font-family: Roboto } b { font-family: Arial, Roboto }'), ['Roboto', 'Arial', 'Roboto']);
    assert.deepEqual(font('a { font-family: Roboto } b { font-family: Arial, Roboto }').families, ['Roboto', 'Arial']);
    assert.equal(extractFontNames('font-family: "Noto Sans JP"').from, 'declaration');
    assert.equal(extractFontNames('"Noto Sans JP"').from, 'list');
  });

  it('keeps names that contain punctuation inside quotes, and does not mistake other properties for fonts', () => {
    assert.deepEqual(names('font-family: "A, B", C'), ['A, B', 'C']);
    assert.deepEqual(names('color: red; font-family: Roboto; line-height: 1.5'), ['Roboto']);
    assert.equal(extractFontNames('font-size: 12px').ok, false);
    assert.equal(extractFontNames('-webkit-font-smoothing: antialiased').ok, false);
  });

  it('explains what it cannot read', () => {
    for (const input of ['font-family: var(--main-font)', 'font-family: ;', 'color: red', 'font: caption', 'a;b']) {
      const result = parseFontInput(input);
      assert.equal(result.ok, false, input);
      assert.ok(result.error.length > 10, input);
    }
    assert.ok(parseFontInput('font-family: var(--x)').error.includes('variable'));
    assert.equal(parseFontInput('x'.repeat(2100)).ok, false);
  });

  it('describes what is searched', () => {
    assert.equal(describeFontQuery(font('Noto Sans JP')), 'Looking for the font "Noto Sans JP".');
    assert.ok(describeFontQuery(font('font-family: "Noto Sans JP", arial')).includes('the others are ignored'));
    assert.ok(describeFontQuery(font('A, B', { use: 'any' })).startsWith('Looking for any of "A", "B"'));
    assert.ok(describeFontQuery(font('A, B', { use: 'list' })).includes('"A" then "B" together, in that order'));
    assert.ok(describeFontQuery(font('A', { exact: false })).includes('partial'));
  });

  it('searches the first font of a pasted list by default, so every spelling finds the same elements', () => {
    const stack = '"Noto Sans JP", arial, sans-serif';
    for (const input of ['Noto Sans JP', 'font-family: "Noto Sans JP", arial, sans-serif;', '    font-family: "Noto Sans JP"']) {
      assert.deepEqual(find(input, stack).matched, ['Noto Sans JP'], input);
    }
    assert.equal(find('font-family: "Noto Sans JP", arial', 'Roboto, arial'), null, 'arial alone is not "the font"');
  });
});

describe('Font lists and declarations', () => {
  it('splits a font-family list', () => {
    assert.deepEqual(splitFontStack('"Noto Sans JP", Meiryo, sans-serif'), ['Noto Sans JP', 'Meiryo', 'sans-serif']);
    assert.deepEqual(splitFontStack("'A, B',C"), ['A, B', 'C']);
    assert.deepEqual(splitFontStack('Hiragino Kaku Gothic ProN,  Meiryo'), ['Hiragino Kaku Gothic ProN', 'Meiryo']);
    assert.deepEqual(splitFontStack(''), []);
    assert.deepEqual(splitFontStack('a,,b'), ['a', 'b']);
  });

  it('reads the family part of font-family and the font shorthand', () => {
    assert.deepEqual(familiesOfDeclaration('font-family', 'Roboto, sans-serif'), ['Roboto', 'sans-serif']);
    assert.deepEqual(familiesOfDeclaration('font', 'italic bold 16px/1.5 "Noto Sans", Arial'), ['Noto Sans', 'Arial']);
    assert.deepEqual(familiesOfDeclaration('font', 'small-caps 400 0.9em Roboto'), ['Roboto']);
    assert.deepEqual(familiesOfDeclaration('font', '12px serif'), ['serif']);
    assert.deepEqual(familiesOfDeclaration('font', 'caption'), []);
    assert.deepEqual(familiesOfDeclaration('font-family', 'inherit'), []);
    assert.deepEqual(familiesOfDeclaration('font-size', '12px'), []);
  });

  it('finds Google Fonts families and @font-face files', () => {
    assert.deepEqual(googleFontFamilies('https://fonts.googleapis.com/css2?family=Waterfall&family=Roboto:wght@400;700&display=swap'), ['Waterfall', 'Roboto']);
    assert.deepEqual(googleFontFamilies('https://fonts.googleapis.com/css?family=Open+Sans:400,700|Roboto'), ['Open Sans', 'Roboto']);
    assert.deepEqual(googleFontFamilies('https://example.com/css?family=Roboto'), []);
    assert.deepEqual(googleFontFamilies('not a url'), []);
    assert.deepEqual(fontFaceFiles('url(a.woff2) format("woff2"), url("b/c.woff") format(woff), local(Foo)', 'https://x.example/css/site.css'), [
      { url: 'https://x.example/css/a.woff2', format: 'woff2' },
      { url: 'https://x.example/css/b/c.woff', format: 'woff' },
    ]);
  });
});

describe('Font matching', () => {
  it('matches a name anywhere in the list, ignoring quotes, case, spaces and full-width letters', () => {
    assert.deepEqual(find('roboto', 'Roboto, sans-serif').matched, ['Roboto']);
    assert.deepEqual(find('"noto  sans jp"', '"Noto Sans JP", Meiryo').matched, ['Noto Sans JP']);
    assert.equal(find('Meiryo', '"Noto Sans JP", Meiryo').position, 2);
    assert.equal(find('Ｒｏｂｏｔｏ', 'Roboto').position, 1);
    assert.equal(find('sans-serif', 'Roboto, sans-serif').position, 2);
  });

  it('is exact by default and a substring search when asked', () => {
    assert.equal(find('Roboto', '"Roboto Slab", serif'), null);
    assert.equal(find('Noto', '"Noto Sans JP"'), null);
    assert.deepEqual(find('Noto', '"Noto Sans JP", "Noto Serif"', { exact: false }).matched, ['Noto Sans JP', 'Noto Serif']);
    assert.equal(find('Noto', 'Roboto', { exact: false }), null);
  });

  it('can be limited to the first choice', () => {
    assert.ok(find('Roboto', 'Roboto, Arial', { primaryOnly: true }));
    assert.equal(find('Arial', 'Roboto, Arial', { primaryOnly: true }), null);
    assert.equal(find('Roboto', '', { primaryOnly: true }), null);
  });

  it('can require all typed fonts, in order', () => {
    const typed = 'font-family: "Noto Sans JP", arial, sans-serif';
    assert.deepEqual(find(typed, '"Noto Sans JP", arial, sans-serif', { use: 'list' }).matched, ['Noto Sans JP', 'arial', 'sans-serif']);
    assert.ok(find(typed, '"Noto Sans JP", Meiryo, Arial, serif, sans-serif', { use: 'list' }), 'other fonts may sit between');
    assert.equal(find(typed, 'arial, "Noto Sans JP", sans-serif', { use: 'list' }), null, 'order matters');
    assert.equal(find(typed, '"Noto Sans JP", sans-serif', { use: 'list' }), null, 'every font is needed');
    assert.equal(find(typed, 'Roboto, "Noto Sans JP", arial, sans-serif', { use: 'list', primaryOnly: true }), null);
    assert.equal(find(typed, 'Roboto, "Noto Sans JP", arial, sans-serif', { use: 'list' }).position, 2);
    assert.ok(find('Noto, ari', '"Noto Sans JP", arial', { use: 'list', exact: false }));
  });

  it('searches only the first typed font unless told otherwise', () => {
    assert.equal(find('Arial, Roboto', 'Roboto, Helvetica'), null, 'Roboto is not the first typed font');
    assert.ok(find('Roboto, Arial', 'Roboto, Helvetica'));
  });

  it('finds any of several names', () => {
    const hit = find('Arial, Roboto', 'Roboto, Helvetica, Arial', { use: 'any' });
    assert.deepEqual(hit.matched, ['Roboto', 'Arial']);
    assert.equal(hit.position, 1);
    assert.equal(find('Verdana, Tahoma', 'Roboto, Arial', { use: 'any' }), null);
  });
});

/* -------------------------------------------------------------- Scanning */

const STYLE = `
  @font-face { font-family: "Test Face"; src: url(fonts/test.woff2) format("woff2"), url(fonts/test.woff) format("woff"); font-weight: 700; }
  .t-root { font-family: "Test Face", Georgia, serif; }
  .t-fallback { font-family: Georgia, "Test Face", serif; }
  .t-var { --t-font: "Test Face", monospace; font-family: var(--t-font); }
  .t-short { font: italic 16px/1.4 "Test Face", serif; }
  #t-lose { font-family: "Test Face"; }
  .t-lose-class { font-family: Arial !important; }
`;

const HTML = `
  <div class="t-root" id="r"><p id="child">inherits text</p><span id="other" style="font-family: 'Other One', sans-serif">x</span></div>
  <div class="t-fallback" id="fb">fb</div>
  <div class="t-var" id="v">var</div>
  <div class="t-short" id="s">short</div>
  <div class="t-root"><section id="wrap"><p id="deep">deep text</p></section></div>
  <div id="t-lose" class="t-lose-class">overridden by !important</div>
  <div id="inline" style="font-family: 'Test Face', cursive">inline</div>`;

async function scan(target, options) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  const root = document.createElement('div');
  root.innerHTML = HTML;
  document.body.append(root);
  created.push(style, root);
  const result = await scanFontDocument({ root, target, options });
  const byId = new Map(result.matches.map((m) => [result.elements.find((e) => e.elementId === m.elementId).id, m]));
  return { result, byId, ids: result.elements.map((e) => e.id) };
}

describe('Font scanning (live DOM)', () => {
  it('reports where the font is applied, not every element that inherits it', async () => {
    const { ids } = await scan(font('Test Face'));
    assert.deepEqual(ids, ['r', 'fb', 'v', 's', '', 'inline']);
  });

  it('knows the place in the list and whether it was set or inherited', async () => {
    const { byId } = await scan(font('Test Face'));
    assert.equal(byId.get('r').position, 1);
    assert.equal(byId.get('fb').position, 2);
    assert.equal(byId.get('v').position, 1);
    assert.equal(byId.get('s').position, 1);
    assert.equal(byId.get('r').inherited, false);
    assert.deepEqual(byId.get('fb').families, ['Georgia', 'Test Face', 'serif']);
    assert.equal(byId.get('fb').computed, 'Georgia, "Test Face", serif');
    assert.equal(byId.get('r').kind, 'font');
  });

  it('limits to the first choice', async () => {
    const { ids } = await scan(font('Test Face', { primaryOnly: true }));
    assert.deepEqual(ids, ['r', 'v', 's', '', 'inline']);
  });

  it('also lists elements that inherit it when they show their own text', async () => {
    const { ids, byId } = await scan(font('Test Face', { includeInherited: true }));
    assert.deepEqual(ids, ['r', 'child', 'fb', 'v', 's', '', 'deep', 'inline']);
    assert.equal(byId.get('child').inherited, true);
    assert.equal(ids.includes('wrap'), false, 'a wrapper without text of its own is not a result');
    assert.equal(ids.includes('other'), false, 'a child that sets another font is not a result');
  });

  it('can search by part of a name', async () => {
    assert.equal((await scan(font('Test'))).ids.length, 0);
    assert.equal((await scan(font('Test', { exact: false }))).ids.length, 6);
  });

  it('searches generic families and several names', async () => {
    const generic = await scan(font('monospace'));
    assert.deepEqual(generic.ids, ['v']);
    assert.equal(generic.byId.get('v').face.status, 'generic');
    assert.deepEqual((await scan(font('cursive, monospace', { use: 'any' }))).ids, ['v', 'inline']);
  });

  it('describes the web font behind the match', async () => {
    const { byId } = await scan(font('Test Face'));
    const face = byId.get('r').face;
    assert.equal(face.status, 'font-face');
    assert.deepEqual(face.files.map((f) => [f.format, f.url.split('/').slice(-2).join('/'), f.weight]), [
      ['woff2', 'fonts/test.woff2', '700'],
      ['woff', 'fonts/test.woff', '700'],
    ]);
    const system = (await scan(font('Georgia'))).byId.get('r').face;
    assert.ok(['none', 'unreadable'].includes(system.status), 'no @font-face rule is claimed for a system font');
    assert.deepEqual(system.files, []);
  });

  it('finds the CSS rule that asks for the font', async () => {
    const { byId } = await scan(font('Test Face'));
    const rule = byId.get('r').source;
    assert.equal(byId.get('r').sourceStatus, 'found');
    assert.equal(rule.origin, 'stylesheet');
    assert.equal(rule.selector, '.t-root');
    assert.equal(rule.property, 'font-family');
    assert.equal(rule.declaration, 'font-family: "Test Face", Georgia, serif');
    assert.ok(rule.stylesheetLabel.startsWith('<style> block'));
    assert.ok(Number.isInteger(rule.line), 'the line is located in the <style> block');
    assert.equal(rule.inheritedFrom, null);

    const inline = byId.get('inline').source;
    assert.equal(inline.origin, 'inline');
    assert.equal(inline.selector, 'element.style');
    assert.equal(inline.line, null);

    assert.equal(byId.get('s').source.property, 'font');
    assert.equal(byId.get('fb').source.selector, '.t-fallback');
  });

  it('names the CSS variable and where an inherited font comes from', async () => {
    const { byId } = await scan(font('Test Face', { includeInherited: true }));
    const variable = byId.get('v').source.cssVariable;
    assert.equal(variable.name, '--t-font');
    assert.equal(variable.definition.selector, '.t-var');
    const inherited = byId.get('child').source;
    assert.equal(inherited.selector, '.t-root');
    assert.ok(inherited.inheritedFrom.includes('t-root'));
  });

  it('never invents a source: a rule that loses is not reported, and sources can be switched off', async () => {
    const lost = await scan(font('Arial'));
    assert.deepEqual(lost.ids, ['t-lose']);
    assert.equal(lost.byId.get('t-lose').source.selector, '.t-lose-class');
    assert.equal(lost.byId.get('t-lose').source.value, 'Arial');
    assert.equal((await scan(font('Test Face'), { withSources: false })).byId.get('r').source, null);
  });

  it('marks hidden elements and ignores other fonts', async () => {
    assert.equal((await scan(font('Nonexistent Font'))).ids.length, 0);
  });

  it('runScan dispatches font targets and the scan can be cancelled', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<p style="font-family: Zed">a</p>';
    document.body.append(root);
    created.push(root);
    const result = await runScan({ root, target: font('Zed') });
    assert.equal(result.matches[0].kind, 'font');

    const big = document.createElement('div');
    big.innerHTML = Array.from({ length: 2000 }, () => '<p style="font-family: Zed">a</p>').join('');
    document.body.append(big);
    created.push(big);
    let calls = 0;
    await assert.rejects(scanFontDocument({ root: big, target: font('Zed'), budgetMs: 0, isCancelled: () => (calls += 1) > 1 }));
  });
});

/* -------------------------------------------------------- Renderer / API */

describe('Font search through requests and the invisible renderer', () => {
  it('accepts font queries as scan targets and sanitizes them', () => {
    assert.ok(isScanTarget(font('Roboto')));
    assert.ok(!isScanTarget({ kind: 'font', families: [] }));
    const request = parseScanRequest({ scanId: 's', tabId: 1, target: { kind: 'font', families: ['Roboto'], evil: 1 } });
    assert.equal(request.target.kind, 'font');
    assert.deepEqual(request.target.families, ['Roboto']);
    assert.equal('evil' in request.target, false);
    assert.throws(() => parseScanRequest({ scanId: 's', tabId: 1, target: { kind: 'font', families: [] } }));
  });

  it('has sensible saved defaults', () => {
    assert.deepEqual(DEFAULT_SETTINGS.font, { query: '', use: 'first', exact: true, primaryOnly: false, includeInherited: false, groupMode: 'section' });
  });

  it('finds the font of a served page, with its web font file and source', async () => {
    const holder = document.createElement('div');
    document.body.append(holder);
    created.push(holder);
    const renderer = createBackgroundRenderer({ container: holder });
    const url = new URL('../fixtures/fonts.html', import.meta.url).href;

    const page = await renderer.scanUrl(url, { target: font('Fixture Sans'), options: {}, timeoutMs: 20000 });
    assert.equal(page.matches.length, 2);
    const heading = page.matches[0];
    assert.equal(heading.position, 1);
    assert.equal(heading.face.status, 'font-face');
    assert.equal(heading.face.files[0].url, new URL('../fixtures/fonts/fixture.woff2', import.meta.url).href);
    assert.equal(heading.source.selector, 'h1');
    assert.equal(page.matches[1].position, 2);
    assert.equal(page.elements[1].classes[0], 'note');

    const body = await renderer.scanUrl(url, { target: font('Georgia'), options: {}, timeoutMs: 20000 });
    assert.equal(body.matches.length, 1);
    assert.equal(body.elements[0].tag, 'body');
  });
});
