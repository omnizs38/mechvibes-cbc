'use strict';

class LatencyTracker {
  constructor(capacity = 2048) {
    this.capacity = capacity;
    this.samples = [];
    this.totalSamples = 0;
  }

  record(milliseconds) {
    const value = Number(milliseconds);
    if (!Number.isFinite(value) || value < 0 || value > 10000) return;
    this.samples.push(value);
    this.totalSamples += 1;
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  percentile(percent) {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1));
    return sorted[index];
  }

  getStats() {
    return {
      samples: this.samples.length,
      totalSamples: this.totalSamples,
      p50Ms: this.percentile(50),
      p95Ms: this.percentile(95),
      p99Ms: this.percentile(99),
      maxMs: this.samples.length ? Math.max(...this.samples) : 0,
    };
  }
}

module.exports = { LatencyTracker };
