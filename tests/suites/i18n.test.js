import { afterEach, assert, describe, it } from '../test-runner.js';
import { DEFAULT_LANGUAGE, LANGUAGES, getLanguage, normalizeLanguage, setLanguage, translate } from '../../services/i18n.js';
import { EXACT_JA } from '../../services/i18n-ja.js';
import { DEFAULT_SETTINGS } from '../../services/settings-service.js';
import { createDomTranslator } from '../../sidepanel/i18n-dom.js';
import { renderHeader } from '../../sidepanel/components/header.js';
import { FEATURES, PROPERTY_GROUP_LABELS, SECTION_LABELS } from '../../shared/constants.js';
import { DEFAULT_THEME, applyTheme, normalizeTheme, oppositeTheme, resolveTheme } from '../../services/theme.js';
import { describeScale } from '../../services/image-geometry.js';

const ja = (text) => translate(text, 'ja');

describe('Language: translate()', () => {
  afterEach(() => setLanguage(DEFAULT_LANGUAGE));

  it('is English by default and leaves English untouched', () => {
    assert.equal(DEFAULT_LANGUAGE, 'en');
    assert.equal(getLanguage(), 'en');
    assert.equal(translate('Color Find'), 'Color Find');
    assert.equal(translate('Color Find', 'en'), 'Color Find');
  });

  it('only accepts the two known languages', () => {
    assert.equal(normalizeLanguage('ja'), 'ja');
    assert.equal(normalizeLanguage('en'), 'en');
    for (const bad of ['fr', '', null, undefined, 5, 'JA']) assert.equal(normalizeLanguage(bad), 'en');
    assert.equal(LANGUAGES.length, 2);
  });

  it('translates whole texts and follows the current language', () => {
    setLanguage('ja');
    assert.equal(translate('Color Find'), 'カラー検索');
    assert.equal(translate('Entire Site'), 'サイト全体');
    setLanguage('en');
    assert.equal(translate('Entire Site'), 'Entire Site');
  });

  it('keeps the spaces around a text', () => {
    assert.equal(ja('  Find \n'), '  検索 \n');
  });

  it('leaves unknown text and text without letters as it is', () => {
    assert.equal(ja('Some brand new sentence nobody translated'), 'Some brand new sentence nobody translated');
    assert.equal(ja('12 345'), '12 345');
    assert.equal(ja('日本語のテキスト'), '日本語のテキスト');
    assert.equal(ja(''), '');
    assert.equal(translate(null, 'ja'), null);
  });

  it('translates sentences with numbers', () => {
    assert.equal(ja('Found 12 matches.'), '12 件見つかりました。');
    assert.equal(ja('1 match'), '1 件一致');
    assert.equal(ja('Showing 50 of 120 matches'), '120 件中 50 件を表示');
    assert.equal(ja('Show more (70 remaining)'), 'さらに表示（残り 70 件）');
    assert.equal(ja('Checking the site: 3 of 40 pages'), 'サイトを処理中: 40 ページ中 3 ページ');
    assert.equal(ja('Version 1.0.0'), 'バージョン 1.0.0');
  });

  it('translates sentences that contain other texts', () => {
    assert.equal(ja('Font Find - coming soon'), 'フォント検索 - 近日公開');
    assert.equal(ja('Hex copied'), 'Hexをコピーしました。');
    assert.equal(ja('Entire Site · https://example.com'), 'サイト全体 · https://example.com');
  });

  it('translates the font and width previews', () => {
    assert.equal(ja('Looking for the font Roboto.'), 'フォント Roboto を検索しています。');
    assert.equal(ja('Looking for the font Noto (partial names match).'), 'フォント Noto を検索しています（部分一致）。');
  });

  it('translates the site coverage banner and the width previews', () => {
    assert.equal(ja('Scanned 78 of 79 discovered pages · 1 could not be inspected'), '見つかった 79 ページのうち 78 ページをスキャンしました · 1 件は検査できませんでした');
    assert.equal(ja('Still checking the site · 28 pages done of 79 found'), 'サイトを確認中 · 28 ページ完了（79 ページ中）');
    assert.equal(ja('Looking for full-width numbers, letters and spaces.'), '全角の数字・英字・スペースを検索しています。');
    assert.equal(ja('Looked for: full-width parentheses and brackets.'), '検索した種類: 全角の括弧（かっこ）。');
    assert.equal(ja('3rd of 3 - a fallback; earlier fonts are tried first'), '3 件中 3 番目 - フォールバック（先のフォントが先に試されます）');
  });

  it('does not let a pattern swallow the second sentence of a text', () => {
    const out = ja('Read: sans-serif. Looking for the font "sans-serif".');
    assert.ok(out.startsWith('読み取り: sans-serif.'), out);
    assert.ok(out.includes('フォント "sans-serif" を検索しています'), out);
  });

  it('translates one sentence at a time inside a longer text', () => {
    const text = 'Enter a link, for example https://www.line.me/en/. That link is too long.';
    const out = ja(text);
    assert.ok(out.includes('リンクを入力してください'), out);
    assert.ok(out.includes('リンクが長すぎます。'), out);
  });

  it('translates the image card wording', () => {
    assert.equal(ja('Actual image size'), '画像本来のサイズ');
    assert.equal(ja('Shown at its own size'), '本来のサイズで表示されています');
    assert.ok(ja('Enlarged 2.5× - can look soft').includes('2.5'));
    assert.notEqual(ja('Enlarged 2.5× - can look soft'), 'Enlarged 2.5× - can look soft');
    const scale = describeScale(278, 800);
    assert.notEqual(ja(scale.text), scale.text);
  });

  it('has a Japanese name for every tool, group and section', () => {
    for (const feature of FEATURES) assert.notEqual(ja(feature.label), feature.label, feature.label);
    for (const label of Object.values(PROPERTY_GROUP_LABELS)) assert.ok(ja(label) !== label || label === 'SVG', label);
    for (const label of Object.values(SECTION_LABELS)) assert.notEqual(ja(label), label, label);
  });

  it('keeps the dictionary free of empty or identical entries', () => {
    for (const [english, japanese] of Object.entries(EXACT_JA)) {
      assert.ok(japanese.length > 0, english);
      if (/[A-Za-z]{4}/.test(english)) assert.ok(/[^\x00-\x7f]/.test(japanese) || english === japanese, `${english} -> ${japanese}`);
    }
  });
});

describe('Language: setting', () => {
  it('is English until the user picks Japanese', () => {
    assert.equal(DEFAULT_SETTINGS.language, 'en');
  });
});

describe('Language: panel translator', () => {
  let root;
  afterEach(() => {
    root?.remove();
    document.documentElement.lang = 'en';
    setLanguage('en');
  });

  const build = (html) => {
    root = document.createElement('div');
    root.innerHTML = html;
    document.body.append(root);
    return createDomTranslator(root);
  };

  it('translates text and attributes, and gives the English back exactly', () => {
    const translator = build('<h2>Color Find</h2><input placeholder="Type any word or sentence…" title="Copy"><p>Match  <b>Entire Site</b></p>');
    const before = root.innerHTML;
    translator.setLanguage('ja');
    assert.equal(root.querySelector('h2').textContent, 'カラー検索');
    assert.equal(root.querySelector('input').getAttribute('title'), 'コピー');
    assert.ok(root.querySelector('input').getAttribute('placeholder').includes('入力'));
    assert.equal(document.documentElement.lang, 'ja');
    translator.setLanguage('en');
    assert.equal(root.innerHTML, before);
    assert.equal(document.documentElement.lang, 'en');
  });

  it('never translates page data', () => {
    const translator = build('<code>Find</code><pre>Entire Site</pre><span class="mono">Copy</span><span data-i18n-skip>Highlight</span><textarea>Find</textarea>');
    const before = root.innerHTML;
    translator.setLanguage('ja');
    assert.equal(root.innerHTML, before);
  });

  it('translates what the tools add later, and what they change', async () => {
    const translator = build('<div id="out"></div>');
    translator.setLanguage('ja');
    const out = root.querySelector('#out');
    const added = document.createElement('p');
    added.textContent = 'Found 3 matches.';
    out.append(added);
    const changing = document.createElement('p');
    changing.textContent = 'Searching…';
    out.append(changing);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(added.textContent, '3 件見つかりました。');
    assert.equal(changing.textContent, '検索中…');
    changing.firstChild.nodeValue = 'Scan cancelled.';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(changing.textContent, 'スキャンをキャンセルしました。');
    translator.setLanguage('en');
    assert.equal(added.textContent, 'Found 3 matches.');
    assert.equal(changing.textContent, 'Scan cancelled.');
  });

  it('leaves text it does not know in English', () => {
    const translator = build('<p>Something nobody translated</p>');
    translator.setLanguage('ja');
    assert.equal(root.textContent, 'Something nobody translated');
  });
});

describe('Language: header switch', () => {
  let box;
  afterEach(() => box?.remove());

  const render = (language, onLanguage = () => {}) => {
    box = document.createElement('div');
    document.body.append(box);
    return renderHeader(box, { version: '1.0.0', language, onLanguage });
  };

  it('shows EN and 日本語 and no settings button', () => {
    render('en');
    const buttons = [...box.querySelectorAll('.lang-switch__btn')];
    assert.deepEqual(buttons.map((b) => b.textContent.trim()), ['EN', '日本語']);
    assert.equal(box.querySelector('[aria-label="Settings"]'), null);
  });

  it('marks the active language and reports a change', () => {
    const changes = [];
    const header = render('en', (language) => changes.push(language));
    const [en, jaButton] = box.querySelectorAll('.lang-switch__btn');
    assert.equal(en.getAttribute('aria-pressed'), 'true');
    assert.equal(jaButton.getAttribute('aria-pressed'), 'false');
    jaButton.click();
    assert.deepEqual(changes, ['ja']);
    header.setActive('ja');
    assert.equal(en.getAttribute('aria-pressed'), 'false');
    assert.equal(jaButton.getAttribute('aria-pressed'), 'true');
    en.click();
    assert.deepEqual(changes, ['ja', 'en']);
  });
});

describe('Theme: dark / light switch', () => {
  let box;
  afterEach(() => {
    box?.remove();
    document.documentElement.removeAttribute('data-theme');
  });

  it('follows the system until the user picks a theme', () => {
    assert.equal(DEFAULT_THEME, 'system');
    assert.equal(DEFAULT_SETTINGS.theme, 'system');
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
  });

  it('only accepts known themes', () => {
    for (const ok of ['system', 'dark', 'light']) assert.equal(normalizeTheme(ok), ok);
    for (const bad of ['blue', '', null, undefined, 3, 'DARK']) assert.equal(normalizeTheme(bad), 'system');
    assert.equal(oppositeTheme('dark'), 'light');
    assert.equal(oppositeTheme('light'), 'dark');
  });

  it('puts the theme on the page and removes it for "system"', () => {
    const root = document.documentElement;
    assert.equal(applyTheme(root, 'light', true), 'light');
    assert.equal(root.getAttribute('data-theme'), 'light');
    assert.equal(applyTheme(root, 'dark', false), 'dark');
    assert.equal(root.getAttribute('data-theme'), 'dark');
    assert.equal(applyTheme(root, 'system', true), 'dark');
    assert.equal(root.hasAttribute('data-theme'), false);
  });

  it('has a header button left of the language switch that offers the other mode', () => {
    const changes = [];
    box = document.createElement('div');
    document.body.append(box);
    const header = renderHeader(box, { version: '1.0.0', language: 'en', onLanguage: () => {}, shownTheme: 'dark', onTheme: (next) => changes.push(next) });
    const button = box.querySelector('.theme-toggle');
    const language = box.querySelector('.lang-switch');
    assert.ok(button && language);
    assert.ok(button.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING, 'theme button comes before the language switch');
    assert.equal(button.getAttribute('aria-label'), 'Switch to light mode');
    button.click();
    assert.deepEqual(changes, ['light']);
    header.setTheme('light');
    assert.equal(button.getAttribute('aria-label'), 'Switch to dark mode');
    button.click();
    assert.deepEqual(changes, ['light', 'dark']);
  });

  it('translates the button labels', () => {
    assert.equal(translate('Switch to light mode', 'ja'), 'ライトモードに切り替え');
    assert.equal(translate('Switch to dark mode', 'ja'), 'ダークモードに切り替え');
  });
});
