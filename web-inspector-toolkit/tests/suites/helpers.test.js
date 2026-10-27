import { assert, describe, it } from '../test-runner.js';
import { el, setChildren, truncate } from '../../shared/helpers.js';

describe('DOM helpers', () => {
  it('el() never interprets text as HTML', () => {
    const node = el('div', {}, '<img src=x onerror=alert(1)>');
    assert.equal(node.children.length, 0);
    assert.equal(node.textContent, '<img src=x onerror=alert(1)>');
  });

  it('el() skips null / false children', () => {
    assert.equal(el('div', {}, null, false, undefined, 'a').textContent, 'a');
  });

  it('el() applies CSS custom properties from style objects (regression: swatch color)', () => {
    const node = el('span', { style: { '--swatch': 'rgb(1, 2, 3)', width: '10px' } });
    assert.equal(node.style.getPropertyValue('--swatch'), 'rgb(1, 2, 3)');
    assert.equal(node.style.width, '10px');
  });

  it('setChildren() replaces content and does not render null as the text "null" (regression)', () => {
    const host = el('div', {}, 'old');
    setChildren(host, el('b', {}, 'x'), null, undefined, false);
    assert.equal(host.textContent, 'x');
    assert.equal(host.children.length, 1);
  });

  it('truncate() shortens long strings with an ellipsis', () => {
    assert.equal(truncate('abcdef', 4).length, 4);
    assert.equal(truncate('abc', 10), 'abc');
  });
});
