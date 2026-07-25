module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'commonjs',
  },
  extends: ['eslint:recommended', 'prettier'],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'out/',
    'src/audio/',
    'src/renderer-dist/',
    // The React renderer is type-checked by `npm run typecheck`
    // (tsconfig.renderer.json); @typescript-eslint does not support TypeScript 7 yet.
    'src/renderer/',
    '.eslintrc.js',
  ],
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-undef': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
    'prefer-const': 'warn',
  },
};
