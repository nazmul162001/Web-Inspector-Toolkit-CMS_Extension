/**
 * Official Image: a library of bundled icons. The panel shows them as a
 * 4-across grid of 50×50 thumbnails; Download saves the original file.
 */

import { el } from '../../../shared/helpers.js';
import { saveBlob } from '../../../services/image-export.js';
import { icon } from '../../components/icons.js';
import { OFFICIAL_IMAGES, officialImageUrl } from './official-images.js';

async function ensureStyles() {
  for (const file of ['../color-find/color-find.css', './official-image.css']) {
    const href = new URL(file, import.meta.url).href;
    if (document.querySelector(`link[href="${href}"]`)) continue;
    await new Promise((resolve) => {
      const link = el('link', { rel: 'stylesheet', href });
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
      document.head.append(link);
    });
  }
}

export function createFeature(ctx) {
  let busy = '';

  async function downloadItem(item, button) {
    if (busy) return;
    busy = item.id;
    button.disabled = true;
    try {
      const response = await fetch(officialImageUrl(item.file));
      if (!response.ok) throw new Error('The image could not be downloaded.');
      const blob = await response.blob();
      saveBlob(blob, item.file);
      ctx.notify.success('Image saved.');
    } catch (error) {
      ctx.notify.error(error?.message || 'The image could not be downloaded.');
    } finally {
      busy = '';
      button.disabled = false;
    }
  }

  function card(item) {
    const thumb = el('img', {
      class: 'oi-thumb',
      src: officialImageUrl(item.file),
      alt: item.name,
      width: '50',
      height: '50',
      draggable: 'false',
    });
    const name = el('div', { class: 'oi-card__name', title: item.name, ...(item.brand ? { 'data-i18n-skip': true } : {}) }, item.name);
    const button = el('button', { class: 'btn btn--sm oi-card__save', type: 'button' }, icon('download', 14), 'Download');
    button.addEventListener('click', () => downloadItem(item, button));
    return el('article', { class: 'oi-card' }, thumb, name, button);
  }

  async function mount(container) {
    await ensureStyles();
    container.replaceChildren(
      el(
        'section',
        { class: 'cf oi', 'aria-labelledby': 'oi-title' },
        el(
          'div',
          { class: 'cf-head' },
          el('h2', { id: 'oi-title', class: 'cf-title' }, 'Official Icon'),
          el('p', { class: 'cf-lead' }, 'Thumbnails are 50×50. Download saves each file at its original size.'),
        ),
        el('div', { class: 'oi-grid' }, ...OFFICIAL_IMAGES.map(card)),
      ),
    );
  }

  function unmount() {}

  return { mount, unmount };
}
