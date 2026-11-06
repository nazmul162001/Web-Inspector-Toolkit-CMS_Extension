/**
 * Image Resize: upload one or more images, set width (default 800) and
 * height (default auto), then download the resized files. One file
 * downloads directly; several as a zip.
 */

import { el } from '../../../shared/helpers.js';
import { loadSettings, saveSettings } from '../../../services/settings-service.js';
import { acceptForFormat, convertFile, fileFormat, isAutoHeight, sanitizeExportSize } from '../../../services/image-export.js';
import { saveResults, savedMessage } from '../../../services/image-batch.js';
import { icon } from '../../components/icons.js';
import { createFilePicker } from '../image-batch/file-picker.js';

async function ensureStyles() {
  for (const file of ['../color-find/color-find.css', '../image-batch/image-batch.css']) {
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
  let picker = null;
  let busy = false;
  let widthInput = null;
  let heightInput = null;

  function readSize() {
    const width = widthInput?.value.trim() || '';
    const height = heightInput?.value.trim() || 'auto';
    if (!width) return { error: 'Enter a width.' };
    const size = sanitizeExportSize(width, height);
    if (!size) return { error: 'Enter a width.' };
    if (!isAutoHeight(height) && !(size.h > 0)) return { error: 'Enter a valid height, or leave it as auto.' };
    return { width: size.w, height: size.autoHeight ? 'auto' : size.h };
  }

  async function persist() {
    const width = widthInput?.value.trim() || '800';
    const height = heightInput?.value.trim() || 'auto';
    await saveSettings({ imageResize: { width, height: isAutoHeight(height) ? 'auto' : height } });
  }

  async function resize() {
    if (busy || !picker) return;
    const files = picker.getFiles();
    if (!files.length) {
      ctx.notify.error('Choose at least one image.');
      return;
    }
    const size = readSize();
    if (size.error) {
      ctx.notify.error(size.error);
      return;
    }
    busy = true;
    const button = document.getElementById('ib-resize-go');
    if (button) {
      button.disabled = true;
      button.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Resizing…');
    }
    try {
      const results = [];
      for (const file of files) {
        results.push(await convertFile(file, fileFormat(file), { width: size.width, height: size.height }));
      }
      const saved = await saveResults(results, 'resized-images.zip');
      ctx.notify.success(savedMessage(saved));
      persist();
    } catch (error) {
      ctx.notify.error(error?.message || 'The images could not be resized.');
    } finally {
      busy = false;
      if (button) {
        button.disabled = picker.getFiles().length === 0;
        button.replaceChildren(icon('resize', { size: 14 }), 'Resize');
      }
    }
  }

  async function mount(container) {
    await ensureStyles();
    const settings = await loadSettings();
    const width = settings.imageResize?.width || '800';
    const height = settings.imageResize?.height || 'auto';

    widthInput = el('input', {
      class: 'input',
      type: 'number',
      min: '1',
      max: '8192',
      step: '1',
      inputmode: 'numeric',
      'aria-label': 'Width',
      value: width,
    });
    heightInput = el('input', {
      class: 'input',
      type: 'text',
      inputmode: 'numeric',
      'aria-label': 'Height',
      placeholder: 'Auto',
      value: height,
      spellcheck: 'false',
    });
    widthInput.addEventListener('change', persist);
    heightInput.addEventListener('change', persist);

    const go = el('button', { id: 'ib-resize-go', class: 'btn btn--primary', type: 'button', disabled: true, onClick: resize }, icon('resize', { size: 14 }), 'Resize');

    picker = createFilePicker({
      accept: acceptForFormat(),
      emptyTitle: 'Drop images here',
      emptyHint: 'PNG, JPG, WebP or SVG. One or many.',
      filter: (file) => ['png', 'jpg', 'webp', 'svg'].includes(fileFormat(file)),
      onChange: (files) => {
        go.disabled = busy || files.length === 0;
      },
      onSkip: () => ctx.notify.error('Those files are not PNG, JPG, WebP or SVG images.'),
    });

    container.replaceChildren(
      el(
        'section',
        { class: 'cf ib', 'aria-labelledby': 'ib-resize-title' },
        el(
          'div',
          { class: 'cf-head' },
          el('h2', { id: 'ib-resize-title', class: 'cf-title' }, 'Image Resize'),
          el(
            'p',
            { class: 'cf-lead' },
            'Width starts at 800 and height stays auto unless you change them. One file downloads directly; several files download as a zip.',
          ),
        ),
        el(
          'div',
          { class: 'ib-size' },
          el('label', { class: 'ib-field' }, el('span', { class: 'field-label' }, 'Width'), widthInput),
          el('label', { class: 'ib-field' }, el('span', { class: 'field-label' }, 'Height'), heightInput),
        ),
        picker.root,
        el('div', { class: 'ib-actions' }, go),
      ),
    );
  }

  function unmount() {
    picker = null;
    widthInput = null;
    heightInput = null;
    busy = false;
  }

  return { mount, unmount };
}
