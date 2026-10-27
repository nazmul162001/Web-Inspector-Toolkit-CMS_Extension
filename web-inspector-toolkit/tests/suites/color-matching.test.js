import { assert, describe, it } from '../test-runner.js';
import { parseColor } from '../../services/color-normalizer.js';
import { colorsMatch, createColorMatcher } from '../../services/color-matcher.js';

const c = (input) => parseColor(input);

describe('Color matching', () => {
  it('#ffffff equals every equivalent notation', () => {
    const target = c('#ffffff');
    for (const input of ['#fff', '#FFFFFF', 'rgb(255, 255, 255)', 'rgba(255, 255, 255, 1)', 'hsl(0, 0%, 100%)', 'hsla(0, 0%, 100%, 1)', 'white']) {
      assert.ok(colorsMatch(c(input), target), `${input} should match #ffffff`);
    }
  });

  it('HEX and RGB equivalence for a brand color', () => {
    assert.ok(colorsMatch(c('#025743'), c('rgb(2, 87, 67)')));
    assert.ok(colorsMatch(c('#025743'), c('rgb(2 87 67)')));
  });

  it('HEX and RGBA equivalence (alpha written as hex or decimal)', () => {
    assert.ok(colorsMatch(c('#02574380'), c('rgba(2, 87, 67, 0.5)')));
    assert.ok(colorsMatch(c('#025743ff'), c('rgba(2, 87, 67, 1)')));
    assert.ok(colorsMatch(c('#025743ff'), c('#025743')));
  });

  it('different alpha never matches by default', () => {
    assert.ok(!colorsMatch(c('#ffffff'), c('rgba(255, 255, 255, 0.5)')));
    assert.ok(!colorsMatch(c('rgba(255,255,255,0.5)'), c('rgba(255,255,255,0.6)')));
  });

  it('non-matching colors are rejected, even when very close', () => {
    assert.ok(!colorsMatch(c('#ffffff'), c('#fffffe')));
    assert.ok(!colorsMatch(c('#025743'), c('#025744')));
    assert.ok(!colorsMatch(c('red'), c('blue')));
  });

  it('all fully transparent colors are equal, but not equal to opaque ones', () => {
    assert.ok(colorsMatch(c('transparent'), c('rgba(0,0,0,0)')));
    assert.ok(colorsMatch(c('transparent'), c('rgba(255,0,0,0)')));
    assert.ok(!colorsMatch(c('transparent'), c('rgba(0,0,0,0.01)')));
    assert.ok(!colorsMatch(c('transparent'), c('black')));
  });

  it('tolerance enables "near" matches only when asked', () => {
    assert.ok(!colorsMatch(c('#025743'), c('#035844')));
    assert.ok(colorsMatch(c('#025743'), c('#035844'), { tolerance: 4 }));
    assert.ok(!colorsMatch(c('#025743'), c('#0a5f4b'), { tolerance: 4 }));
  });

  it('matcher finds the matching part of a shadow list', () => {
    const matcher = createColorMatcher(c('#025743'));
    const hit = matcher.matchValue('rgba(2, 87, 67, 0.5) 0px 4px 10px 0px, rgb(2, 87, 67) 0px 0px 0px 1px');
    assert.equal(hit.parts.length, 2);
    assert.equal(hit.matches.length, 1);
    assert.equal(hit.matches[0].raw, 'rgb(2, 87, 67)');
    assert.equal(matcher.matchValue('rgb(1, 2, 3)').matches.length, 0);
    assert.equal(matcher.matchValue('0px 4px 6px').matches.length, 0);
  });

  it('matcher caches parsing per value', () => {
    const matcher = createColorMatcher(c('#fff'));
    const first = matcher.partsFor('rgb(255, 255, 255)');
    assert.equal(matcher.partsFor('rgb(255, 255, 255)'), first, 'same array instance means cached');
  });
});
