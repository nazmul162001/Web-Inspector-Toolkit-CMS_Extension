import { assert, describe, it } from '../test-runner.js';
import { FEATURES, FEATURE_STATUS } from '../../shared/constants.js';
import { OFFICIAL_IMAGES, officialImageUrl } from '../../sidepanel/features/official-image/official-images.js';

describe('Official Image: library', () => {
  it('is an active tool before Screenshot Taker and needs no scope', () => {
    const ids = FEATURES.map((feature) => feature.id);
    const tool = FEATURES.find((feature) => feature.id === 'official-image');
    assert.ok(tool);
    assert.equal(tool.status, FEATURE_STATUS.ACTIVE);
    assert.equal(tool.usesScope, false);
    assert.equal(tool.label, 'Official Icon');
    assert.ok(ids.indexOf('official-image') < ids.indexOf('screenshot'));
    assert.equal(ids[ids.length - 1], 'screenshot');
  });

  it('lists unique original files, four across in the panel', () => {
    assert.equal(OFFICIAL_IMAGES.length, 62);
    const files = OFFICIAL_IMAGES.map((item) => item.file);
    assert.equal(new Set(files).size, OFFICIAL_IMAGES.length);
    assert.equal(new Set(OFFICIAL_IMAGES.map((item) => item.id)).size, OFFICIAL_IMAGES.length);
    for (const item of OFFICIAL_IMAGES) {
      assert.ok(item.file);
      assert.ok(item.name);
      assert.ok(officialImageUrl(item.file).includes(`/library/${item.file}`));
    }
  });

  it('keeps the original icons first, then the extra CMS set', () => {
    assert.deepEqual(
      OFFICIAL_IMAGES.slice(0, 13).map((item) => item.id),
      [
        'instagram',
        'line',
        'facebook',
        'mail',
        'contact',
        'coming-soon',
        'coming-soon-wide',
        'image-coming-soon',
        'uber-eats',
        'delivery',
        'line-qr',
        'sample',
        'sample-portrait',
      ],
    );
    const ids = OFFICIAL_IMAGES.map((item) => item.id);
    for (const id of ['tiktok', 'phone', 'calendar', 'google-maps', 'people', 'cart']) {
      assert.ok(ids.includes(id), id);
    }
  });

  it('can fetch every bundled file so Download has the original bytes', async () => {
    for (const item of OFFICIAL_IMAGES) {
      const response = await fetch(officialImageUrl(item.file));
      assert.equal(response.ok, true, item.file);
      const blob = await response.blob();
      assert.ok(blob.size > 0, item.file);
    }
  });
});
