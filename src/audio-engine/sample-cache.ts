'use strict';

import { readResponseBuffer } from '../utils/installer';

export const DEFAULT_CACHE_BUDGET_BYTES = 192 * 1024 * 1024;
export const MAX_SAMPLE_BYTES = 64 * 1024 * 1024;

export interface DecodedBuffer {
  length?: number;
  numberOfChannels?: number;
  duration?: number;
}

export interface DecodingContext {
  decodeAudioData(data: ArrayBuffer): Promise<DecodedBuffer>;
}

export interface SampleResponse {
  ok?: boolean;
  headers?: { get(name: string): string | null } | undefined;
  body?: { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type SampleFetch = (source: string) => Promise<SampleResponse>;
export type SampleReader = (
  source: string,
) => Promise<Uint8Array | Buffer | null> | Uint8Array | Buffer | null;

export interface SampleCacheOptions {
  context: DecodingContext;
  fetchImpl?: SampleFetch;
  readSourceImpl?: SampleReader;
  budgetBytes?: number;
  maxSampleBytes?: number;
  now?: () => number;
}

export interface SampleCacheStats {
  entries: number;
  pending: number;
  totalBytes: number;
  budgetBytes: number;
}

interface PendingLoad {
  promise: Promise<DecodedBuffer>;
  pinned: boolean;
}

interface CacheEntry {
  buffer: DecodedBuffer;
  bytes: number;
  pinned: boolean;
  lastUsed: number;
}

export function estimateAudioBufferBytes(buffer: DecodedBuffer | null | undefined): number {
  if (!buffer) return 0;
  const frames = Number(buffer.length) || 0;
  const channels = Number(buffer.numberOfChannels) || 1;
  return frames * channels * 4;
}

function defaultReadSource(source: string): Promise<Uint8Array | null> {
  // Lazily required so the renderer bundle does not pull in Node-only code.
  const fileManager = require('../libs/soundpacks/file-manager') as {
    ReadSoundpackSource(source: string): Promise<Uint8Array | null>;
  };
  return fileManager.ReadSoundpackSource(source);
}

export class SampleCache {
  private readonly context: DecodingContext;
  private readonly fetchImpl: SampleFetch;
  private readonly readSourceImpl: SampleReader;
  readonly budgetBytes: number;
  readonly maxSampleBytes: number;
  private readonly now: () => number;
  private readonly entries: Map<string, CacheEntry>;
  private readonly pending: Map<string, PendingLoad>;
  totalBytes: number;
  private generation = 0;

  constructor({
    context,
    fetchImpl = globalThis.fetch as unknown as SampleFetch,
    readSourceImpl = defaultReadSource,
    budgetBytes = DEFAULT_CACHE_BUDGET_BYTES,
    maxSampleBytes = MAX_SAMPLE_BYTES,
    now = () => Date.now(),
  }: SampleCacheOptions) {
    this.context = context;
    this.fetchImpl = fetchImpl;
    this.readSourceImpl = readSourceImpl;
    this.budgetBytes = budgetBytes;
    this.maxSampleBytes = maxSampleBytes;
    this.now = now;
    this.entries = new Map();
    this.pending = new Map();
    this.totalBytes = 0;
  }

  has(source: string): boolean {
    return this.entries.has(source);
  }

  get(source: string): DecodedBuffer | null {
    const entry = this.entries.get(source);
    if (!entry) return null;
    entry.lastUsed = this.now();
    return entry.buffer;
  }

  async load(source: string, { pinned = false }: { pinned?: boolean } = {}): Promise<DecodedBuffer> {
    const cached = this.entries.get(source);
    if (cached) {
      cached.lastUsed = this.now();
      cached.pinned = cached.pinned || pinned;
      return cached.buffer;
    }
    const inFlight = this.pending.get(source);
    if (inFlight) {
      inFlight.pinned ||= pinned;
      return inFlight.promise;
    }

    // Identity, not just the source key, prevents a cleared load from deleting
    // or repopulating a newer request for the same sample.
    const request: PendingLoad = { pinned, promise: Promise.resolve(null as unknown as DecodedBuffer) };
    request.promise = this.loadInternal(source, request).finally(() => {
      if (this.pending.get(source) === request) this.pending.delete(source);
    });
    this.pending.set(source, request);
    return request.promise;
  }

  private async loadInternal(source: string, request: PendingLoad): Promise<DecodedBuffer> {
    let bytes: ArrayBuffer;
    const localBuffer = await this.readSourceImpl(source);
    if (localBuffer !== null && localBuffer !== undefined) {
      if (localBuffer.byteLength > this.maxSampleBytes) {
        throw new Error(`Audio sample exceeds the ${this.maxSampleBytes} byte limit.`);
      }
      bytes = localBuffer.buffer.slice(
        localBuffer.byteOffset,
        localBuffer.byteOffset + localBuffer.byteLength,
      ) as ArrayBuffer;
    } else {
      const response = await this.fetchImpl(source);
      if (!response || !response.ok) {
        throw new Error(`Audio sample request failed for ${source}.`);
      }
      const data = await readResponseBuffer(response, this.maxSampleBytes);
      bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    }
    const buffer = await this.context.decodeAudioData(bytes.slice(0));
    if (this.pending.get(source) !== request) return buffer;
    const decodedBytes = estimateAudioBufferBytes(buffer);
    this.entries.set(source, {
      buffer,
      bytes: decodedBytes,
      pinned: request.pinned,
      lastUsed: this.now(),
    });
    this.totalBytes += decodedBytes;
    this.evictToBudget();
    return buffer;
  }

  async preload(
    sources: Iterable<string>,
    options: { pinned?: boolean } = {},
  ): Promise<DecodedBuffer[]> {
    const generation = this.generation;
    const unique = [...new Set(sources)];
    const buffers: DecodedBuffer[] = new Array(unique.length);
    let cursor = 0;
    // Bound simultaneous file reads and decoding, while preserving result order.
    await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
      while (cursor < unique.length) {
        if (this.generation !== generation) throw new Error('Sample preload was cleared.');
        const index = cursor++;
        buffers[index] = await this.load(unique[index], options);
      }
    }));
    return buffers;
  }

  evictToBudget(): void {
    if (this.totalBytes <= this.budgetBytes) return;
    const candidates = [...this.entries.entries()]
      .filter(([, entry]) => !entry.pinned)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    for (const [source, entry] of candidates) {
      this.entries.delete(source);
      this.totalBytes -= entry.bytes;
      if (this.totalBytes <= this.budgetBytes) break;
    }
  }

  clear({ includePinned = true }: { includePinned?: boolean } = {}): void {
    this.generation += 1;
    for (const [source, request] of this.pending) {
      if (includePinned || !request.pinned) this.pending.delete(source);
    }
    if (includePinned) {
      this.entries.clear();
      this.totalBytes = 0;
      return;
    }
    for (const [source, entry] of this.entries) {
      if (!entry.pinned) {
        this.entries.delete(source);
        this.totalBytes -= entry.bytes;
      }
    }
  }

  getStats(): SampleCacheStats {
    return {
      entries: this.entries.size,
      pending: this.pending.size,
      totalBytes: this.totalBytes,
      budgetBytes: this.budgetBytes,
    };
  }
}
