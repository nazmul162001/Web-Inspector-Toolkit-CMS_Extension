import { afterEach, assert, describe as baseDescribe, it } from '../test-runner.js';
import {
  WIDTH_CATEGORIES,
  convertWidth,
  createWidthMatcher,
  describeWidthQuery,
  isWidthQuery,
  parseWidthInput,
  sanitizeWidthQuery,
} from '../../services/width-matcher.js';
import { scanWidthDocument } from '../../content/width-scanner.js';
import { clearMarks, collectRanges, marksSupported } from '../../content/width-marks.js';
import { runScan } from '../../content/run-scan.js';
import { createBackgroundRenderer } from '../../services/background-renderer.js';
import { isScanTarget, parseScanRequest } from '../../shared/validators.js';
import { DEFAULT_SETTINGS } from '../../services/settings-service.js';
import { FEATURES, FEATURE_STATUS } from '../../shared/constants.js';

const query = (flags = {}) => {
  const parsed = parseWidthInput('', flags);
  assert.ok(parsed.ok);
  return parsed.query;
};
const only = (id, extra = {}) => query({ ...Object.fromEntries(WIDTH_CATEGORIES.map((c) => [c.id, false])), [id]: true, ...extra });
const runsOf = (text, q) => createWidthMatcher(q).find(text).map((run) => text.slice(run.start, run.end));

const created = [];
function describe(name, define) {
  baseDescribe(name, () => {
    afterEach(() => {
      clearMarks();
      while (created.length) created.pop().remove();
    });
    define();
  });
}

describe('Width query', () => {
  it('defaults to every kind of full-width character', () => {
    const q = query();
    assert.equal(q.kind, 'width');
    assert.equal(q.mode, 'full');
    assert.ok(q.categories.includes('number') && q.categories.includes('space'));
    assert.ok(!q.categories.includes('kana'), 'half-width katakana does not exist in full-width form');
    assert.equal(q.highlightOnPage, true);
  });

  it('half-width mode offers katakana but not spaces', () => {
    const q = query({ mode: 'half' });
    assert.ok(q.categories.includes('kana'));
    assert.ok(!q.categories.includes('space'));
  });

  it('asks for at least one kind', () => {
    const none = Object.fromEntries(WIDTH_CATEGORIES.map((c) => [c.id, false]));
    const result = parseWidthInput('', none);
    assert.equal(result.ok, false);
    assert.ok(result.error.length > 0);
  });

  it('sanitizes untrusted queries', () => {
    assert.equal(sanitizeWidthQuery(null), null);
    assert.equal(sanitizeWidthQuery({ kind: 'text' }), null);
    assert.equal(sanitizeWidthQuery({ kind: 'width', categories: ['nonsense'] }), null);
    const clean = sanitizeWidthQuery({ kind: 'width', mode: 'weird', categories: ['number', 'bogus', 'colon'], highlightOnPage: 0, extra: 1 });
    assert.deepEqual(clean, { kind: 'width', mode: 'full', categories: ['number', 'colon'], highlightOnPage: true });
    assert.ok(isWidthQuery(clean));
    assert.ok(!isWidthQuery({ kind: 'width' }));
  });

  it('describes the search in a sentence', () => {
    assert.equal(describeWidthQuery(only('number')), 'Looking for full-width numbers.');
    assert.ok(describeWidthQuery(only('number', { colon: true })).includes('numbers and colons'));
    assert.ok(describeWidthQuery(query({ mode: 'half' })).startsWith('Looking for half-width'));
  });
});

describe('Width matching', () => {
  it('finds a run of full-width numbers once', () => {
    assert.deepEqual(runsOf('２０２４年は2024年', only('number')), ['２０２４']);
  });

  it('finds parentheses, colons, percent and marks', () => {
    assert.deepEqual(runsOf('（税込）', only('bracket')), ['（', '）']);
    assert.deepEqual(runsOf('割引率：５０％', only('colon')), ['：']);
    assert.deepEqual(runsOf('割引率：５０％', only('percent')), ['％']);
    assert.deepEqual(runsOf('なぜ？ はい！', only('mark')), ['？', '！']);
  });

  it('joins neighbouring kinds into one run and reports the kinds', () => {
    const q = query();
    const [run] = createWidthMatcher(q).find('x ０３－１２３４ y');
    assert.deepEqual(run.kinds.sort(), ['number', 'symbol']);
    assert.equal('x ０３－１２３４ y'.slice(run.start, run.end), '０３－１２３４');
  });

  it('only reports the ticked kinds', () => {
    assert.deepEqual(runsOf('１２（３）', only('number')), ['１２', '３']);
  });

  it('finds ideographic spaces', () => {
    assert.deepEqual(runsOf('割引　対象', only('space')), ['\u3000']);
  });

  it('ignores normal Japanese punctuation and kana', () => {
    assert.deepEqual(runsOf('これは、「テスト」です。ー【】', query()), []);
  });

  it('finds half-width characters in half mode', () => {
    assert.deepEqual(runsOf('2024年 (税込) 100%', only('number', { mode: 'half' })), ['2024', '100']);
    assert.deepEqual(runsOf('ｶﾀｶﾅ と カタカナ', only('kana', { mode: 'half' })), ['ｶﾀｶﾅ']);
    assert.deepEqual(runsOf('２０２４', query({ mode: 'half' })), []);
  });

  it('honours the match limit', () => {
    assert.equal(createWidthMatcher(only('number')).find('１ ２ ３ ４', 2).length, 2);
  });
});

describe('Width conversion', () => {
  it('converts full-width to half-width', () => {
    assert.equal(convertWidth('２０２４（税込）：５０％　円', 'half'), '2024(税込):50% 円');
    assert.equal(convertWidth('Ａｂｃ！？', 'half'), 'Abc!?');
    assert.equal(convertWidth('￥１０', 'half'), '¥10');
  });

  it('converts half-width to full-width', () => {
    assert.equal(convertWidth('2024 (A)', 'full'), '２０２４　（Ａ）');
    assert.equal(convertWidth('ｶﾞｷﾞ', 'full'), 'ガギ');
  });
});

/* -------------------------------------------------------------- Scanning */

const HTML = `
  <h2 class="price">月額１２，３００円（税込）</h2>
  <p>Plain 2024 text</p>
  <p id="two">割引率：５０％　対象外 <b>ＡＢＣ</b></p>
  <script>var x = "ＺＺＺ";</script>
  <style>.a::after { content: "ＹＹＹ"; }</style>
`;

async function scan(target) {
  const root = document.createElement('div');
  root.innerHTML = HTML;
  document.body.append(root);
  created.push(root);
  const result = await scanWidthDocument({ root, target });
  return { root, result };
}

describe('Width scanning (live DOM)', () => {
  it('finds one result per run, in document order, with the owner element', async () => {
    const { result } = await scan(only('number'));
    assert.deepEqual(result.matches.map((m) => m.text), ['１２', '３００', '５０']);
    const owner = result.elements.find((e) => e.elementId === result.matches[0].elementId);
    assert.equal(owner.tag, 'h2');
    assert.equal(result.matches[0].kind, 'width');
  });

  it('gives context, character codes and the other form', async () => {
    const { result } = await scan(only('number'));
    const [first] = result.matches;
    assert.equal(first.before, '月額');
    assert.ok(first.after.startsWith('，'));
    assert.deepEqual(first.codes, ['１ U+FF11', '２ U+FF12']);
    assert.equal(first.replacement, '12');
    assert.equal(first.replacementForm, 'half');
  });

  it('does not search scripts or styles', async () => {
    const { result } = await scan(query());
    assert.ok(!result.matches.some((m) => /Ｚ|Ｙ/.test(m.text)));
  });

  it('finds several kinds together and in nested elements', async () => {
    const { result } = await scan(query());
    const texts = result.matches.map((m) => m.text);
    assert.ok(texts.includes('（'));
    assert.ok(texts.includes('：５０％\u3000'), 'neighbouring kinds join into one run');
    assert.ok(texts.includes('ＡＢＣ'));
    assert.equal(result.matches.find((m) => m.text === 'ＡＢＣ').kinds[0], 'letter');
  });

  it('suggests full-width for half-width finds', async () => {
    const { result } = await scan(only('number', { mode: 'half' }));
    assert.equal(result.matches[0].text, '2024');
    assert.equal(result.matches[0].replacement, '２０２４');
    assert.equal(result.matches[0].replacementForm, 'full');
  });

  it('reports no matches when nothing is found', async () => {
    const { result } = await scan(only('kana', { mode: 'half' }));
    assert.equal(result.matches.length, 0);
    assert.ok(result.stats.elementsScanned > 0);
  });

  it('can be cancelled', async () => {
    const root = document.createElement('div');
    root.innerHTML = HTML;
    document.body.append(root);
    created.push(root);
    await assert.rejects(scanWidthDocument({ root, target: query(), isCancelled: () => true, budgetMs: -1 }));
  });

  it('is dispatched by runScan', async () => {
    const result = await runScan({ target: only('percent') });
    assert.ok(Array.isArray(result.matches));
  });
});

describe('Marks on the page', () => {
  it('marks the found runs without changing the page', async () => {
    if (!marksSupported()) return;
    const root = document.createElement('div');
    root.innerHTML = HTML;
    document.body.append(root);
    created.push(root);
    const before = root.innerHTML;
    const result = await scanWidthDocument({ root, target: only('number') });
    assert.equal(result.marked, 3);
    assert.equal(root.innerHTML, before, 'the DOM is untouched');
    assert.ok(CSS.highlights.has('wit-width'));
    clearMarks();
    assert.ok(!CSS.highlights.has('wit-width'));
  });

  it('does not mark when switched off', async () => {
    const { result } = await scan(only('number', { highlightOnPage: false }));
    assert.equal(result.marked, 0);
    if (marksSupported()) assert.ok(!CSS.highlights.has('wit-width'));
  });

  it('collects one range per run', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>１２ and ３</p>';
    document.body.append(root);
    created.push(root);
    const ranges = collectRanges(document, only('number'), { root });
    assert.deepEqual(ranges.map((r) => r.toString()), ['１２', '３']);
  });
});

/* ---------------------------------------------- Plumbing and the real fixture */

describe('Width plumbing', () => {
  it('is a valid scan target and parses in a scan request', () => {
    assert.ok(isScanTarget(query()));
    assert.ok(!isScanTarget({ kind: 'width', categories: [] }));
    const parsed = parseScanRequest({ scanId: 'a', sessionId: 'b', tabId: 1, target: { ...query(), junk: 1 }, options: {} });
    assert.equal(parsed.target.kind, 'width');
    assert.ok(!('junk' in parsed.target));
  });

  it('has defaults and is the sixth tool, now active', () => {
    assert.ok(!('mode' in DEFAULT_SETTINGS.widthText), 'full-width only: there is no mode to choose');
    assert.equal(DEFAULT_SETTINGS.widthText.highlightOnPage, true);
    const ticked = Object.entries(DEFAULT_SETTINGS.widthText).filter(([key, value]) => value === true && WIDTH_CATEGORIES.some((c) => c.id === key));
    assert.deepEqual(ticked, [['bracket', true]], 'only parentheses are ticked at first');
    assert.equal(DEFAULT_SETTINGS.color, '');
    const index = FEATURES.findIndex((f) => f.id === 'width-text');
    assert.equal(index, 5);
    assert.equal(FEATURES[index].status, FEATURE_STATUS.ACTIVE);
  });

  it('searches a page invisibly through the background renderer', async () => {
    const holder = document.createElement('div');
    document.body.append(holder);
    created.push(holder);
    const renderer = createBackgroundRenderer({ container: holder });
    const url = new URL('../fixtures/width.html', import.meta.url).href;

    const numbers = await renderer.scanUrl(url, { target: only('number'), options: {}, timeoutMs: 20000 });
    assert.deepEqual(numbers.matches.map((m) => m.text), ['１２', '３００', '５０', '０３', '１２３４', '５６７８']);
    assert.equal(numbers.elements[0].tag, 'p');
    assert.equal(numbers.elements[0].rendered, null);
    assert.ok(!numbers.matches.some((m) => m.text.includes('Ａ')), 'script text is skipped, the title is not searched as text');

    const marks = await renderer.scanUrl(url, { target: only('mark'), options: {}, timeoutMs: 20000 });
    assert.deepEqual(marks.matches.map((m) => m.text), ['？', '！']);

    const half = await renderer.scanUrl(url, { target: only('kana', { mode: 'half' }), options: {}, timeoutMs: 20000 });
    assert.deepEqual(half.matches.map((m) => m.text), ['ｶﾀｶﾅ', 'ｱｲｳ']);
  });
});
