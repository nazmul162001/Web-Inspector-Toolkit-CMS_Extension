import { afterEach, assert, describe as baseDescribe, it } from '../test-runner.js';
import {
  aspectRatio,
  computeTileSize,
  dataUrlBytes,
  describeScale,
  extractImageUrl,
  formatBytes,
  formatPixels,
  formatSize,
  imageFormat,
  imageName,
  imageSetDensity,
  layerValue,
  layoutBackgroundLayer,
  objectFitRect,
  parseRepeat,
  resolveLength,
  splitSpaces,
  splitTopLevel,
} from '../../services/image-geometry.js';
import { imageAtPoint, isInspectorRunning, startInspector, stopInspector } from '../../content/image-inspector.js';
import { DEFAULT_SETTINGS } from '../../services/settings-service.js';
import { FEATURES, FEATURE_STATUS } from '../../shared/constants.js';

const svg = (w, h, fill = '#c33') => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const created = [];
function describe(name, define) {
  baseDescribe(name, () => {
    afterEach(() => {
      stopInspector();
      while (created.length) created.pop().remove();
    });
    define();
  });
}

describe('Image Resolution: CSS lists', () => {
  it('splits only on top-level commas', () => {
    assert.deepEqual(splitTopLevel('url(a.png), linear-gradient(red, blue), url("b,c.png")'), ['url(a.png)', 'linear-gradient(red, blue)', 'url("b,c.png")']);
    assert.deepEqual(splitTopLevel('none'), ['none']);
    assert.deepEqual(splitTopLevel(''), []);
    assert.deepEqual(splitSpaces('auto  calc(100% - 10px)'), ['auto', 'calc(100% - 10px)']);
  });

  it('reads image addresses and ignores gradients', () => {
    assert.equal(extractImageUrl('url("https://x.test/a b.png")'), 'https://x.test/a b.png');
    assert.equal(extractImageUrl("url('/a.png')"), '/a.png');
    assert.equal(extractImageUrl('url(/a.png)'), '/a.png');
    assert.equal(extractImageUrl('image-set(url("a.png") 1x, url("b.png") 2x)'), 'a.png');
    assert.equal(extractImageUrl('image-set("a.png" 1x)'), 'a.png');
    assert.equal(extractImageUrl('linear-gradient(red, blue)'), null);
    assert.equal(extractImageUrl('none'), null);
    assert.equal(extractImageUrl(''), null);
    assert.equal(imageSetDensity('image-set(url("a.png") 2x)'), 2);
    assert.equal(imageSetDensity('url(a.png)'), 1);
  });

  it('repeats short lists across layers', () => {
    assert.equal(layerValue(['a', 'b'], 3), 'b');
    assert.equal(layerValue([], 0, 'x'), 'x');
  });

  it('resolves lengths, percentages and simple calc()', () => {
    assert.equal(resolveLength('12px', 100), 12);
    assert.equal(resolveLength('50%', 200), 100);
    assert.equal(resolveLength('0', 100), 0);
    assert.equal(resolveLength('auto', 100), null);
    assert.equal(resolveLength('calc(100% - 10px)', 200), 190);
    assert.equal(resolveLength('calc(10px + 50%)', 200), 110);
    assert.equal(resolveLength('nonsense', 100), null);
  });

  it('reads background-repeat', () => {
    assert.deepEqual(parseRepeat('repeat'), { x: 'repeat', y: 'repeat' });
    assert.deepEqual(parseRepeat('repeat-x'), { x: 'repeat', y: 'no-repeat' });
    assert.deepEqual(parseRepeat('no-repeat'), { x: 'no-repeat', y: 'no-repeat' });
    assert.deepEqual(parseRepeat('space round'), { x: 'space', y: 'round' });
  });
});

describe('Image Resolution: where a background is painted', () => {
  const natural = { w: 200, h: 100 };

  it('sizes tiles for auto, cover, contain, lengths and percentages', () => {
    const area = { w: 300, h: 300 };
    assert.deepEqual(pick(computeTileSize('auto', natural, area)), { w: 200, h: 100 });
    assert.deepEqual(pick(computeTileSize('cover', natural, area)), { w: 600, h: 300 });
    assert.deepEqual(pick(computeTileSize('contain', natural, area)), { w: 300, h: 150 });
    assert.deepEqual(pick(computeTileSize('100px', natural, area)), { w: 100, h: 50 });
    assert.deepEqual(pick(computeTileSize('auto 50px', natural, area)), { w: 100, h: 50 });
    assert.deepEqual(pick(computeTileSize('50% 50%', natural, area)), { w: 150, h: 150 });
    assert.deepEqual(pick(computeTileSize('auto', { w: 0, h: 0 }, area)), { w: 300, h: 300 }, 'an image with no size fills the area');
  });

  function pick({ w, h }) {
    return { w, h };
  }

  it('a single centred picture covers only its own rectangle', () => {
    const layer = layoutBackgroundLayer({ natural, area: { w: 300, h: 200 }, size: 'auto', posX: '50%', posY: '50%', repeat: 'no-repeat' });
    assert.deepEqual(layer.tile, { w: 200, h: 100 });
    assert.deepEqual(layer.tileAt(150, 100), { x: 50, y: 50, w: 200, h: 100 });
    assert.equal(layer.tileAt(10, 10), null, 'the empty corner is not the picture');
    assert.equal(layer.tileAt(280, 190), null);
  });

  it('positions with pixels and calc offsets', () => {
    const layer = layoutBackgroundLayer({ natural, area: { w: 300, h: 200 }, size: 'auto', posX: 'calc(100% - 10px)', posY: '0px', repeat: 'no-repeat' });
    assert.deepEqual(layer.tileAt(250, 50), { x: 90, y: 0, w: 200, h: 100 });
    assert.equal(layer.tileAt(50, 50), null);
  });

  it('repeats in both directions and finds the copy under a point', () => {
    const layer = layoutBackgroundLayer({ natural, area: { w: 500, h: 300 }, size: 'auto', posX: '0px', posY: '0px', repeat: 'repeat' });
    assert.deepEqual(layer.tileAt(450, 250), { x: 400, y: 200, w: 200, h: 100 });
    assert.deepEqual(layer.tileAt(10, 10), { x: 0, y: 0, w: 200, h: 100 });
  });

  it('repeat-x covers a single row', () => {
    const layer = layoutBackgroundLayer({ natural, area: { w: 500, h: 300 }, size: 'auto', posX: '0px', posY: '0px', repeat: 'repeat-x' });
    assert.ok(layer.tileAt(450, 50));
    assert.equal(layer.tileAt(450, 150), null);
  });

  it('space leaves gaps between whole copies', () => {
    const layer = layoutBackgroundLayer({ natural: { w: 100, h: 100 }, area: { w: 350, h: 100 }, size: 'auto', posX: '0px', posY: '0px', repeat: 'space no-repeat' });
    assert.ok(layer.tileAt(50, 50), 'first copy');
    assert.equal(layer.tileAt(112, 50), null, 'gap');
    assert.ok(layer.tileAt(340, 50), 'last copy touches the edge');
  });

  it('round stretches copies to fit exactly', () => {
    const layer = layoutBackgroundLayer({ natural: { w: 100, h: 100 }, area: { w: 330, h: 100 }, size: 'auto', posX: '0px', posY: '0px', repeat: 'round no-repeat' });
    assert.ok(Math.abs(layer.tile.w - 110) < 1e-9);
    assert.ok(Math.abs(layer.tile.h - 110) < 1e-9, 'an auto side keeps the picture shape');
  });

  it('object-fit rectangles', () => {
    const box = { w: 300, h: 300 };
    assert.deepEqual(objectFitRect('fill', '50% 50%', box, natural), { x: 0, y: 0, w: 300, h: 300 });
    assert.deepEqual(objectFitRect('contain', '50% 50%', box, natural), { x: 0, y: 75, w: 300, h: 150 });
    assert.deepEqual(objectFitRect('none', '50% 50%', box, natural), { x: 50, y: 100, w: 200, h: 100 });
    assert.equal(objectFitRect('scale-down', '0% 0%', { w: 100, h: 100 }, natural).w, 100);
  });
});

describe('Image Resolution: wording', () => {
  it('formats sizes and bytes', () => {
    assert.equal(formatSize(1200, 800), '1,200 × 800');
    assert.equal(formatPixels(99.04), '99');
    assert.equal(formatPixels(99.5), '99.5');
    assert.equal(formatBytes(0), '');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(84123), '82.2 KB');
    assert.equal(formatBytes(3 * 1024 * 1024), '3 MB');
  });

  it('names common shapes and reduces others', () => {
    assert.equal(aspectRatio(1920, 1080), '16:9');
    assert.equal(aspectRatio(800, 800), '1:1');
    assert.equal(aspectRatio(300, 200), '3:2');
    assert.equal(aspectRatio(1000, 300), '10:3');
    assert.equal(aspectRatio(0, 10), '');
  });

  it('says how the shown size compares with the file', () => {
    assert.equal(describeScale(200, 200).tone, 'ok');
    assert.equal(describeScale(400, 200).tone, 'warn');
    assert.ok(describeScale(400, 200).text.startsWith('Enlarged 2'));
    assert.equal(describeScale(200, 400).text, '2× image, sharp on high-density screens');
    assert.equal(describeScale(100, 350).tone, 'info');
    assert.equal(describeScale(100, 1000).tone, 'warn');
    assert.equal(describeScale(100, 0), null);
  });

  it('reads format and name from addresses', () => {
    assert.equal(imageFormat('https://x.test/a/photo.JPG?v=2'), 'JPEG');
    assert.equal(imageFormat('https://x.test/a.webp'), 'WebP');
    assert.equal(imageFormat('data:image/svg+xml;base64,AAAA'), 'SVG');
    assert.equal(imageFormat('https://x.test/image'), '');
    assert.equal(imageName('https://x.test/a/hero%402x.webp?x=1'), 'hero@2x.webp');
    assert.equal(imageName('data:image/png;base64,AAAA'), 'Inline image (data URL)');
    assert.equal(imageName('https://x.test/'), 'x.test');
  });

  it('measures data URLs', () => {
    assert.equal(dataUrlBytes('data:image/png;base64,QUJD'), 3);
    assert.equal(dataUrlBytes('data:image/svg+xml,%3Csvg%3E'), 5);
    assert.equal(dataUrlBytes('https://x.test/a.png'), 0);
  });
});

/* -------------------------------------------------------- Live page */

function place(html, { id } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position: fixed; left: 40px; top: 40px; z-index: 2147483000; margin: 0; padding: 0;';
  if (id) holder.id = id;
  holder.innerHTML = html;
  document.body.append(holder);
  created.push(holder);
  return holder;
}

/** imageAtPoint, retried while pictures that only now start loading finish. */
async function lookup(x, y, options) {
  let hit = imageAtPoint(x, y, options);
  for (let i = 0; i < 20 && !hit; i += 1) {
    await sleep(25);
    hit = imageAtPoint(x, y, options);
  }
  return hit;
}

describe('Image Resolution: finding images under the pointer', () => {
  it('reports the displayed and the own size of an <img>', async () => {
    const holder = place(`<img id="pic" src="${svg(200, 100)}" width="100" height="50" alt="Red box">`);
    await holder.querySelector('img').decode();
    const hit = await lookup(60, 60);
    assert.ok(hit, 'found');
    assert.equal(hit.kind, 'Image');
    assert.deepEqual({ w: hit.display.w, h: hit.display.h }, { w: 100, h: 50 });
    assert.deepEqual(hit.natural, { w: 200, h: 100 });
    assert.equal(hit.alt, 'Red box');
    assert.equal(hit.ratio, '2:1');
    assert.equal(hit.scale.text, '2× image, sharp on high-density screens');
    assert.equal(hit.format, 'SVG');
  });

  it('looks through text and links placed on top of the image', async () => {
    const holder = place(`
      <div style="position: relative; width: 200px; height: 100px;">
        <img src="${svg(400, 200)}" style="display:block; width: 200px; height: 100px;">
        <a href="#x" style="position:absolute; inset:0; color:#fff;"><span style="position:absolute; left:20px; top:20px;">Big headline</span></a>
      </div>`);
    await holder.querySelector('img').decode();
    const hit = await lookup(70, 70);
    assert.ok(hit);
    assert.equal(hit.kind, 'Image');
    assert.equal(hit.display.w, 200);
    assert.equal(hit.natural.w, 400);
  });

  it('finds a CSS background image under text and other elements', async () => {
    place(`<div style="width: 300px; height: 150px; background: url('${svg(600, 300)}') center / cover no-repeat;"><p style="margin:0; padding: 30px; color:#fff;">Text on the banner</p></div>`);
    const hit = await lookup(100, 100);
    assert.ok(hit, 'found');
    assert.equal(hit.kind, 'Background image');
    assert.deepEqual({ w: hit.display.w, h: hit.display.h }, { w: 300, h: 150 });
    assert.deepEqual(hit.natural, { w: 600, h: 300 });
    assert.deepEqual(hit.box, { w: 300, h: 150 });
    assert.equal(hit.scale.text, '2× image, sharp on high-density screens');
  });

  it('a background that does not repeat is only found over the picture itself', async () => {
    place(`<div style="width: 300px; height: 200px; background: url('${svg(100, 50)}') 0 0 / auto no-repeat;"></div>`);
    assert.ok(await lookup(60, 60), 'on the picture');
    await sleep(100);
    assert.equal(imageAtPoint(300, 200), null, 'in the empty part of the box');
  });

  it('picks the tile under the pointer for a repeating background', async () => {
    place(`<div style="width: 300px; height: 200px; background: url('${svg(100, 50)}') repeat;"></div>`);
    const hit = await lookup(40 + 250, 40 + 170);
    assert.ok(hit);
    assert.deepEqual(hit.outline, { x: 240, y: 190, w: 100, h: 50 }); // the copy of the picture, in window coordinates
    assert.deepEqual({ w: hit.display.w, h: hit.display.h }, { w: 100, h: 50 });
  });

  it('can leave background images out', async () => {
    place(`<div style="width: 200px; height: 100px; background: url('${svg(100, 50)}');"></div>`);
    await lookup(60, 60);
    assert.equal(imageAtPoint(60, 60, { backgrounds: false }), null);
  });

  it('ignores gradients, nothing under the pointer and invisible images', async () => {
    place(`<div style="width: 200px; height: 100px; background: linear-gradient(red, blue);"></div>`);
    assert.equal(imageAtPoint(60, 60), null);
    place(`<img src="${svg(100, 100)}" style="width:100px;height:100px;visibility:hidden;position:fixed;left:300px;top:300px;">`);
    assert.equal(imageAtPoint(320, 320), null);
  });

  it('skips tracking pixels', async () => {
    place(`<img src="${svg(1, 1)}" width="1" height="1" style="position:fixed; left:500px; top:300px;">`);
    assert.equal(imageAtPoint(500, 300), null);
  });

  it('prefers the topmost picture: an icon over a banner', async () => {
    place(`<div style="width: 300px; height: 150px; background: url('${svg(300, 150)}');"><img src="${svg(32, 32)}" width="32" height="32" style="position:absolute; left: 10px; top: 10px;"></div>`);
    const hit = await lookup(40 + 20, 40 + 20);
    assert.equal(hit.kind, 'Image');
    assert.equal(hit.display.w, 32);
    const banner = await lookup(40 + 200, 40 + 100);
    assert.equal(banner.kind, 'Background image');
  });

  it('looks into open shadow roots', async () => {
    const holder = place('<div id="host"></div>');
    const root = holder.querySelector('#host').attachShadow({ mode: 'open' });
    root.innerHTML = `<img src="${svg(80, 40)}" width="80" height="40" style="display:block">`;
    await root.querySelector('img').decode();
    const hit = await lookup(60, 60);
    assert.ok(hit);
    assert.equal(hit.display.w, 80);
  });
});

describe('Image Resolution: the card on the page', () => {
  it('starts, draws a card for the image under the pointer and cleans up on stop', async () => {
    const holder = place(`<img src="${svg(200, 100)}" width="100" height="50">`);
    await holder.querySelector('img').decode();
    assert.equal(startInspector({}).running, true);
    assert.ok(isInspectorRunning());
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60, bubbles: true }));
    await sleep(150);
    assert.ok(document.getElementById('wit-image-inspector'), 'overlay is in the page');
    stopInspector();
    assert.ok(!isInspectorRunning());
    assert.equal(document.getElementById('wit-image-inspector'), null, 'overlay is removed');
  });

  it('can be started twice without a second overlay', () => {
    startInspector({});
    startInspector({ outline: false });
    assert.equal(document.querySelectorAll('#wit-image-inspector').length, 1);
  });

  it('stops on Escape', () => {
    startInspector({});
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!isInspectorRunning());
  });
});

describe('Image Resolution: plumbing', () => {
  it('is an active tool without a scope choice and has defaults', () => {
    const tool = FEATURES.find((f) => f.id === 'image-resolution');
    assert.equal(tool.status, FEATURE_STATUS.ACTIVE);
    assert.equal(tool.usesScope, false);
    assert.deepEqual({ ...DEFAULT_SETTINGS.image }, { backgrounds: true, outline: true, preview: true });
  });
});
