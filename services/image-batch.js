/**
 * Shared save path for Image Convert and Image Resize: one file downloads
 * directly, several files download as an uncompressed zip.
 */

import { saveBlob } from './image-export.js';
import { buildStoreZip } from './zip-store.js';

export function uniqueNames(names) {
  const used = new Map();
  return names.map((raw) => {
    const name = String(raw || 'image');
    const key = name.toLowerCase();
    const n = (used.get(key) || 0) + 1;
    used.set(key, n);
    if (n === 1) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    return `${base}-${n}${ext}`;
  });
}

export async function saveResults(results, zipName) {
  if (!results.length) throw new Error('Choose at least one image.');
  if (results.length === 1) {
    saveBlob(results[0].blob, results[0].filename);
    return { kind: 'file', count: 1 };
  }
  const names = uniqueNames(results.map((item) => item.filename));
  const zip = await buildStoreZip(results.map((item, index) => ({ name: names[index], data: item.blob })));
  saveBlob(zip, zipName);
  return { kind: 'zip', count: results.length };
}

export function savedMessage(result) {
  if (result.kind === 'file') return 'Image saved.';
  return `Saved ${result.count} images as a zip.`;
}
