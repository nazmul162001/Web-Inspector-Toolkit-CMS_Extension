import { assert, describe, it } from '../test-runner.js';
import {
  calculateSpecificity,
  coveredProperties,
  expandNestedSelectors,
  findDeclarationLine,
  parseDeclarations,
  selectorBucketKey,
  splitTopLevel,
} from '../../content/css-utils.js';

describe('CSS utils: declarations', () => {
  it('parses declarations, !important and custom properties', () => {
    const decls = parseDeclarations('color: red; background: var(--c, #fff) !important; --brand: #025743; border: 1px solid rgb(1, 2, 3)');
    assert.deepEqual(decls.map((d) => d.name), ['color', 'background', '--brand', 'border']);
    assert.equal(decls[1].important, true);
    assert.equal(decls[1].value, 'var(--c, #fff)');
    assert.equal(decls[3].value, '1px solid rgb(1, 2, 3)');
  });

  it('does not split on semicolons inside urls, strings or functions', () => {
    const decls = parseDeclarations('background: url("data:image/png;base64,AAAA") no-repeat; color: red');
    assert.equal(decls.length, 2);
  });

  it('maps shorthands to the color longhands they can set', () => {
    assert.deepEqual(coveredProperties('background'), ['background-color']);
    assert.equal(coveredProperties('border').length, 4);
    assert.deepEqual(coveredProperties('outline'), ['outline-color']);
    assert.deepEqual(coveredProperties('margin'), []);
    assert.deepEqual(coveredProperties('color'), ['color']);
  });
});

describe('CSS utils: selectors', () => {
  it('splits selector lists at top level only', () => {
    assert.deepEqual(splitTopLevel('a, b:not(.x, .y), [data-a="1,2"]'), ['a', 'b:not(.x, .y)', '[data-a="1,2"]']);
  });

  it('computes specificity', () => {
    const s = calculateSpecificity;
    assert.ok(s('#a') > s('.a.b.c.d'));
    assert.ok(s('.a') > s('div p span'));
    assert.ok(s('a:hover') > s('a'));
    assert.equal(s(':where(.a, #b)'), 0);
    assert.equal(s(':is(.a, #b)'), s('#b'));
    assert.equal(s(':not(.a)'), s('.a'));
    assert.equal(s('p::before'), s('p') + 1);
    assert.equal(s('[type="text"]'), s('.x'));
    assert.equal(s('*'), 0);
  });

  it('buckets rules by their rightmost compound', () => {
    assert.equal(selectorBucketKey('.nav > a.link'), '.link');
    assert.equal(selectorBucketKey('div#main'), '#main');
    assert.equal(selectorBucketKey('ul li'), 'li');
    assert.equal(selectorBucketKey('.a .b:hover'), '.b');
    assert.equal(selectorBucketKey('[data-x]'), '*');
    assert.equal(selectorBucketKey(':is(.a, .b)'), '*');
    assert.equal(selectorBucketKey('.sm\\:flex'), '.sm:flex');
    assert.equal(selectorBucketKey('a:not(.skip)'), 'a');
  });

  it('expands nested selectors', () => {
    assert.deepEqual(expandNestedSelectors('&:hover', ['.card'], false), ['.card:hover']);
    assert.deepEqual(expandNestedSelectors('.title', ['.card'], false), ['.card .title']);
    assert.deepEqual(expandNestedSelectors('.title', ['.card'], true), [':is(.card) .title']);
  });
});

describe('CSS utils: line lookup', () => {
  const css = [
    '/* header */',
    '.a {',
    '  color: red;',
    '}',
    '',
    '.b {',
    '  background-color: #025743;',
    '  border: 1px solid #025743;',
    '}',
    '@media (min-width: 600px) {',
    '  .c { color: #025743; }',
    '}',
  ].join('\n');

  it('finds the line of a unique declaration', () => {
    assert.equal(findDeclarationLine(css, '.b', 'background-color', '#025743'), 7);
    assert.equal(findDeclarationLine(css, '.b', 'border', '1px solid #025743'), 8);
    assert.equal(findDeclarationLine(css, '.c', 'color', '#025743'), 11);
  });

  it('is whitespace and case tolerant', () => {
    assert.equal(findDeclarationLine(css, '.b', 'background-color', '#025743'.toUpperCase()), 7);
  });

  it('returns null rather than guessing when the declaration is not present', () => {
    assert.equal(findDeclarationLine(css, '.b', 'color', '#025743'), null);
    assert.equal(findDeclarationLine(css, '.zzz', 'color', 'red'), null);
  });

  it('returns null when more than one place matches (ambiguous)', () => {
    const dup = '.a { color: red; }\n@media print { .a { color: red; } }';
    assert.equal(findDeclarationLine(dup, '.a', 'color', 'red'), null);
  });

  it('ignores commented-out code and does not match inside longer selectors', () => {
    const text = '/* .x { color: red; } */\n.nav .x {\n  color: blue;\n}\n.x {\n  color: red;\n}';
    assert.equal(findDeclarationLine(text, '.x', 'color', 'red'), 6);
  });

  it('works on minified css only when unambiguous, and never invents a line', () => {
    const min = '.a{color:red}.b{color:#025743}';
    assert.equal(findDeclarationLine(min, '.b', 'color', '#025743'), 1);
  });
});
