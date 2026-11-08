import { afterEach, assert, describe as baseDescribe, it } from '../test-runner.js';
import { FEATURES, FEATURE_STATUS } from '../../shared/constants.js';
import { hasFeature } from '../../sidepanel/features/registry.js';
import {
  SP_MAX_WIDTH,
  SP_SIZE,
  areSideBySide,
  checkSnsCluster,
  checkSnsIcon,
  classifySns,
  clearanceFromRects,
  cssSourceExtras,
  describeRuleRange,
  looksLikeSnsIcon,
  mediaWidthBounds,
  requiredSpacingFor,
} from '../../services/sns-rules.js';
import { isSnsCheckerRunning, selectedSnsIcons, snsCheckerReport, snsCssIndexReady, startSnsChecker, stopSnsChecker } from '../../content/sns-checker.js';

const created = [];
function describe(name, define) {
  baseDescribe(name, () => {
    afterEach(() => {
      stopSnsChecker();
      while (created.length) created.pop().remove();
    });
    define();
  });
}

const place = (html) => {
  const root = document.createElement('div');
  root.style.cssText = 'position:relative;padding:80px;';
  root.innerHTML = html;
  document.body.append(root);
  created.push(root);
  return root;
};

describe('SNS Checker: registry', () => {
  it('sits before Remove Background and needs no This Page / Entire Site choice', () => {
    const ids = FEATURES.map((feature) => feature.id);
    const tool = FEATURES.find((feature) => feature.id === 'sns-checker');
    assert.ok(tool);
    assert.equal(tool.status, FEATURE_STATUS.ACTIVE);
    assert.equal(tool.usesScope, false);
    assert.equal(tool.label, 'SNS Checker');
    assert.ok(hasFeature('sns-checker'));
    assert.ok(ids.indexOf('sns-checker') > ids.indexOf('image-resize'));
    assert.ok(ids.indexOf('sns-checker') < ids.indexOf('remove-background'));
    assert.ok(ids.indexOf('remove-background') < ids.indexOf('screenshot'));
  });
});

describe('SNS Checker: rules', () => {
  it('requires 40 × 40 px and 20 px sides on small screens', () => {
    assert.equal(SP_MAX_WIDTH, 768);
    assert.equal(SP_SIZE, 40);
    assert.equal(requiredSpacingFor(40), 20);
    assert.equal(requiredSpacingFor(32), 16);
    const pass = checkSnsIcon({ width: 40, height: 40, spacing: { left: 20, right: 22 }, viewportWidth: 375 });
    assert.equal(pass.ok, true);
    assert.equal(pass.screen, 'sp');
    assert.equal(pass.summary, 'This width matches the size and side-space rules.');
    const sizeFail = checkSnsIcon({ width: 32, height: 32, spacing: { left: 20, right: 20 }, viewportWidth: 375 });
    assert.equal(sizeFail.ok, false);
    assert.ok(sizeFail.issues.includes('size'));
    assert.ok(sizeFail.suggestions.some((text) => text.includes('40 × 40')));
    const spaceFail = checkSnsIcon({ width: 40, height: 40, spacing: { left: 8, right: 20 }, viewportWidth: 768 });
    assert.equal(spaceFail.ok, false);
    assert.ok(spaceFail.issues.includes('spacing'));
    assert.ok(spaceFail.suggestions.some((text) => text.includes('left')));
  });

  it('allows 30 / 32 / 40 px squares on PC and still requires half-width sides', () => {
    for (const n of [30, 32, 40]) {
      const result = checkSnsIcon({ width: n, height: n, spacing: { left: n / 2, right: n / 2 }, viewportWidth: 1280 });
      assert.equal(result.ok, true, `${n}×${n} should pass on PC`);
      assert.equal(result.screen, 'pc');
    }
    const tight = checkSnsIcon({ width: 32, height: 32, spacing: { left: 8, right: 16 }, viewportWidth: 1440 });
    assert.equal(tight.ok, false);
    assert.ok(tight.issues.includes('spacing'));
    const odd = checkSnsIcon({ width: 40, height: 28, spacing: { left: 20, right: 20 }, viewportWidth: 1024 });
    assert.equal(odd.ok, false);
    assert.ok(odd.issues.includes('size'));
  });

  it('treats 39.6 × 40.4 as 40 × 40', () => {
    const result = checkSnsIcon({ width: 39.6, height: 40.4, spacing: { left: 19.8, right: 20 }, viewportWidth: 400 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.size, { w: 40, h: 40 });
  });

  it('names Instagram, LINE, Facebook, mail and reservation from ordinary CMS markup', () => {
    assert.equal(classifySns({ href: 'https://www.instagram.com/', alt: 'instagram' }).label, 'Instagram');
    assert.equal(classifySns({ className: '-w-sns-icon', src: '/_img/-w-line-sub/' }).id, 'line');
    assert.equal(classifySns({ href: 'https://line.me/' }).label, 'LINE');
    assert.equal(classifySns({ href: 'https://www.facebook.com/page' }).id, 'facebook');
    assert.equal(classifySns({ href: 'mailto:a@b.c' }).label, 'Mail');
    assert.equal(classifySns({ text: 'ご予約はこちら', href: 'https://line.me/' }).id, 'line');
    assert.equal(classifySns({ className: '-w-sns-icon' }).label, 'SNS');
    assert.equal(classifySns({ href: '/about/' }), null);
    assert.equal(looksLikeSnsIcon({ href: 'https://www.instagram.com/' }, { w: 40, h: 40 }), true);
    assert.equal(looksLikeSnsIcon({ href: '/logo/' }, { w: 180, h: 48 }), false);
  });

  it('treats a close pair in one row as side by side, and a distant button as not', () => {
    const insta = { x: 10, y: 8, w: 40, h: 40 };
    const line = { x: 58, y: 8, w: 40, h: 40 };
    const reserve = { x: 160, y: 4, w: 140, h: 44 };
    assert.equal(areSideBySide(insta, line), true);
    assert.equal(areSideBySide(line, insta), true);
    assert.equal(areSideBySide(line, reserve), false);
  });

  it('measures left/right clearance to the nearest other box in the same band', () => {
    const icon = { x: 100, y: 10, w: 40, h: 40 };
    const logo = { x: 10, y: 8, w: 70, h: 44 };
    const button = { x: 180, y: 6, w: 120, h: 48 };
    const gap = clearanceFromRects(icon, [logo, button], 400);
    assert.equal(Math.round(gap.left), 20);
    assert.equal(Math.round(gap.right), 40);
    const overlap = clearanceFromRects(icon, [{ x: 90, y: 10, w: 20, h: 40 }], 400);
    assert.ok(overlap.left <= 0);
  });

  it('requires matching sizes and even gaps across a row of SNS icons', () => {
    const even = checkSnsCluster([
      { box: { x: 10, y: 8, w: 40, h: 40 } },
      { box: { x: 58, y: 8, w: 40, h: 40 } },
      { box: { x: 106, y: 8, w: 40, h: 40 } },
    ]);
    assert.equal(even.ok, true);
    assert.equal(even.sameSize, true);
    assert.equal(even.sameGap, true);
    assert.deepEqual(even.gaps, [8, 8]);

    const mixed = checkSnsCluster([
      { box: { x: 10, y: 8, w: 40, h: 40 } },
      { box: { x: 58, y: 8, w: 32, h: 32 } },
    ]);
    assert.equal(mixed.ok, false);
    assert.ok(mixed.issues.includes('uniformSize'));

    const uneven = checkSnsCluster([
      { box: { x: 10, y: 8, w: 40, h: 40 } },
      { box: { x: 58, y: 8, w: 40, h: 40 } },
      { box: { x: 114, y: 8, w: 40, h: 40 } },
    ]);
    assert.equal(uneven.ok, false);
    assert.ok(uneven.issues.includes('uniformGap'));
  });

  it('fails when the used spacing CSS is under half the icon width', () => {
    const tight = checkSnsIcon({
      width: 40,
      height: 40,
      cssSpacing: { left: [], right: [{ property: 'margin-right', value: '10px', px: 10 }] },
      viewportWidth: 375,
    });
    assert.equal(tight.ok, false);
    assert.ok(tight.issues.includes('spacing'));
    assert.ok(tight.suggestions.some((text) => text.includes('margin-right') && text.includes('10px')));

    const pad = checkSnsIcon({
      width: 40,
      height: 40,
      cssSpacing: { left: [], right: [{ property: 'padding-right', value: '8px', px: 8 }] },
      viewportWidth: 1280,
    });
    assert.equal(pad.ok, false);
    assert.ok(pad.suggestions.some((text) => text.includes('padding-right')));

    const pass = checkSnsIcon({
      width: 40,
      height: 40,
      cssSpacing: { left: [], right: [{ property: 'margin-right', value: '20px', px: 20 }] },
      viewportWidth: 375,
    });
    assert.equal(pass.ok, true);
  });

  it('compares the spacing CSS on each icon in the row, not empty viewport clearance', () => {
    const mixed = checkSnsCluster([
      {
        box: { x: 10, y: 8, w: 40, h: 40 },
        cssSpacing: { right: [{ property: 'margin-right', value: '10px', px: 10 }] },
      },
      {
        box: { x: 60, y: 8, w: 40, h: 40 },
        cssSpacing: { right: [{ property: 'margin-right', value: '20px', px: 20 }] },
      },
    ]);
    assert.equal(mixed.ok, false);
    assert.equal(mixed.sameGap, false);
    assert.ok(mixed.issues.includes('uniformGap'));
    assert.ok(mixed.suggestions.some((text) => text.includes('margin-right: 10px')));
  });

  it('reads max-width / min-width from @media conditions and names the rule range', () => {
    assert.deepEqual(mediaWidthBounds(['@media (max-width: 768px)']), { min: null, max: 768 });
    assert.deepEqual(mediaWidthBounds(['@media (min-width: 769px)']), { min: 769, max: null });
    assert.ok(describeRuleRange(727).includes('768'));
    assert.ok(describeRuleRange(727).includes('below'));
    assert.ok(describeRuleRange(727).includes('727'));
    assert.ok(describeRuleRange(1321).includes('above'));
    assert.deepEqual(cssSourceExtras({ origin: 'inline' }).map((item) => item.kind), ['inline']);
    assert.deepEqual(
      cssSourceExtras({ origin: 'stylesheet', conditions: ['@media (max-width: 768px)'], selector: '[data-lib="1"] .x', stylesheetLabel: '_css/$/page/1' }).map((item) => item.text),
      ['@media (max-width: 768px)'],
    );
    assert.deepEqual(cssSourceExtras({ origin: 'stylesheet', conditions: [], selector: '.-w-sns-icon', stylesheetLabel: '_css/$/page/lib/1' }), []);
  });
});

describe('SNS Checker: on the page', () => {
  it('selects an SNS icon on click and does not follow the link', async () => {
    const root = place(
      '<a class="-w-sns-icon" href="https://www.instagram.com/" id="sns-ig">' +
        '<img alt="instagram" width="40" height="40" style="display:block;width:40px;height:40px;background:#f06"></a>',
    );
    const link = root.querySelector('#sns-ig');
    let navigated = false;
    link.addEventListener('click', () => {
      navigated = true;
    });
    assert.equal(startSnsChecker({}).running, true);
    assert.ok(isSnsCheckerRunning());
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    link.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(navigated, false);
    const selected = selectedSnsIcons();
    assert.equal(selected.length, 1);
    assert.equal(selected[0].kind, 'instagram');
    assert.ok(document.getElementById('wit-sns-checker'));
    stopSnsChecker();
    assert.ok(!isSnsCheckerRunning());
    assert.equal(document.getElementById('wit-sns-checker'), null);
  });

  it('adds a neighbour in the same row to the selection', () => {
    const root = place(
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:nowrap;width:max-content">' +
        '<a class="-w-sns-icon" href="https://www.instagram.com/"><img alt="instagram" style="display:block;width:40px;height:40px;background:#f06"></a>' +
        '<a class="-w-sns-icon" href="https://line.me/"><img alt="line" style="display:block;width:40px;height:40px;background:#6c0"></a>' +
        '</div>',
    );
    startSnsChecker({});
    const [ig, line] = [...root.querySelectorAll('a')];
    ig.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    line.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    const selected = selectedSnsIcons();
    assert.equal(selected.length, 2);
    assert.deepEqual(selected.map((item) => item.kind).sort(), ['instagram', 'line']);
  });

  it('stops on Escape', () => {
    startSnsChecker({});
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!isSnsCheckerRunning());
  });

  it('previews an icon on hover and only locks the selection on click', () => {
    const root = place(
      '<a class="-w-sns-icon" href="https://www.instagram.com/" id="sns-ig">' +
        '<img alt="instagram" width="40" height="40" style="display:block;width:40px;height:40px;background:#f06"></a>',
    );
    const link = root.querySelector('#sns-ig');
    const box = link.getBoundingClientRect();
    startSnsChecker({});
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: box.left + 8,
        clientY: box.top + 8,
      }),
    );
    assert.equal(selectedSnsIcons().length, 0);
    const preview = snsCheckerReport();
    assert.equal(preview.active, false);
    assert.equal(preview.perfect, false);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    assert.equal(selectedSnsIcons().length, 1);
    const locked = snsCheckerReport();
    assert.equal(locked.active, true);
    assert.equal(locked.perfect, false);
  });

  it('does not call the width Perfect until small screen and PC both pass', () => {
    const root = place(
      '<a class="-w-sns-icon" href="https://www.instagram.com/">' +
        '<img alt="instagram" width="40" height="40" style="display:block;width:40px;height:40px;background:#f06"></a>',
    );
    startSnsChecker({});
    root.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    const report = snsCheckerReport();
    assert.equal(report.active, true);
    assert.equal(report.perfect, false);
    assert.ok(report.screens.sp !== 'pass' || report.screens.pc !== 'pass');
  });

  it('fails the row when SNS icons in the same line are not the same size', () => {
    const root = place(
      '<div style="display:flex;gap:8px;align-items:center;width:max-content">' +
        '<a class="-w-sns-icon" href="https://www.instagram.com/"><img alt="instagram" style="display:block;width:40px;height:40px;background:#f06"></a>' +
        '<a class="-w-sns-icon" href="https://line.me/"><img alt="line" style="display:block;width:32px;height:32px;background:#6c0"></a>' +
        '</div>',
    );
    startSnsChecker({});
    root.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    const report = snsCheckerReport();
    assert.equal(report.cluster.sameSize, false);
    assert.equal(report.currentOk, false);
    assert.equal(report.perfect, false);
    assert.ok((report.suggestions || []).some((text) => text.includes('same size')));
  });

  it('fails a 10px margin-right on a 40px icon and reports that CSS', () => {
    const root = place(
      '<div style="display:flex;align-items:center;width:max-content">' +
        '<a class="-w-sns-icon" href="https://www.instagram.com/" style="margin-right:10px">' +
        '<img alt="instagram" style="display:block;width:40px;height:40px;background:#f06"></a>' +
        '<a class="-w-sns-icon" href="https://line.me/" style="margin-right:20px">' +
        '<img alt="line" style="display:block;width:40px;height:40px;background:#6c0"></a>' +
        '</div>',
    );
    startSnsChecker({});
    root.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    const report = snsCheckerReport();
    assert.equal(report.perfect, false);
    assert.equal(report.currentOk, false);
    const ig = report.items[0];
    assert.ok(ig.cssSpacing.right.some((decl) => decl.property === 'margin-right' && Math.round(decl.px) === 10));
    assert.ok(ig.issues.includes('spacing'));
    assert.ok((report.suggestions || []).some((text) => /margin-right/.test(text) && /10px/.test(text)));
    assert.equal(ig.cssSpacing.right[0].source?.origin, 'inline');
  });

  it('names the media query the spacing CSS comes from, without inventing a source', async () => {
    const style = document.createElement('style');
    style.textContent =
      '@media (min-width: 1px){a.-w-sns-icon{margin-right:10px}a.-w-sns-icon img{width:40px;height:40px;display:block}}';
    document.head.append(style);
    created.push(style);
    const root = place(
      '<a class="-w-sns-icon" href="https://www.instagram.com/"><img alt="instagram"></a>',
    );
    startSnsChecker({});
    await snsCssIndexReady();
    root.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    const report = snsCheckerReport();
    const decl = (report.items[0].cssSpacing.right || []).find((item) => item.property === 'margin-right' || item.property === 'margin');
    assert.ok(decl, 'expected margin-right CSS');
    assert.ok(decl.source, 'author CSS must have a real source');
    assert.equal(decl.source.origin, 'stylesheet');
    assert.ok((decl.source.conditions || []).some((item) => item.includes('min-width: 1px')));
    assert.ok((decl.source.selector || '').includes('-w-sns-icon'));
    assert.ok(report.failRange && report.failRange.includes('768'));
  });
});
