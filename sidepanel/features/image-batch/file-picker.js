/**
 * Click-or-drop file list used by Image Convert and Image Resize.
 */

import { el, setChildren } from '../../../shared/helpers.js';
import { formatBytes } from '../../../services/image-geometry.js';
import { icon } from '../../components/icons.js';

/**
 * @param {{
 *   accept?: string,
 *   emptyTitle?: string,
 *   emptyHint?: string,
 *   filter?: (file: File) => boolean,
 *   onChange?: (files: File[]) => void,
 *   onSkip?: (count: number) => void,
 * }} options
 */
export function createFilePicker(options = {}) {
  let files = [];
  let accept = options.accept || 'image/*';
  let emptyTitle = options.emptyTitle || 'Drop images here';
  let emptyHint = options.emptyHint || 'or click to choose files';
  let filter = options.filter || null;

  const input = el('input', { type: 'file', accept, multiple: true, hidden: true });
  const title = el('strong', { class: 'ib-drop__title' }, emptyTitle);
  const hint = el('p', { class: 'ib-drop__hint' }, emptyHint);
  const drop = el('button', { class: 'ib-drop', type: 'button', 'aria-label': 'Choose images' }, icon('image', { size: 22 }), title, hint);
  const list = el('ul', { class: 'ib-files', hidden: true });
  const root = el('div', { class: 'ib-picker' }, drop, input, list);

  function keyOf(file) {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }

  function syncList() {
    list.hidden = files.length === 0;
    setChildren(
      list,
      files.map((file, index) => {
        const remove = el(
          'button',
          { class: 'ib-file__remove', type: 'button', 'aria-label': 'Remove', onClick: () => removeAt(index) },
          icon('x', { size: 14 }),
        );
        return el(
          'li',
          { class: 'ib-file' },
          el('span', { class: 'ib-file__name', 'data-i18n-skip': true }, file.name),
          el('span', { class: 'ib-file__size' }, formatBytes(file.size)),
          remove,
        );
      }),
    );
  }

  function render() {
    const has = files.length > 0;
    title.textContent = has ? (files.length === 1 ? '1 image selected' : `${files.length} images selected`) : emptyTitle;
    hint.textContent = has ? 'Click to add more, or drop files here.' : emptyHint;
    drop.dataset.hasFiles = has ? 'true' : 'false';
    syncList();
    options.onChange?.(files.slice());
  }

  function addFiles(incoming) {
    const seen = new Set(files.map(keyOf));
    const next = [];
    let skipped = 0;
    for (const file of incoming) {
      if (!(file instanceof File) || !file.size) continue;
      if (filter && !filter(file)) {
        skipped += 1;
        continue;
      }
      const key = keyOf(file);
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(file);
    }
    if (skipped) options.onSkip?.(skipped);
    if (next.length) files = files.concat(next);
    if (next.length || skipped) render();
  }

  function removeAt(index) {
    files = files.filter((_, i) => i !== index);
    render();
  }

  function onDrag(event) {
    event.preventDefault();
    if (event.type === 'dragover') drop.dataset.over = 'true';
    if (event.type === 'dragleave' || event.type === 'drop') delete drop.dataset.over;
    if (event.type === 'drop') addFiles([...(event.dataTransfer?.files || [])]);
  }

  drop.addEventListener('click', () => input.click());
  root.addEventListener('dragover', onDrag);
  root.addEventListener('dragleave', onDrag);
  root.addEventListener('drop', onDrag);
  input.addEventListener('change', () => {
    addFiles([...input.files]);
    input.value = '';
  });

  function setAccept(value) {
    accept = value;
    input.accept = value;
  }

  function setFilter(fn) {
    filter = fn;
  }

  function setLabels(nextTitle, nextHint) {
    emptyTitle = nextTitle;
    emptyHint = nextHint;
    if (!files.length) render();
  }

  function clear() {
    files = [];
    input.value = '';
    render();
  }

  render();

  return {
    root,
    getFiles: () => files.slice(),
    setAccept,
    setFilter,
    setLabels,
    clear,
  };
}
