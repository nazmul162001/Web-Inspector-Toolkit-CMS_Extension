import { afterEach, assert, describe as baseDescribe, it } from '../test-runner.js';
import { FEATURES, FEATURE_STATUS } from '../../shared/constants.js';
import { hasFeature } from '../../sidepanel/features/registry.js';
import {
  OVERFLOW_THRESHOLD_PX,
  detectCauses,
  findOverflow,
  formatPx,
  parseCssPx,
} from '../../services/overflow-rules.js';
import { isOverflowFinderRunning, overflowFinderReport, startOverflowFinder, stopOverflowFinder } from '../../content/overflow-finder.js';

const created = [];
function describe(name, define) {
  baseDescribe(name, () => {
    afterEach(() => {
      stopOverflowFinder();
      while (created.length) created.pop().remove();
    });
    define();
  });
}

const place = (html, style = 'position:relative;padding:8px;') => {
  const root = document.createElement('div');
  root.style.cssText = style;
  root.innerHTML = html;
  document.body.append(root);
  created.push(root);
  return root;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Layout Overflow Finder: registry', () => {
  it('sits before Remove Background and needs no This Page / Entire Site choice', () => {
    const ids = FEATURES.map((feature) => feature.id);
    const tool = FEATURES.find((feature) => feature.id === 'overflow-finder');
    assert.ok(tool);
    assert.equal(tool.status, FEATURE_STATUS.ACTIVE);
    assert.equal(tool.usesScope, false);
    assert.equal(tool.label, 'Layout Overflow Finder');
    assert.ok(hasFeature('overflow-finder'));
    assert.ok(ids.indexOf('sns-checker') < ids.indexOf('overflow-finder'));
    assert.ok(ids.indexOf('overflow-finder') < ids.indexOf('remove-background'));
    assert.equal(ids[ids.length - 1], 'screenshot');
  });
});

describe('Layout Overflow Finder: helpers', () => {
  it('reads pixel lengths and ignores auto and percentages', () => {
    assert.equal(parseCssPx('1200px'), 1200);
    assert.equal(parseCssPx('0'), 0);
    assert.equal(parseCssPx('-24px'), -24);
    assert.equal(parseCssPx('auto'), null);
    assert.equal(parseCssPx('100%'), null);
    assert.equal(OVERFLOW_THRESHOLD_PX, 2);
    assert.equal(formatPx(86), '86');
    assert.equal(formatPx(86.25), '86.3');
  });

  it('names min-width, nowrap and media as overflow causes', () => {
    const min = detectCauses({ localName: 'div' }, { minWidth: '1200px', width: 'auto', whiteSpace: 'normal', display: 'block', position: 'static', marginLeft: '0px', marginRight: '0px', flexWrap: 'nowrap' }, { width: 400 });
    assert.ok(min.some((cause) => cause.id === 'min-width'));
    assert.ok(min[0].css.includes('min-width'));

    const nowrap = detectCauses({ localName: 'p' }, { minWidth: '0px', width: 'auto', whiteSpace: 'nowrap', display: 'block', position: 'static', marginLeft: '0px', marginRight: '0px' }, { width: 400 });
    assert.ok(nowrap.some((cause) => cause.id === 'nowrap'));

    const image = detectCauses({ localName: 'img' }, { minWidth: '0px', width: '800px', whiteSpace: 'normal', display: 'inline', position: 'static', marginLeft: '0px', marginRight: '0px' }, { width: 400 });
    assert.ok(image.some((cause) => cause.id === 'media' || cause.id === 'width'));
  });
});

describe('Layout Overflow Finder: on the page', () => {
  it('finds a box wider than the viewport', () => {
    const holder = place('<div class="of-wide" style="width:5000px;height:40px;background:#c33"></div>');
    const found = findOverflow({ root: holder, win: window });
    assert.ok(!found.ok, 'page should overflow');
    assert.ok(found.items.length >= 1, 'at least one culprit');
    assert.ok(found.items.some((item) => item.element.classList.contains('of-wide') || holder.contains(item.element)));
    assert.ok(found.items[0].overflow.amount > 2);
  });

  it('does not report a box that fits', () => {
    const holder = place('<div class="of-fit" style="width:40px;height:20px;background:#0a0"></div>');
    const found = findOverflow({ root: holder, win: window });
    assert.ok(!found.items.some((item) => item.element.classList.contains('of-fit')));
  });

  it('prefers a min-width wrapper over its shrinking child', () => {
    const holder = place(
      '<div class="of-wrap" style="min-width:4000px;height:40px;background:#444"><div class="of-child" style="width:100%;height:40px;background:#888"></div></div>',
    );
    const found = findOverflow({ root: holder, win: window });
    const wrap = found.items.find((item) => item.element.classList.contains('of-wrap'));
    const child = found.items.find((item) => item.element.classList.contains('of-child'));
    assert.ok(wrap, 'wrapper is reported');
    assert.ok(!child, 'inner 100% child is collapsed into the wrapper');
    assert.ok(wrap.causes.some((cause) => cause.id === 'min-width'));
  });

  it('starts, draws frames and cleans up on stop', async () => {
    place('<div style="width:5000px;height:32px;background:#c33"></div>');
    assert.equal(startOverflowFinder({}).running, true);
    assert.ok(isOverflowFinderRunning());
    await sleep(80);
    assert.ok(document.getElementById('wit-overflow-finder'), 'overlay is in the page');
    const report = overflowFinderReport();
    assert.ok(report);
    assert.ok(!report.ok);
    assert.ok(report.items.length >= 1);
    stopOverflowFinder();
    assert.ok(!isOverflowFinderRunning());
    assert.equal(document.getElementById('wit-overflow-finder'), null);
  });

  it('can be started twice without a second overlay', () => {
    startOverflowFinder({});
    startOverflowFinder({ language: 'ja' });
    assert.equal(document.querySelectorAll('#wit-overflow-finder').length, 1);
  });

  it('stops on Escape', () => {
    startOverflowFinder({});
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!isOverflowFinderRunning());
  });
});
