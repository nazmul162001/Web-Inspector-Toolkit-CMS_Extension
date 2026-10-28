import { assert, describe, it } from '../test-runner.js';
import { normalizeColor, parseColor, parseColorDetailed, suggestColorName, toHex } from '../../services/color-normalizer.js';
import { validateColorInput } from '../../shared/validators.js';
import { scanDocument } from '../../content/dom-scanner.js';

const hex = (input, options = { allowBareHex: true }) => {
  const color = parseColor(input, options);
  return color ? toHex(color) : null;
};

describe('Color names', () => {
  it('finds the everyday names', () => {
    assert.equal(hex('red'), '#ff0000');
    assert.equal(hex('green'), '#008000', 'CSS green is #008000 (lime is #00ff00)');
    assert.equal(hex('lime'), '#00ff00');
    assert.equal(hex('blue'), '#0000ff');
    assert.equal(hex('white'), '#ffffff');
    assert.equal(hex('black'), '#000000');
    assert.equal(hex('yellow'), '#ffff00');
    assert.equal(hex('orange'), '#ffa500');
    assert.equal(hex('gray'), hex('grey'));
  });

  it('ignores case and surrounding spaces', () => {
    assert.equal(hex('RED'), '#ff0000');
    assert.equal(hex('  Blue  '), '#0000ff');
    assert.equal(hex('WhItE'), '#ffffff');
  });

  it('accepts spaced or hyphenated names in the input field', () => {
    assert.equal(hex('dark blue'), '#00008b');
    assert.equal(hex('Dark-Blue'), '#00008b');
    assert.equal(hex('light_gray'), '#d3d3d3');
    assert.equal(hex('Rebecca Purple'), '#663399');
  });

  it('keeps that leniency out of page CSS parsing', () => {
    assert.equal(parseColor('dark blue'), null);
    assert.equal(parseColor('dark-blue'), null);
    assert.equal(hex('darkblue', {}), '#00008b');
  });

  it('reports the name that was recognised', () => {
    assert.equal(normalizeColor('Red', { allowBareHex: true }).name, 'red');
    assert.equal(normalizeColor('dark blue', { allowBareHex: true }).name, 'darkblue');
    assert.equal(normalizeColor('#ff0000', { allowBareHex: true }).name, undefined);
    assert.equal(validateColorInput('blue').hex, '#0000ff');
  });

  it('still reads hex-looking words as hex when they are not names', () => {
    assert.equal(hex('bad'), '#bbaadd');
    assert.equal(hex('add'), '#aadddd');
    assert.equal(hex('red'), '#ff0000', 'but real names win');
  });

  it('suggests the closest name for a typo', () => {
    assert.equal(suggestColorName('gren'), 'green');
    assert.equal(suggestColorName('bleu'), 'blue');
    assert.equal(suggestColorName('wite'), 'white');
    assert.equal(suggestColorName('qqqqqqqq'), null);
    assert.equal(suggestColorName(''), null);
    const error = parseColorDetailed('gren', { allowBareHex: true }).error;
    assert.ok(error.includes('Did you mean "green"?'), error);
    assert.ok(!parseColorDetailed('zzzzzzzz', { allowBareHex: true }).error.includes('Did you mean'));
  });

  it('rejects things that are not colors', () => {
    for (const bad of ['notacolor', 'currentcolor', 'inherit', 'red green', 'url(x)']) {
      assert.equal(validateColorInput(bad).ok, false, bad);
    }
  });

  it('every one of the 148 names is searchable and matches its own hex', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    try {
      for (const name of ['red', 'green', 'blue', 'white', 'black']) {
        root.innerHTML = [
          `<p class="a" style="color: ${name}">a</p>`,
          `<p class="b" style="background-color: ${hex(name)}">b</p>`,
          '<p class="c" style="color: #123456">c</p>',
        ].join('');
        const result = await scanDocument({ root, target: parseColor(name, { allowBareHex: true }) });
        const found = result.elements.map((e) => e.classes[0]);
        assert.ok(found.includes('a') && found.includes('b'), `${name}: found ${found.join(',')}`);
        assert.ok(!found.includes('c'), `${name}: must not match another color`);
      }
    } finally {
      root.remove();
    }
  });
});
