/**
 * Uncompressed ZIP (STORE). Images are already compressed, so wrapping
 * them without deflate keeps the original bytes and needs no extra library.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[i] = crc >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(chunks) {
  const size = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value & 0xffff, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(data || []);
}

function zipName(name) {
  const text = String(name || 'image').replace(/\\/g, '/').replace(/^\/+/, '') || 'image';
  return new TextEncoder().encode(text.slice(0, 180));
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * @param {{ name: string, data: Blob|ArrayBuffer|Uint8Array }[]} entries
 * @returns {Promise<Blob>}
 */
export async function buildStoreZip(entries) {
  const files = [];
  const stamp = dosDateTime();
  for (const entry of entries) {
    const name = zipName(entry.name);
    const data = await toBytes(entry.data);
    files.push({ name, data, crc: crc32(data) });
  }

  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(stamp.time),
      u16(stamp.date),
      u32(file.crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(file.name.length),
      u16(0),
      file.name,
      file.data,
    ]);
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(stamp.time),
      u16(stamp.date),
      u32(file.crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(file.name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      file.name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);

  return new Blob([concat([...locals, centralDir, end])], { type: 'application/zip' });
}
