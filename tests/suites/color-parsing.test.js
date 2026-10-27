import { assert, describe, it } from '../test-runner.js';
import {
  alphaToNumber,
  extractColors,
  normalizeColor,
  parseColor,
  parseColorDetailed,
  toHex,
  toRgbString,
} from '../../services/color-normalizer.js';
import { NAMED_COLORS } from '../../shared/named-colors.js';

const rgba = (r, g, b, a = 255) => ({ r, g, b, a });

describe('Color parsing', () => {
  it('parses #fff, #FFF, #ffffff and #FFFFFF to the same color', () => {
    for (const input of ['#fff', '#FFF', '#ffffff', '#FFFFFF']) {
      assert.deepEqual(parseColor(input), rgba(255, 255, 255), input);
    }
  });

  it('parses 4 and 8 digit hex with alpha', () => {
    assert.deepEqual(parseColor('#ffffff80'), rgba(255, 255, 255, 128));
    assert.deepEqual(parseColor('#fff8'), rgba(255, 255, 255, 136));
    assert.deepEqual(parseColor('#02574380'), rgba(2, 87, 67, 128));
  });

  it('parses rgb() in legacy and modern syntax', () => {
    assert.deepEqual(parseColor('rgb(255, 255, 255)'), rgba(255, 255, 255));
    assert.deepEqual(parseColor('rgb(255 255 255)'), rgba(255, 255, 255));
    assert.deepEqual(parseColor('rgb(100%, 0%, 0%)'), rgba(255, 0, 0));
    assert.deepEqual(parseColor('rgb(255 0 0 / 50%)'), rgba(255, 0, 0, 128));
  });

  it('parses rgba() including alpha 1, 0.5 and 0', () => {
    assert.deepEqual(parseColor('rgba(255, 255, 255, 1)'), rgba(255, 255, 255, 255));
    assert.deepEqual(parseColor('rgba(255,255,255,0.5)'), rgba(255, 255, 255, 128));
    assert.deepEqual(parseColor('rgba(255,255,255,.5)'), rgba(255, 255, 255, 128));
    assert.deepEqual(parseColor('rgba(10, 20, 30, 0)'), rgba(0, 0, 0, 0));
  });

  it('parses hsl() and hsla()', () => {
    assert.deepEqual(parseColor('hsl(0, 0%, 100%)'), rgba(255, 255, 255));
    assert.deepEqual(parseColor('hsla(0, 0%, 100%, 1)'), rgba(255, 255, 255));
    assert.deepEqual(parseColor('hsl(120deg 100% 25%)'), rgba(0, 128, 0));
    assert.deepEqual(parseColor('hsl(0.5turn 100% 50%)'), rgba(0, 255, 255));
    assert.deepEqual(parseColor('hsl(0, 100%, 50%, 0.5)'), rgba(255, 0, 0, 128));
  });

  it('parses named colors case-insensitively', () => {
    assert.deepEqual(parseColor('white'), rgba(255, 255, 255));
    assert.deepEqual(parseColor('WHITE'), rgba(255, 255, 255));
    assert.deepEqual(parseColor('rebeccapurple'), rgba(102, 51, 153));
  });

  it('parses transparent as fully transparent', () => {
    assert.deepEqual(parseColor('transparent'), rgba(0, 0, 0, 0));
    assert.deepEqual(parseColor('rgba(255, 0, 0, 0)'), rgba(0, 0, 0, 0), 'invisible colors collapse to one value');
  });

  it('parses hwb, lab, lch, oklab, oklch and color()', () => {
    assert.deepEqual(parseColor('hwb(0 0% 0%)'), rgba(255, 0, 0));
    assert.ok(parseColor('lab(50% 40 59.5)'));
    assert.ok(parseColor('lch(50% 50 40)'));
    assert.ok(parseColor('oklab(0.6 0.1 0.1)'));
    assert.ok(parseColor('oklch(0.6 0.15 140)'));
    assert.deepEqual(parseColor('color(srgb 1 0 0)'), rgba(255, 0, 0));
  });

  it('accepts bare hex only when explicitly allowed', () => {
    assert.equal(parseColor('ffffff'), null);
    assert.deepEqual(parseColor('ffffff', { allowBareHex: true }), rgba(255, 255, 255));
  });

  it('rejects invalid input with a helpful message', () => {
    const invalid = ['', '   ', '#', '#ff', '#fffff', '#ggg', 'whte', 'rgb(1,2)', 'rgb(a,b,c)', 'hsl(red, 0%, 0%)', 'foo(1,2,3)', 'currentColor', '12px', 'rgba(1,2,3,x)'];
    for (const input of invalid) {
      const result = parseColorDetailed(input);
      assert.ok(!result.color, `"${input}" should be rejected`);
      assert.ok(result.error && result.error.length > 5, `"${input}" should explain why`);
    }
    assert.equal(parseColor(42), null);
    assert.equal(parseColor(null), null);
  });

  it('clamps out-of-range channels like CSS does', () => {
    assert.deepEqual(parseColor('rgb(300, -5, 0)'), rgba(255, 0, 0));
    assert.deepEqual(parseColor('rgba(0,0,0,2)'), rgba(0, 0, 0, 255));
  });
});

describe('Color precision strategy', () => {
  it('stores alpha as an 8-bit integer so 0.5 and #80 are identical', () => {
    assert.equal(parseColor('rgba(255,255,255,0.5)').a, parseColor('#ffffff80').a);
    assert.equal(parseColor('rgba(255,255,255,0.501)').a, 128);
  });

  it('does not suffer float rounding errors (half values round up)', () => {
    assert.deepEqual(parseColor('rgb(127.5, 127.5, 127.5)'), rgba(128, 128, 128));
    assert.deepEqual(parseColor('hsl(0, 0%, 50%)'), rgba(128, 128, 128));
  });

  it('formats HEX, rgb() and alpha consistently', () => {
    assert.equal(toHex(rgba(255, 255, 255)), '#ffffff');
    assert.equal(toHex(rgba(255, 255, 255, 128)), '#ffffff80');
    assert.equal(toRgbString(rgba(2, 87, 67)), 'rgb(2, 87, 67)');
    assert.equal(toRgbString(rgba(2, 87, 67, 128)), 'rgba(2, 87, 67, 0.5)');
    assert.equal(alphaToNumber(255), 1);
    assert.equal(alphaToNumber(0), 0);
    assert.equal(alphaToNumber(128), 0.5);
  });

  it('normalizeColor returns display values', () => {
    const result = normalizeColor('white');
    assert.equal(result.ok, true);
    assert.equal(result.hex, '#ffffff');
    assert.equal(result.rgb, 'rgb(255, 255, 255)');
    assert.equal(result.alpha, 1);
    assert.equal(normalizeColor('nope').ok, false);
  });
});

describe('Colors inside CSS values', () => {
  it('extracts only real colors from a computed box-shadow list', () => {
    const parts = extractColors('rgba(0, 0, 0, 0.2) 0px 4px 6px 0px, rgb(255, 0, 0) 0px 0px 1px 0px inset');
    assert.equal(parts.length, 2);
    assert.deepEqual(parts[0].color, rgba(0, 0, 0, 51));
    assert.deepEqual(parts[1].color, rgba(255, 0, 0));
  });

  it('does not mistake lengths or keywords for colors', () => {
    assert.equal(extractColors('0px 4px 6px 0px').length, 0);
    assert.equal(extractColors('inset 10px 10px').length, 0);
    assert.equal(extractColors('none').length, 0);
    assert.equal(extractColors('').length, 0);
  });

  it('finds a leading color, named colors and currentcolor substitution', () => {
    assert.equal(extractColors('#025743 0 0 4px').length, 1);
    assert.equal(extractColors('0 0 4px red').length, 1);
    const withCurrent = extractColors('0 0 4px currentcolor', { currentColor: rgba(1, 2, 3) });
    assert.deepEqual(withCurrent[0].color, rgba(1, 2, 3));
  });
});

describe('Parser parity with Chrome', () => {
  const readComputed = (value) => {
    const probe = document.createElement('div');
    probe.style.color = value;
    document.body.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  };

  it('all 148 named colors equal the browser computed value', () => {
    for (const name of Object.keys(NAMED_COLORS)) {
      const expected = parseColor(readComputed(name));
      assert.deepEqual(parseColor(name), expected, name);
    }
  });

  it('legacy/modern syntax equals the browser for a sample set', () => {
    const samples = [
      'rgb(12, 34, 56)', 'rgba(12, 34, 56, 0.3)', 'rgb(10% 20% 30% / 0.4)',
      'hsl(210, 50%, 40%)', 'hsla(300, 100%, 25%, 0.7)', 'hsl(45 90% 55%)',
      'hwb(200 10% 20%)', '#1a2b3c', '#1a2b3c4d', '#abc', 'transparent',
    ];
    for (const sample of samples) {
      const mine = parseColor(sample);
      const theirs = parseColor(readComputed(sample));
      assert.ok(theirs, `browser did not accept ${sample}`);
      assert.deepEqual(mine, theirs, sample);
    }
  });

  it('modern color spaces are within 1/255 of what Chrome paints', () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const paint = (value) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = '#000';
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a };
    };
    const samples = [
      'lab(50% 40 59.5)', 'lab(80% -30 20)', 'lch(60% 40 200)', 'oklab(0.6 0.1 0.1)',
      'oklab(0.8 -0.05 0.05)', 'oklch(0.7 0.1 140)', 'oklch(0.4 0.08 260)',
      'color(srgb 0.2 0.4 0.6)', 'color(srgb-linear 0.2 0.4 0.6)', 'color(display-p3 0.5 0.4 0.3)',
    ];
    for (const sample of samples) {
      const mine = parseColor(sample);
      const theirs = paint(sample);
      for (const channel of ['r', 'g', 'b']) {
        assert.near(mine[channel], theirs[channel], 1, `${sample} ${channel}: ${mine[channel]} vs ${theirs[channel]}`);
      }
    }
  });
});
