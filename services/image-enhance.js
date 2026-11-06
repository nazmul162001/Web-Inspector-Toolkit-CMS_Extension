/**
 * Local clarity for Image Convert and Image Resize.
 *
 * Photos are processed on this device: a light chroma cleanup (JPEG noise)
 * and an unsharp pass on luma so a soft or compressed original looks clearer
 * after resize/convert. Flat fills, icons and already-sharp edges are left
 * alone (a threshold on the detail signal).
 */

function clamp(value) {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function boxBlur(src, width, height) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const left = row + (x > 0 ? x - 1 : x);
      const right = row + (x + 1 < width ? x + 1 : x);
      tmp[row + x] = (src[left] + src[row + x] + src[right]) / 3;
    }
  }
  for (let y = 0; y < height; y += 1) {
    const up = (y > 0 ? y - 1 : y) * width;
    const mid = y * width;
    const down = (y + 1 < height ? y + 1 : y) * width;
    for (let x = 0; x < width; x += 1) {
      out[mid + x] = (tmp[up + x] + tmp[mid + x] + tmp[down + x]) / 3;
    }
  }
  return out;
}

function edgeEnergy(luma, width, height) {
  let sum = 0;
  let count = 0;
  const step = Math.max(1, Math.round(Math.min(width, height) / 64));
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const i = y * width + x;
      const lap = Math.abs(luma[i] * 4 - luma[i - 1] - luma[i + 1] - luma[i - width] - luma[i + width]);
      sum += lap;
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

function sharpenAmount(energy, scale) {
  let amount;
  if (energy < 6) amount = 0.95;
  else if (energy < 18) amount = 0.7;
  else if (energy < 36) amount = 0.45;
  else amount = 0.18;
  if (scale > 1.15) amount = Math.min(1.15, amount + 0.28);
  else if (scale < 0.65) amount = Math.max(0.35, amount - 0.08);
  return amount;
}

/**
 * Sharpen luma and lightly denoise chroma, in place on `imageData`.
 * @param {ImageData} imageData
 * @param {{ scale?: number }} [options] dest/source scale; >1 means upscaled
 * @returns {ImageData}
 */
export function enhanceImageData(imageData, { scale = 1 } = {}) {
  const { width, height, data } = imageData;
  if (width < 3 || height < 3) return imageData;

  const n = width * height;
  const luma = new Float32Array(n);
  const cb = new Float32Array(n);
  const cr = new Float32Array(n);

  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
    cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
  }

  const energy = edgeEnergy(luma, width, height);
  const amount = sharpenAmount(energy, scale);
  const lumaBlur = boxBlur(boxBlur(luma, width, height), width, height);
  const cbBlur = boxBlur(cb, width, height);
  const crBlur = boxBlur(cr, width, height);
  const chromaMix = energy < 14 ? 0.42 : 0.22;
  const threshold = energy < 8 ? 2.5 : 5;

  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    const detail = luma[i] - lumaBlur[i];
    let y = luma[i];
    if (Math.abs(detail) >= threshold) y += amount * detail;
    y = clamp(y);
    const cbb = cb[i] * (1 - chromaMix) + cbBlur[i] * chromaMix;
    const crr = cr[i] * (1 - chromaMix) + crBlur[i] * chromaMix;
    data[p] = clamp(y + 1.402 * (crr - 128));
    data[p + 1] = clamp(y - 0.344136 * (cbb - 128) - 0.714136 * (crr - 128));
    data[p + 2] = clamp(y + 1.772 * (cbb - 128));
  }
  return imageData;
}

/** Run the clarity pass on a canvas that already holds the resized picture. */
export function enhanceCanvas(canvas, { scale = 1 } = {}) {
  if (!canvas || !(canvas.width > 2) || !(canvas.height > 2)) return canvas;
  const ctx =
    canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' }) ||
    canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  enhanceImageData(imageData, { scale });
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
