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
  extends: [
    'eslint:recommended',
    'prettier',
  ],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'out/',
    'src/audio/',
    'src/assets/jquery.js',
    'src/assets/milligram.min.css',
    '.eslintrc.js',
  ],
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-undef': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
    'prefer-const': 'warn',
  },
  overrides: [
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'commonjs',
      },
      plugins: ['@typescript-eslint'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'prettier',
      ],
      rules: {
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
