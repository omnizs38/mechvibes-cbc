'use strict';

import fs from 'fs';
import zlib from 'zlib';

// Minimal, dependency-free ZIP writer used by the soundpack builder CLI. It
// produces standard archives (STORED or DEFLATE per entry, whichever is
// smaller) and only ever writes the archive bytes it is given. It never
// extracts anything, so it cannot follow symlinks at an extraction
// destination and is a safe replacement for adm-zip's writing side.

const LOC_SIG = 0x04034b50;
const CEN_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipWriterEntry = readonly [name: string, data: Buffer];

export function buildZipFile(entries: readonly ZipWriterEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const method = useDeflate ? 8 : 0;
    const stored = useDeflate ? deflated : data;
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(LOC_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, stored);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(CEN_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + stored.length;
  }
  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

export function writeZipFile(target: string, entries: readonly ZipWriterEntry[]): void {
  fs.writeFileSync(target, buildZipFile(entries));
}
