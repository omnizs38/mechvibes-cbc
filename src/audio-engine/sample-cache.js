'use strict';

const DEFAULT_CACHE_BUDGET_BYTES = 192 * 1024 * 1024;
const MAX_SAMPLE_BYTES = 64 * 1024 * 1024;

function estimateAudioBufferBytes(buffer) {
  if (!buffer) return 0;
  const frames = Number(buffer.length) || 0;
  const channels = Number(buffer.numberOfChannels) || 1;
  return frames * channels * 4;
}

class SampleCache {
  constructor({
    context,
    fetchImpl = globalThis.fetch,
    readSourceImpl = (source) => require('../libs/soundpacks/file-manager').ReadSoundpackSource(source),
    budgetBytes = DEFAULT_CACHE_BUDGET_BYTES,
    maxSampleBytes = MAX_SAMPLE_BYTES,
    now = () => Date.now(),
  }) {
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

  has(source) {
    return this.entries.has(source);
  }

  get(source) {
    const entry = this.entries.get(source);
    if (!entry) return null;
    entry.lastUsed = this.now();
    return entry.buffer;
  }

  async load(source, { pinned = false } = {}) {
    const cached = this.entries.get(source);
    if (cached) {
      cached.lastUsed = this.now();
      cached.pinned = cached.pinned || pinned;
      return cached.buffer;
    }
    if (this.pending.has(source)) return this.pending.get(source);

    const loading = this.loadInternal(source, pinned).finally(() => {
      this.pending.delete(source);
    });
    this.pending.set(source, loading);
    return loading;
  }

  async loadInternal(source, pinned) {
    let bytes;
    const localBuffer = await this.readSourceImpl(source);
    if (localBuffer !== null) {
      if (localBuffer.byteLength > this.maxSampleBytes) {
        throw new Error(`Audio sample exceeds the ${this.maxSampleBytes} byte limit.`);
      }
      bytes = localBuffer.buffer.slice(localBuffer.byteOffset, localBuffer.byteOffset + localBuffer.byteLength);
    } else {
      const response = await this.fetchImpl(source);
      if (!response || !response.ok) {
        throw new Error(`Audio sample request failed for ${source}.`);
      }
      const advertisedSize = Number(response.headers && response.headers.get('content-length'));
      if (Number.isFinite(advertisedSize) && advertisedSize > this.maxSampleBytes) {
        throw new Error(`Audio sample exceeds the ${this.maxSampleBytes} byte limit.`);
      }
      bytes = await response.arrayBuffer();
      if (bytes.byteLength > this.maxSampleBytes) {
        throw new Error(`Audio sample exceeds the ${this.maxSampleBytes} byte limit.`);
      }
    }
    const buffer = await this.context.decodeAudioData(bytes.slice(0));
    const decodedBytes = estimateAudioBufferBytes(buffer);
    this.entries.set(source, {
      buffer,
      bytes: decodedBytes,
      pinned,
      lastUsed: this.now(),
    });
    this.totalBytes += decodedBytes;
    this.evictToBudget();
    return buffer;
  }

  async preload(sources, options = {}) {
    return Promise.all([...new Set(sources)].map((source) => this.load(source, options)));
  }

  evictToBudget() {
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

  clear({ includePinned = true } = {}) {
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

  getStats() {
    return {
      entries: this.entries.size,
      pending: this.pending.size,
      totalBytes: this.totalBytes,
      budgetBytes: this.budgetBytes,
    };
  }
}

module.exports = {
  DEFAULT_CACHE_BUDGET_BYTES,
  MAX_SAMPLE_BYTES,
  SampleCache,
  estimateAudioBufferBytes,
};
