import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'assets/**',
      'docs/**',
      '.specgate/**',
      '.sg-fixed-live-*/**',
      '.ak47_dsh_stage/**',
      '*.tgz',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      // Defensive initialization is used deliberately across the v3 runtime.
      'no-useless-assignment': 'off',
      'no-console': 'off',
    },
  },
];
