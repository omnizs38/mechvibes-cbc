'use strict';

const { expandNumberTemplate } = require('./validation');

function resolveSoundReference(primary, fallbackTemplate, load, random = Math.random) {
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

module.exports = { resolveSoundReference };
