import { afterEach, assert, describe, it } from '../test-runner.js';
import { FEATURES, FEATURE_STATUS } from '../../shared/constants.js';
import { hasFeature } from '../../sidepanel/features/registry.js';
import {
  applyMaskToImageData,
  keepMainSubject,
  letterboxRect,
  refineAlpha,
  sampleBilinear,
} from '../../services/background-removal.js';
import { downloadFilename } from '../../services/image-export.js';
import { createFeature } from '../../sidepanel/features/remove-background/remove-background.js';

describe('Remove Background: registry', () => {
  it('is an active tool before Screenshot Taker and needs no scope', () => {
    const ids = FEATURES.map((feature) => feature.id);
    const tool = FEATURES.find((feature) => feature.id === 'remove-background');
    assert.ok(tool);
    assert.equal(tool.status, FEATURE_STATUS.ACTIVE);
    assert.equal(tool.usesScope, false);
    assert.equal(tool.label, 'Remove Background');
    assert.ok(hasFeature('remove-background'));
    assert.ok(ids.indexOf('remove-background') < ids.indexOf('screenshot'));
    assert.equal(ids[ids.length - 1], 'screenshot');
  });
});

describe('Remove Background: mask', () => {
  it('turns low scores into transparent pixels and high scores into solid ones', () => {
    assert.equal(refineAlpha(0), 0);
    assert.equal(refineAlpha(1), 1);
    assert.ok(refineAlpha(0.5) > 0 && refineAlpha(0.5) < 1);
    const mask = new Float32Array([0, 1, 0, 1]);
    assert.equal(sampleBilinear(mask, 2, 2, 0, 0), 0);
    assert.equal(sampleBilinear(mask, 2, 2, 1, 0), 1);
    const image = new ImageData(2, 2);
    for (let i = 0; i < 4; i += 1) {
      image.data[i * 4] = 200;
      image.data[i * 4 + 1] = 10;
      image.data[i * 4 + 2] = 10;
      image.data[i * 4 + 3] = 255;
    }
    applyMaskToImageData(image, mask, 2, 2);
    assert.equal(image.data[3], 0);
    assert.equal(image.data[7], 255);
    assert.equal(image.data[11], 0);
    assert.equal(image.data[15], 255);
    assert.equal(image.data[0], 200);
  });

  it('letterboxes without stretching, and drops tiny leftover blobs', () => {
    const box = letterboxRect(200, 100, 1024);
    assert.equal(box.width, 1024);
    assert.equal(box.height, 512);
    assert.equal(box.x, 0);
    assert.equal(box.y, 256);
    const wide = letterboxRect(100, 200, 1024);
    assert.equal(wide.width, 512);
    assert.equal(wide.height, 1024);
    const mask = new Float32Array(8 * 8);
    for (let y = 1; y <= 6; y += 1) for (let x = 1; x <= 6; x += 1) mask[y * 8 + x] = 1;
    mask[0] = 1;
    mask[7] = 1;
    const kept = keepMainSubject(mask, 8, 8);
    assert.equal(kept[1 * 8 + 1], 1);
    assert.equal(kept[0], 0);
    assert.equal(kept[7], 0);
  });

  it('names the download as a transparent PNG', () => {
    assert.equal(downloadFilename('hero.jpg', 'png').replace(/\.png$/i, '-no-bg.png'), 'hero-no-bg.png');
    assert.equal(downloadFilename('logo.PNG', 'png').replace(/\.png$/i, '-no-bg.png'), 'logo-no-bg.png');
  });
});

describe('Remove Background: panel', () => {
  const nodes = [];
  afterEach(() => {
    while (nodes.length) nodes.pop().remove();
  });

  it('shows a drop zone, then a preview and remove button after a file is chosen', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    nodes.push(root);
    const feature = createFeature({ notify: { success() {}, error() {}, info() {} } });
    await feature.mount(root);
    assert.equal(root.querySelector('#rb-title').textContent, 'Remove Background');
    assert.ok(root.querySelector('.ib-drop'));
    const input = root.querySelector('input[type="file"]');
    assert.ok(input.accept.includes('.png'));
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    canvas.getContext('2d').fillRect(0, 0, 4, 4);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'subject.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stage = root.querySelector('.rb-stage');
    assert.equal(stage.hidden, false);
    const remove = [...root.querySelectorAll('button')].find((button) => button.textContent.includes('Remove background'));
    assert.ok(remove);
    assert.equal(remove.hidden, false);
    feature.unmount();
  });
});
