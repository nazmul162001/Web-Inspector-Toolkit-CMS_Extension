/**
 * Image Convert: pick a source format, then a target format, then convert
 * one or more local files. One file downloads directly; several as a zip.
 */

import { el } from '../../../shared/helpers.js';
import { loadSettings, saveSettings } from '../../../services/settings-service.js';
import {
  DOWNLOAD_FORMAT_LABELS,
  DOWNLOAD_FORMATS,
  acceptForFormat,
  convertFile,
  fileMatchesFormat,
} from '../../../services/image-export.js';
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

function formatSelect(value, ariaLabel) {
  const select = el(
    'select',
    { class: 'select', 'aria-label': ariaLabel, 'data-i18n-skip': true },
    ...DOWNLOAD_FORMATS.map((format) => el('option', { value: format }, DOWNLOAD_FORMAT_LABELS[format])),
  );
  select.value = DOWNLOAD_FORMATS.includes(value) ? value : 'png';
  return select;
}

export function createFeature(ctx) {
  let picker = null;
  let busy = false;
  let from = 'png';
  let to = 'webp';

  function formatLabel() {
    return DOWNLOAD_FORMAT_LABELS[from] || 'PNG';
  }

  function applyFrom() {
    picker.setAccept(acceptForFormat(from));
    picker.setFilter((file) => fileMatchesFormat(file, from));
    picker.setLabels(`Drop ${formatLabel()} images here`, `Only ${formatLabel()} files are accepted.`);
  }

  async function persist() {
    await saveSettings({ imageConvert: { from, to } });
  }

  async function convert() {
    if (busy || !picker) return;
    const files = picker.getFiles();
    if (!files.length) {
      ctx.notify.error('Choose at least one image.');
      return;
    }
    busy = true;
    const button = document.getElementById('ib-convert-go');
    if (button) {
      button.disabled = true;
      button.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Converting…');
    }
    try {
      const results = [];
      for (const file of files) {
        if (!fileMatchesFormat(file, from)) continue;
        results.push(await convertFile(file, to));
      }
      if (!results.length) throw new Error(`Those files are not ${formatLabel()} images.`);
      const saved = await saveResults(results, 'converted-images.zip');
      ctx.notify.success(savedMessage(saved));
    } catch (error) {
      ctx.notify.error(error?.message || 'The images could not be converted.');
    } finally {
      busy = false;
      if (button) {
        button.disabled = picker.getFiles().length === 0;
        button.replaceChildren(icon('convert', { size: 14 }), 'Convert');
      }
    }
  }

  async function mount(container) {
    await ensureStyles();
    const settings = await loadSettings();
    from = DOWNLOAD_FORMATS.includes(settings.imageConvert?.from) ? settings.imageConvert.from : 'png';
    to = DOWNLOAD_FORMATS.includes(settings.imageConvert?.to) ? settings.imageConvert.to : 'webp';

    const fromSelect = formatSelect(from, 'From');
    const toSelect = formatSelect(to, 'To');
    fromSelect.value = from;
    toSelect.value = to;

    const go = el('button', { id: 'ib-convert-go', class: 'btn btn--primary', type: 'button', disabled: true, onClick: convert }, icon('convert', { size: 14 }), 'Convert');

    picker = createFilePicker({
      accept: acceptForFormat(from),
      emptyTitle: `Drop ${formatLabel()} images here`,
      emptyHint: `Only ${formatLabel()} files are accepted.`,
      filter: (file) => fileMatchesFormat(file, from),
      onChange: (files) => {
        go.disabled = busy || files.length === 0;
      },
      onSkip: () => ctx.notify.error(`Those files are not ${formatLabel()} images.`),
    });

    fromSelect.addEventListener('change', () => {
      from = fromSelect.value;
      picker.clear();
      applyFrom();
      persist();
    });
    toSelect.addEventListener('change', () => {
      to = toSelect.value;
      persist();
    });

    container.replaceChildren(
      el(
        'section',
        { class: 'cf ib', 'aria-labelledby': 'ib-convert-title' },
        el(
          'div',
          { class: 'cf-head' },
          el('h2', { id: 'ib-convert-title', class: 'cf-title' }, 'Image Convert'),
          el(
            'p',
            { class: 'cf-lead' },
            'Pick the original format, then the format to save. One file downloads directly; several files download as a zip. Quality is kept.',
          ),
        ),
        el(
          'div',
          { class: 'ib-formats' },
          el('label', { class: 'ib-field' }, el('span', { class: 'field-label' }, 'From'), fromSelect),
          el('label', { class: 'ib-field' }, el('span', { class: 'field-label' }, 'To'), toSelect),
        ),
        picker.root,
        el('div', { class: 'ib-actions' }, go),
      ),
    );
  }

  function unmount() {
    picker = null;
    busy = false;
  }

  return { mount, unmount };
}
