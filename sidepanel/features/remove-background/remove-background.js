/**
 * Remove Background: upload one photo, cut the subject out on this device,
 * watch a wipe that reveals the transparent PNG, then download it.
 */

import { el } from '../../../shared/helpers.js';
import { acceptForFormat, saveBlob } from '../../../services/image-export.js';
import { removeBackground } from '../../../services/background-removal.js';
import { icon } from '../../components/icons.js';

async function ensureStyles() {
  for (const file of ['../color-find/color-find.css', '../image-batch/image-batch.css', './remove-background.css']) {
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

function loadPreview(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ url, img });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The image could not be loaded.'));
    };
    img.src = url;
  });
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

export function createFeature(ctx) {
  let file = null;
  let originalUrl = '';
  let resultUrl = '';
  let result = null;
  let busy = false;
  let refs = null;

  function revoke(url) {
    if (url) URL.revokeObjectURL(url);
  }

  function setBusy(on, label = 'Removing…') {
    if (!refs) return;
    refs.busy.hidden = !on;
    refs.busyLabel.textContent = label;
    refs.remove.disabled = on || !file;
    refs.download.disabled = on || !result;
    refs.change.disabled = on;
    refs.drop.disabled = on;
    if (on) refs.remove.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), label);
    else refs.remove.replaceChildren(icon('eraser', { size: 14 }), 'Remove background');
  }

  function showPreview(url, name) {
    refs.base.src = url;
    refs.reveal.src = url;
    refs.name.textContent = name;
    refs.stage.hidden = false;
    refs.drop.hidden = true;
    refs.remove.hidden = false;
    refs.download.hidden = true;
    refs.handle.hidden = true;
    refs.clip.hidden = true;
    refs.clip.style.width = '0%';
    refs.handle.style.left = '0%';
  }

  function reset() {
    revoke(originalUrl);
    revoke(resultUrl);
    originalUrl = '';
    resultUrl = '';
    result = null;
    file = null;
    if (!refs) return;
    refs.base.removeAttribute('src');
    refs.reveal.removeAttribute('src');
    refs.stage.hidden = true;
    refs.drop.hidden = false;
    refs.remove.hidden = true;
    refs.download.hidden = true;
    refs.handle.hidden = true;
    refs.clip.hidden = true;
    refs.input.value = '';
    setBusy(false);
  }

  async function takeFile(next) {
    if (!next || busy) return;
    try {
      const preview = await loadPreview(next);
      revoke(originalUrl);
      revoke(resultUrl);
      resultUrl = '';
      result = null;
      file = next;
      originalUrl = preview.url;
      showPreview(originalUrl, next.name);
      setBusy(false);
    } catch (error) {
      ctx.notify.error(error?.message || 'The image could not be loaded.');
    }
  }

  function playWipe() {
    refs.frame.style.setProperty('--rb-frame-w', `${refs.frame.clientWidth}px`);
    refs.clip.hidden = false;
    refs.handle.hidden = false;
    refs.clip.style.transition = 'none';
    refs.handle.style.transition = 'none';
    refs.clip.style.width = '0%';
    refs.handle.style.left = '0%';
    if (prefersReducedMotion()) {
      refs.base.src = resultUrl;
      refs.clip.hidden = true;
      refs.handle.hidden = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        refs.clip.removeEventListener('transitionend', done);
        refs.base.src = resultUrl;
        refs.clip.hidden = true;
        refs.handle.hidden = true;
        resolve();
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const ease = '0.95s cubic-bezier(0.22, 1, 0.36, 1)';
          refs.clip.style.transition = `width ${ease}`;
          refs.handle.style.transition = `left ${ease}`;
          refs.clip.style.width = '100%';
          refs.handle.style.left = '100%';
        });
      });
      refs.clip.addEventListener('transitionend', done);
      setTimeout(done, 1200);
    });
  }

  async function run() {
    if (busy || !file) {
      ctx.notify.error('Choose an image first.');
      return;
    }
    busy = true;
    setBusy(true, 'Removing…');
    try {
      result = await removeBackground(file, { name: file.name });
      revoke(resultUrl);
      resultUrl = URL.createObjectURL(result.blob);
      refs.reveal.src = resultUrl;
      await new Promise((resolve) => {
        if (refs.reveal.complete && refs.reveal.naturalWidth) resolve();
        else refs.reveal.addEventListener('load', resolve, { once: true });
      });
      refs.busy.hidden = true;
      await playWipe();
      refs.download.hidden = false;
      refs.remove.hidden = true;
      ctx.notify.success('Background removed.');
    } catch (error) {
      ctx.notify.error(error?.message || 'The background could not be removed.');
      refs.remove.hidden = false;
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  function download() {
    if (!result) return;
    saveBlob(result.blob, result.filename);
    ctx.notify.success('Image saved.');
  }

  function onDrop(event) {
    event.preventDefault();
    if (event.type === 'dragover') refs.drop.dataset.over = 'true';
    else delete refs.drop.dataset.over;
    if (event.type !== 'drop') return;
    const next = event.dataTransfer?.files?.[0];
    if (next) takeFile(next);
  }

  async function mount(container) {
    await ensureStyles();
    const input = el('input', { type: 'file', accept: acceptForFormat(), hidden: true });
    const drop = el(
      'button',
      { class: 'ib-drop', type: 'button', 'aria-label': 'Choose an image' },
      icon('image', { size: 22 }),
      el('strong', { class: 'ib-drop__title' }, 'Drop an image here'),
      el('p', { class: 'ib-drop__hint' }, 'PNG, JPG or WebP. The result is a PNG with a transparent background.'),
    );
    const base = el('img', { class: 'rb-base', alt: 'Preview' });
    const reveal = el('img', { class: 'rb-reveal', alt: '' });
    const clip = el('div', { class: 'rb-clip', hidden: true }, reveal);
    const handle = el('div', { class: 'rb-handle', hidden: true });
    const busyLabel = el('span', {}, 'Removing…');
    const busyBox = el('div', { class: 'rb-busy', hidden: true }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), busyLabel);
    const frame = el('div', { class: 'rb-frame' }, base, clip, handle, busyBox);
    const name = el('span', { class: 'rb-name', 'data-i18n-skip': true });
    const change = el('button', { class: 'btn btn--sm btn--ghost rb-change', type: 'button' }, 'Choose another image');
    const stage = el(
      'div',
      { class: 'rb-stage', hidden: true },
      frame,
      el('div', { class: 'rb-meta' }, name, change),
    );
    const remove = el('button', { class: 'btn btn--primary', type: 'button', hidden: true }, icon('eraser', { size: 14 }), 'Remove background');
    const downloadBtn = el('button', { class: 'btn btn--primary rb-download', type: 'button', hidden: true }, icon('download', { size: 14 }), 'Download');

    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', onDrop);
    drop.addEventListener('dragleave', onDrop);
    drop.addEventListener('drop', onDrop);
    input.addEventListener('change', () => {
      const next = input.files?.[0];
      input.value = '';
      if (next) takeFile(next);
    });
    change.addEventListener('click', () => input.click());
    remove.addEventListener('click', run);
    downloadBtn.addEventListener('click', download);

    refs = { input, drop, base, reveal, clip, handle, busy: busyBox, busyLabel, frame, name, change, stage, remove, download: downloadBtn };

    container.replaceChildren(
      el(
        'section',
        { class: 'cf rb', 'aria-labelledby': 'rb-title' },
        el(
          'div',
          { class: 'cf-head' },
          el('h2', { id: 'rb-title', class: 'cf-title' }, 'Remove Background'),
          el('p', { class: 'cf-lead' }, 'Cut the subject out of a photo. Download a PNG with a transparent background.'),
        ),
        drop,
        input,
        stage,
        el('div', { class: 'rb-actions' }, remove, downloadBtn),
      ),
    );
  }

  function unmount() {
    reset();
    refs = null;
  }

  return { mount, unmount };
}
