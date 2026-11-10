// ZIP writer adapted from qqnt-liuli-theme @ dda858b7.
'use strict';

const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_VERSION = 20;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ''), 'utf8');
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function dosDateTime(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date();
  const year = Math.max(1980, Math.min(2107, d.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  };
}
function uniqueEntryName(name, seen) {
  if (!seen.has(name)) return name;
  const slash = name.lastIndexOf('/');
  const dot = name.lastIndexOf('.');
  const head = slash >= 0 ? name.slice(0, slash + 1) : '';
  const file = slash >= 0 ? name.slice(slash + 1) : name;
  const base = dot > slash ? name.slice(0, dot) : name;
  const ext = dot > slash ? name.slice(dot) : '';
  for (let i = 2; i < 1000; i++) {
    const candidate = dot > slash ? base + '-' + i + ext : head + file + '-' + i;
    if (!seen.has(candidate)) return candidate;
  }
  return head + file + '-' + Date.now();
}
function buildZip(entries, options) {
  if (!Array.isArray(entries)) throw new Error('buildZip 需要 entries 数组');
  const opts = options || {};
  const zlib = opts.zlib || require('node:zlib');
  if (!zlib || typeof zlib.deflateRawSync !== 'function')
    throw new Error('缺少 zlib.deflateRawSync');
  const mtime = opts.mtime instanceof Date ? opts.mtime : new Date();
  const dos = dosDateTime(mtime);
  const localChunks = [];
  const centralChunks = [];
  const seen = new Set();
  let offset = 0;
  for (const item of entries) {
    if (!item || typeof item.name !== 'string') throw new Error('ZIP 条目缺少 name');
    let name = item.name
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\.\.\//g, '');
    if (!name) throw new Error('ZIP 条目名为空');
    name = uniqueEntryName(name, seen);
    seen.add(name);
    const data = Buffer.isBuffer(item.data)
      ? item.data
      : Buffer.from(item.data === undefined || item.data === null ? '' : String(item.data), 'utf8');
    if (data.length > 0xffffffff) throw new Error('ZIP 条目超过 4GB：' + name);
    const compressed = zlib.deflateRawSync(data, {
      level: 9
    });
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(ZIP_VERSION, 4);
    local.writeUInt16LE(ZIP_FLAG_UTF8, 6);
    local.writeUInt16LE(ZIP_METHOD_DEFLATE, 8);
    local.writeUInt16LE(dos.time, 10);
    local.writeUInt16LE(dos.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0014, 4);
    central.writeUInt16LE(ZIP_VERSION, 6);
    central.writeUInt16LE(ZIP_FLAG_UTF8, 8);
    central.writeUInt16LE(ZIP_METHOD_DEFLATE, 10);
    central.writeUInt16LE(dos.time, 12);
    central.writeUInt16LE(dos.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  if (seen.size > 0xffff) throw new Error('ZIP 条目过多（>65535），不做 zip64');
  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(seen.size, 8);
  eocd.writeUInt16LE(seen.size, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat(localChunks.concat([centralDir, eocd]));
}
module.exports = { buildZip };
