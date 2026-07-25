'use strict';

import { expandNumberTemplate } from './validation';

export function resolveSoundReference<TResult>(
  primary: string,
  fallbackTemplate: string,
  load: (reference: string) => TResult,
  random: () => number = Math.random,
): TResult {
  try {
    return load(primary);
  } catch (error) {
    const fallback = expandNumberTemplate(fallbackTemplate, random);
    if (fallback === primary) {
      throw error;
    }
    return load(fallback);
  }
}
