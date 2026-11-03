/**
 * On-device background removal (BRIA RMBG-1.4, quantized ONNX).
 * The photo never leaves the computer. First click loads the local WASM
 * runtime and the model; later clicks reuse them.
 *
 * Model: rmbg-1.4-quant.onnx (BRIA RMBG-1.4, 1024×1024).
 * Runtime: onnxruntime-web 1.17.3 (MIT).
 */

import { downloadFilename, MAX_EXPORT_EDGE } from './image-export.js';

const SIZE = 1024;

let ortPromise = null;
let sessionPromise = null;

function wasmPaths() {
  return new URL('../vendor/ort/', import.meta.url).href;
}

function modelUrl() {
  return new URL('../models/rmbg-1.4-quant.onnx', import.meta.url).href;
}

async function loadOrt() {
  if (!ortPromise) {
    ortPromise = import('../vendor/ort/ort.wasm.min.js').then((mod) => {
      mod.env.wasm.numThreads = 1;
      mod.env.wasm.simd = true;
      mod.env.wasm.proxy = false;
      mod.env.wasm.wasmPaths = wasmPaths();
      return mod;
    });
  }
  return ortPromise;
}

async function loadSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await loadOrt();
      const response = await fetch(modelUrl());
      if (!response.ok) throw new Error('The background could not be removed.');
      const bytes = await response.arrayBuffer();
      return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

export function refineAlpha(value) {
  const lo = 0.1;
  const hi = 0.78;
  if (value <= lo) return 0;
  if (value >= hi) return 1;
  return (value - lo) / (hi - lo);
}

export function sampleBilinear(mask, width, height, x, y) {
  const xClamped = Math.min(width - 1, Math.max(0, x));
  const yClamped = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(xClamped);
  const y0 = Math.floor(yClamped);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = xClamped - x0;
  const fy = yClamped - y0;
  const v00 = mask[y0 * width + x0];
  const v10 = mask[y0 * width + x1];
  const v01 = mask[y1 * width + x0];
  const v11 = mask[y1 * width + x1];
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

/** Fit the picture in a square without stretching (pads the leftover edges). */
export function letterboxRect(srcW, srcH, box = SIZE) {
  const scale = Math.min(box / srcW, box / srcH);
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  return {
    x: Math.floor((box - width) / 2),
    y: Math.floor((box - height) / 2),
    width,
    height,
    box,
  };
}

export function cropMask(mask, maskWidth, layout) {
  const out = new Float32Array(layout.width * layout.height);
  for (let y = 0; y < layout.height; y += 1) {
    const start = (y + layout.y) * maskWidth + layout.x;
    out.set(mask.subarray(start, start + layout.width), y * layout.width);
  }
  return out;
}

function maxFilter(src, width, height, radius) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let max = 0;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx;
        if (nx >= 0 && nx < width) max = Math.max(max, src[y * width + nx]);
      }
      tmp[y * width + x] = max;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let max = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny >= 0 && ny < height) max = Math.max(max, tmp[ny * width + x]);
      }
      out[y * width + x] = max;
    }
  }
  return out;
}

function minFilter(src, width, height, radius) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let min = 1;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx;
        if (nx >= 0 && nx < width) min = Math.min(min, src[y * width + nx]);
      }
      tmp[y * width + x] = min;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let min = 1;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny >= 0 && ny < height) min = Math.min(min, tmp[ny * width + x]);
      }
      out[y * width + x] = min;
    }
  }
  return out;
}

function closeBinary(binary, width, height, radius) {
  return minFilter(maxFilter(binary, width, height, radius), width, height, radius);
}

/**
 * Keep the main subject and drop tiny leftover blobs.
 * Pieces at least 2% of the largest region stay (a disconnected shoe, etc.).
 */
export function keepMainSubject(binary, width, height) {
  const n = width * height;
  const labels = new Int32Array(n);
  const sizes = [0];
  const stack = [];
  let label = 0;
  for (let i = 0; i < n; i += 1) {
    if (!(binary[i] > 0.5) || labels[i]) continue;
    label += 1;
    let size = 0;
    labels[i] = label;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop();
      size += 1;
      const x = p % width;
      const y = (p / width) | 0;
      const next = [p - 1, p + 1, p - width, p + width];
      for (let k = 0; k < 4; k += 1) {
        const q = next[k];
        if (q < 0 || q >= n) continue;
        const nx = q % width;
        const ny = (q / width) | 0;
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        if (binary[q] > 0.5 && !labels[q]) {
          labels[q] = label;
          stack.push(q);
        }
      }
    }
    sizes[label] = size;
  }
  let best = 1;
  for (let i = 1; i <= label; i += 1) if (sizes[i] > (sizes[best] || 0)) best = i;
  const minKeep = Math.max(24, Math.floor((sizes[best] || 0) * 0.02));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const id = labels[i];
    if (id && sizes[id] >= minKeep) out[i] = 1;
  }
  return out;
}

export function refineSubjectMask(soft, width, height) {
  const binary = new Float32Array(soft.length);
  for (let i = 0; i < soft.length; i += 1) binary[i] = soft[i] > 0.22 ? 1 : 0;
  const closed = closeBinary(binary, width, height, 3);
  const kept = keepMainSubject(closed, width, height);
  const guard = maxFilter(kept, width, height, 2);
  const out = new Float32Array(soft.length);
  for (let i = 0; i < soft.length; i += 1) {
    if (!guard[i]) out[i] = 0;
    else if (kept[i]) out[i] = refineAlpha(Math.max(soft[i], 0.28));
    else out[i] = refineAlpha(soft[i]);
  }
  return out;
}

export function applyMaskToImageData(imageData, mask, maskWidth, maskHeight) {
  const { data, width, height } = imageData;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const mx = ((x + 0.5) * maskWidth) / width - 0.5;
      const my = ((y + 0.5) * maskHeight) / height - 0.5;
      const alpha = sampleBilinear(mask, maskWidth, maskHeight, mx, my);
      data[(y * width + x) * 4 + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }
  }
  return imageData;
}

function loadBitmap(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be loaded.'));
    img.src = src;
  });
}

function drawSource(img) {
  let w = img.naturalWidth || img.width || 0;
  let h = img.naturalHeight || img.height || 0;
  if (!(w > 0 && h > 0)) throw new Error('The image has no size.');
  const scale = Math.min(1, MAX_EXPORT_EDGE / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx, width: w, height: h };
}

function toTensor(ort, img, layout) {
  const canvas = document.createElement('canvas');
  canvas.width = layout.box;
  canvas.height = layout.box;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, layout.box, layout.box);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, layout.x, layout.y, layout.width, layout.height);
  const { data } = ctx.getImageData(0, 0, layout.box, layout.box);
  const tensor = new Float32Array(3 * layout.box * layout.box);
  const plane = layout.box * layout.box;
  for (let i = 0; i < plane; i += 1) {
    tensor[i] = data[i * 4] / 255 - 0.5;
    tensor[plane + i] = data[i * 4 + 1] / 255 - 0.5;
    tensor[plane * 2 + i] = data[i * 4 + 2] / 255 - 0.5;
  }
  return new ort.Tensor('float32', tensor, [1, 3, layout.box, layout.box]);
}

function maskFromOutput(output, session) {
  const first = output[session.outputNames[0]] || output[Object.keys(output)[0]];
  const data = first?.data;
  if (!data || !data.length) throw new Error('The background could not be removed.');
  const dims = first.dims || [];
  const width = dims[dims.length - 1] || SIZE;
  const height = dims[dims.length - 2] || SIZE;
  const mask = new Float32Array(width * height);
  const count = Math.min(mask.length, data.length);
  let max = 0;
  for (let i = 0; i < count; i += 1) {
    const value = data[i];
    mask[i] = value;
    if (value > max) max = value;
  }
  if (max > 1.5) {
    for (let i = 0; i < count; i += 1) mask[i] /= 255;
  }
  return { mask, width, height };
}

function canvasPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('The background could not be removed.'));
      else resolve(blob);
    }, 'image/png');
  });
}

/**
 * Cut the subject out of `file` and return a transparent PNG.
 * @param {Blob} file
 * @param {{ name?: string }} [options]
 */
export async function removeBackground(file, { name = 'image' } = {}) {
  const ort = await loadOrt();
  const session = await loadSession();
  const url = URL.createObjectURL(file);
  try {
    const img = await loadBitmap(url);
    const source = drawSource(img);
    const layout = letterboxRect(source.width, source.height, SIZE);
    const feeds = { [session.inputNames[0]]: toTensor(ort, source.canvas, layout) };
    const output = await session.run(feeds);
    const inferred = maskFromOutput(output, session);
    const cropped = cropMask(inferred.mask, inferred.width, layout);
    const cleaned = refineSubjectMask(cropped, layout.width, layout.height);
    const pixels = source.ctx.getImageData(0, 0, source.width, source.height);
    applyMaskToImageData(pixels, cleaned, layout.width, layout.height);
    source.ctx.putImageData(pixels, 0, 0);
    const blob = await canvasPng(source.canvas);
    const filename = downloadFilename(name, 'png').replace(/\.png$/i, '-no-bg.png');
    return { blob, filename, width: source.width, height: source.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
