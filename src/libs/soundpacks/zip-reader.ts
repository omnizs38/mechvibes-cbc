'use strict';

import fs from 'fs';
import zlib from 'zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export type ZipEntry = {
  entryName: string;
  isDirectory: boolean;
  header: { size: number };
  getData(): Buffer;
};

// Minimal, read-only ZIP archive reader built on Node's zlib. It parses the
// central directory in memory and never writes to disk, so unlike adm-zip it
// cannot follow symbolic links at an extraction destination (CWE-59). It
// supports the STORED (0) and DEFLATE (8) compression methods, which is all the
// application uses for soundpacks.
export class ZipArchive {
  private readonly buffer: Buffer;
  private entries: ZipEntry[] | null = null;

  constructor(source: string | Buffer) {
    this.buffer = typeof source === 'string' ? fs.readFileSync(source) : source;
  }

  getEntries(): ZipEntry[] {
    if (!this.entries) {
      this.entries = this.parse();
    }
    return this.entries;
  }

  private findEndOfCentralDirectory(): number {
    const buffer = this.buffer;
    const minSize = 22;
    if (buffer.length < minSize) {
      throw new Error('Invalid ZIP archive: file is too small.');
    }
    const lowest = Math.max(0, buffer.length - minSize - 0xffff);
    for (let i = buffer.length - minSize; i >= lowest; i--) {
      if (buffer.readUInt32LE(i) === EOCD_SIG) {
        return i;
      }
    }
    throw new Error('Invalid ZIP archive: end of central directory not found.');
  }

  private parse(): ZipEntry[] {
    const buffer = this.buffer;
    const eocd = this.findEndOfCentralDirectory();
    const totalEntries = buffer.readUInt16LE(eocd + 10);
    const centralSize = buffer.readUInt32LE(eocd + 12);
    const centralOffset = buffer.readUInt32LE(eocd + 16);
    if (centralOffset + centralSize > buffer.length) {
      throw new Error('Invalid ZIP archive: central directory is out of range.');
    }
    const entries: ZipEntry[] = [];
    let pointer = centralOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== CEN_SIG) {
        throw new Error('Invalid ZIP archive: malformed central directory.');
      }
      const method = buffer.readUInt16LE(pointer + 10);
      const compressedSize = buffer.readUInt32LE(pointer + 20);
      const uncompressedSize = buffer.readUInt32LE(pointer + 24);
      const nameLength = buffer.readUInt16LE(pointer + 28);
      const extraLength = buffer.readUInt16LE(pointer + 30);
      const commentLength = buffer.readUInt16LE(pointer + 32);
      const localOffset = buffer.readUInt32LE(pointer + 42);
      const entryName = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);
      entries.push({
        entryName,
        isDirectory: entryName.endsWith('/'),
        header: { size: uncompressedSize },
        getData: () => this.readData(localOffset, method, compressedSize),
      });
      pointer += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  private readData(localOffset: number, method: number, compressedSize: number): Buffer {
    const buffer = this.buffer;
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOC_SIG) {
      throw new Error('Invalid ZIP archive: malformed local file header.');
    }
    const nameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw new Error('Invalid ZIP archive: entry data is out of range.');
    }
    const raw = buffer.subarray(dataStart, dataEnd);
    if (method === 0) {
      return Buffer.from(raw);
    }
    if (method === 8) {
      return zlib.inflateRawSync(raw);
    }
    throw new Error(`Unsupported ZIP compression method: ${method}.`);
  }
}
