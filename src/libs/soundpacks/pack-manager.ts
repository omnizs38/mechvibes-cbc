'use strict';

export interface LoadableSoundpack {
  pack_id: string;
  audio?: unknown;
  LoadSounds(): Promise<void> | void;
  UnloadSounds(): void;
  [key: string]: unknown;
}

export class SoundpackSelectionError extends Error {
  readonly code: string;

  constructor(message: string, code = 'SOUNDPACK_SELECTION_FAILED') {
    super(message);
    this.name = 'SoundpackSelectionError';
    this.code = code;
  }
}

export class SoundpackManager<TPack extends LoadableSoundpack = LoadableSoundpack> {
  readonly packs: TPack[];
  private currentPack: TPack | null;
  private requestId: number;
  private latestPackId: string | null;
  private readonly pendingLoads: Map<string, Promise<void>>;

  constructor(packs: TPack[] = []) {
    this.packs = packs;
    this.currentPack = null;
    this.requestId = 0;
    this.latestPackId = null;
    this.pendingLoads = new Map();
  }

  get current(): TPack | null {
    return this.currentPack;
  }

  findById(packId: string): TPack | null {
    return this.packs.find((pack) => pack.pack_id === packId) || null;
  }

  select(packId: string): Promise<TPack> {
    this.latestPackId = packId;
    const requestId = ++this.requestId;
    return this.selectInternal(packId, requestId);
  }

  loadPack(pack: TPack): Promise<void> {
    if (pack.audio !== undefined) {
      return Promise.resolve();
    }
    const pending = this.pendingLoads.get(pack.pack_id);
    if (pending) {
      return pending;
    }
    const load = Promise.resolve()
      .then(() => pack.LoadSounds())
      .catch((error: unknown) => {
        pack.UnloadSounds();
        throw error;
      })
      .finally(() => {
        this.pendingLoads.delete(pack.pack_id);
      });
    this.pendingLoads.set(pack.pack_id, load);
    return load;
  }

  async selectInternal(packId: string, requestId: number): Promise<TPack> {
    const nextPack = this.findById(packId);
    if (!nextPack) {
      throw new SoundpackSelectionError(
        `Soundpack "${packId}" does not exist.`,
        'SOUNDPACK_NOT_FOUND',
      );
    }

    if (nextPack === this.currentPack && nextPack.audio !== undefined) {
      return nextPack;
    }

    const previousPack = this.currentPack;
    try {
      await this.loadPack(nextPack);
    } catch (error) {
      throw new SoundpackSelectionError(
        error instanceof Error ? error.message : String(error),
        'SOUNDPACK_LOAD_FAILED',
      );
    }

    if (requestId !== this.requestId) {
      if (this.latestPackId !== nextPack.pack_id && nextPack !== this.currentPack) {
        nextPack.UnloadSounds();
      }
      throw new SoundpackSelectionError(
        'A newer soundpack selection replaced this request.',
        'SOUNDPACK_SELECTION_STALE',
      );
    }

    this.currentPack = nextPack;
    if (previousPack && previousPack !== nextPack) {
      previousPack.UnloadSounds();
    }
    return nextPack;
  }

  dispose(): void {
    this.requestId += 1;
    this.latestPackId = null;
    this.pendingLoads.clear();
    for (const pack of this.packs) {
      if (pack && typeof pack.UnloadSounds === 'function') {
        pack.UnloadSounds();
      }
    }
    this.currentPack = null;
  }
}
