import { afterEach, assert, describe, it } from '../test-runner.js';
import { FEATURES, FEATURE_STATUS } from '../../shared/constants.js';
import { DEFAULT_SETTINGS } from '../../services/settings-service.js';
import { hasFeature } from '../../sidepanel/features/registry.js';
import {
  acceptForFormat,
  convertFile,
  fileFormat,
  fileMatchesFormat,
} from '../../services/image-export.js';
import { savedMessage, uniqueNames } from '../../services/image-batch.js';
import { buildStoreZip, crc32 } from '../../services/zip-store.js';
import { createFeature as createConvert } from '../../sidepanel/features/image-convert/image-convert.js';
import { createFeature as createResize } from '../../sidepanel/features/image-resize/image-resize.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pngFile(name, size = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c33';
  ctx.fillRect(0, 0, size, size);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new File([blob], name, { type: 'image/png' });
}

function svgFile(name, w, h) {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#0a7"/></svg>`;
  return new File([markup], name, { type: 'image/svg+xml' });
}

async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('load failed'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function storedFile(zipBlob, fileName) {
  const buf = new Uint8Array(await zipBlob.arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 22, true);
    const name = new TextDecoder().decode(buf.slice(offset + 30, offset + 30 + nameLen));
    const start = offset + 30 + nameLen + extraLen;
    const data = buf.slice(start, start + size);
    if (name === fileName) return data;
    offset = start + size;
  }
  return null;
}

describe('Image Convert / Resize: registry', () => {
  it('are active tools before Screenshot Taker and need no scope', () => {
    const ids = FEATURES.map((feature) => feature.id);
    const convert = FEATURES.find((feature) => feature.id === 'image-convert');
    const resize = FEATURES.find((feature) => feature.id === 'image-resize');
    assert.equal(convert.status, FEATURE_STATUS.ACTIVE);
    assert.equal(resize.status, FEATURE_STATUS.ACTIVE);
    assert.equal(convert.usesScope, false);
    assert.equal(resize.usesScope, false);
    assert.ok(hasFeature('image-convert'));
    assert.ok(hasFeature('image-resize'));
    assert.ok(ids.indexOf('image-convert') < ids.indexOf('screenshot'));
    assert.ok(ids.indexOf('image-resize') < ids.indexOf('screenshot'));
    assert.equal(ids[ids.length - 1], 'screenshot');
  });

  it('defaults width 800 / height auto and PNG to WebP', () => {
    assert.deepEqual({ ...DEFAULT_SETTINGS.imageResize }, { width: '800', height: 'auto' });
    assert.deepEqual({ ...DEFAULT_SETTINGS.imageConvert }, { from: 'png', to: 'webp' });
  });
});

describe('Image Convert / Resize: files', () => {
  it('reads format from type or name and filters the picker', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const webp = new File(['x'], 'b.webp', { type: '' });
    const jpg = new File(['x'], 'c.jpeg', { type: 'image/jpeg' });
    const gif = new File(['x'], 'd.gif', { type: 'image/gif' });
    assert.equal(fileFormat(png), 'png');
    assert.equal(fileFormat(webp), 'webp');
    assert.equal(fileFormat(jpg), 'jpg');
    assert.equal(fileFormat(gif), '');
    assert.equal(fileMatchesFormat(png, 'png'), true);
    assert.equal(fileMatchesFormat(png, 'webp'), false);
    assert.ok(acceptForFormat('webp').includes('.webp'));
    assert.ok(acceptForFormat('png').includes('image/png'));
    assert.ok(acceptForFormat().includes('.svg'));
  });

  it('keeps original bytes when converting to the same format', async () => {
    const file = await pngFile('keep.png', 6);
    const original = new Uint8Array(await file.arrayBuffer());
    const out = await convertFile(file, 'png');
    const next = new Uint8Array(await out.blob.arrayBuffer());
    assert.equal(out.filename, 'keep.png');
    assert.equal(next.length, original.length);
    assert.deepEqual([...next], [...original]);
  });

  it('converts PNG to WebP without changing the pixel size', async () => {
    const file = await pngFile('dot.png', 10);
    const out = await convertFile(file, 'webp', { quality: 1 });
    assert.equal(out.filename, 'dot.webp');
    assert.ok(/webp/i.test(out.blob.type));
    const img = await loadImage(out.blob);
    assert.equal(img.naturalWidth, 10);
    assert.equal(img.naturalHeight, 10);
  });

  it('resizes with width 800-style custom size and auto height', async () => {
    const file = await pngFile('box.png', 4);
    const out = await convertFile(file, 'png', { width: 8, height: 'auto', quality: 1 });
    const img = await loadImage(out.blob);
    assert.equal(img.naturalWidth, 8);
    assert.equal(img.naturalHeight, 8);
  });

  it('resizes SVG by rewriting width and height, not rasterising', async () => {
    const file = svgFile('mark.svg', 10, 5);
    const out = await convertFile(file, 'svg', { width: 20, height: 'auto' });
    const text = await out.blob.text();
    assert.ok(/width="20"/.test(text));
    assert.ok(/height="10"/.test(text));
    assert.ok(text.includes('<rect'));
  });
});

describe('Image Convert / Resize: zip', () => {
  it('stores files uncompressed so bytes are unchanged', async () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')) >>> 0, 0xcbf43926);
    const hello = new TextEncoder().encode('hello-zip');
    const zip = await buildStoreZip([
      { name: 'a.txt', data: hello },
      { name: 'folder/b.txt', data: new Blob([hello]) },
    ]);
    assert.equal(zip.type, 'application/zip');
    const first = await storedFile(zip, 'a.txt');
    const second = await storedFile(zip, 'folder/b.txt');
    assert.ok(first);
    assert.deepEqual([...first], [...hello]);
    assert.deepEqual([...second], [...hello]);
  });

  it('makes colliding names unique and writes the zip message', () => {
    assert.deepEqual(uniqueNames(['a.png', 'a.png', 'b.jpg']), ['a.png', 'a-2.png', 'b.jpg']);
    assert.equal(savedMessage({ kind: 'file', count: 1 }), 'Image saved.');
    assert.equal(savedMessage({ kind: 'zip', count: 3 }), 'Saved 3 images as a zip.');
  });
});

describe('Image Convert / Resize: panel', () => {
  const nodes = [];
  afterEach(() => {
    while (nodes.length) nodes.pop().remove();
  });

  const ctx = { notify: { success() {}, error() {}, info() {} } };

  it('lets the user pick from/to format before choosing files', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    nodes.push(root);
    const feature = createConvert(ctx);
    await feature.mount(root);
    const from = root.querySelector('[aria-label="From"]');
    const to = root.querySelector('[aria-label="To"]');
    const input = root.querySelector('input[type="file"]');
    assert.ok(from);
    assert.ok(to);
    assert.equal(from.value, 'png');
    assert.equal(to.value, 'webp');
    assert.ok(input.accept.includes('image/png'));
    from.value = 'webp';
    from.dispatchEvent(new Event('change'));
    await sleep(0);
    assert.ok(input.accept.includes('.webp'));
    feature.unmount();
  });

  it('starts resize at 800 by auto and accepts several image types', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    nodes.push(root);
    const feature = createResize(ctx);
    await feature.mount(root);
    const width = root.querySelector('[aria-label="Width"]');
    const height = root.querySelector('[aria-label="Height"]');
    const input = root.querySelector('input[type="file"]');
    assert.equal(width.value, '800');
    assert.equal(height.value, 'auto');
    assert.ok(input.multiple);
    assert.ok(input.accept.includes('.png'));
    assert.ok(input.accept.includes('.jpg'));
    feature.unmount();
  });
});
