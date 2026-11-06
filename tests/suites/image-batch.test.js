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
import { enhanceImageData } from '../../services/image-enhance.js';
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

async function pixelOf(blob, x, y) {
  const img = await loadImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
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

  it('does not re-encode when the resize matches the original pixels', async () => {
    const file = await pngFile('same.png', 8);
    const original = new Uint8Array(await file.arrayBuffer());
    const out = await convertFile(file, 'png', { width: 8, height: 8, quality: 1 });
    const next = new Uint8Array(await out.blob.arrayBuffer());
    assert.deepEqual([...next], [...original]);
  });

  it('keeps a solid colour when shrinking a PNG', async () => {
    const file = await pngFile('red.png', 40);
    const out = await convertFile(file, 'png', { width: 10, height: 'auto', quality: 1 });
    const img = await loadImage(out.blob);
    assert.equal(img.naturalWidth, 10);
    assert.equal(img.naturalHeight, 10);
    const [r, g, b, a] = await pixelOf(out.blob, 5, 5);
    assert.ok(r > 180 && g < 80 && b < 80 && a === 255, `expected red, got ${r},${g},${b},${a}`);
  });

  it('converts PNG to JPG at the original size without softening a solid colour', async () => {
    const file = await pngFile('dot.png', 12);
    const out = await convertFile(file, 'jpg', { quality: 1 });
    const img = await loadImage(out.blob);
    assert.equal(img.naturalWidth, 12);
    assert.equal(img.naturalHeight, 12);
    const [r, g, b] = await pixelOf(out.blob, 6, 6);
    assert.ok(r > 170 && g < 90 && b < 90, `expected red, got ${r},${g},${b}`);
  });

  it('sharpens a soft edge and leaves a flat fill unchanged', () => {
    const flat = new ImageData(8, 8);
    for (let i = 0; i < flat.data.length; i += 4) {
      flat.data[i] = 204;
      flat.data[i + 1] = 51;
      flat.data[i + 2] = 51;
      flat.data[i + 3] = 255;
    }
    enhanceImageData(flat);
    assert.deepEqual([...flat.data.slice(0, 4)], [204, 51, 51, 255]);

    const edge = new ImageData(24, 10);
    const copy = new Uint8ClampedArray(edge.data.length);
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 24; x += 1) {
        const p = (y * 24 + x) * 4;
        const v = x < 12 ? 28 : 228;
        copy[p] = copy[p + 1] = copy[p + 2] = v;
        copy[p + 3] = 255;
      }
    }
    for (let y = 1; y < 9; y += 1) {
      for (let x = 1; x < 23; x += 1) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) sum += copy[((y + dy) * 24 + (x + dx)) * 4];
        }
        const p = (y * 24 + x) * 4;
        const v = Math.round(sum / 9);
        edge.data[p] = edge.data[p + 1] = edge.data[p + 2] = v;
        edge.data[p + 3] = 255;
      }
    }
    const row = 5 * 24 * 4;
    const before = edge.data[row + 12 * 4] - edge.data[row + 11 * 4];
    enhanceImageData(edge, { scale: 2 });
    const after = edge.data[row + 12 * 4] - edge.data[row + 11 * 4];
    assert.ok(after > before, `expected a clearer edge (${before} → ${after})`);
  });

  it('saves a converted WebP smaller than the PNG while keeping the colour', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 160, 100);
    gradient.addColorStop(0, '#c33');
    gradient.addColorStop(1, '#248');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 160, 100);
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([pngBlob], 'scene.png', { type: 'image/png' });
    const out = await convertFile(file, 'webp');
    assert.ok(/webp/i.test(out.blob.type));
    assert.ok(out.blob.size < file.size, `webp ${out.blob.size} should be smaller than png ${file.size}`);
    const [r, g, b] = await pixelOf(out.blob, 8, 8);
    assert.ok(r > 140 && g < 120, `expected a red corner, got ${r},${g},${b}`);
  });

  it('rasterises SVG at the requested size so vectors stay sharp', async () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">' +
      '<rect width="1" height="1" fill="#000"/>' +
      '<rect x="1" y="0" width="3" height="4" fill="#fff"/>' +
      '<rect x="0" y="1" width="1" height="3" fill="#fff"/>' +
      '</svg>';
    const file = new File([markup], 'pixel.svg', { type: 'image/svg+xml' });
    const out = await convertFile(file, 'png', { width: 16, height: 16, quality: 1 });
    const img = await loadImage(out.blob);
    assert.equal(img.naturalWidth, 16);
    assert.equal(img.naturalHeight, 16);
    const black = await pixelOf(out.blob, 1, 1);
    const white = await pixelOf(out.blob, 10, 1);
    assert.ok(black[0] < 20 && black[1] < 20 && black[2] < 20, `expected black corner, got ${black}`);
    assert.ok(white[0] > 240 && white[1] > 240 && white[2] > 240, `expected white field, got ${white}`);
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
