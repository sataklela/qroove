import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'docs/.vitepress/cache/**',
      'coverage/**',
      '.secrets/**',
      'apps/mobile/android/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['apps/server/src/**/*.ts'],
    ignores: ['apps/server/src/db/firestore/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['firebase-admin', 'firebase-admin/*'],
              message: 'Only apps/server/src/db/firestore may import firebase-admin.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/server/src/domain/**/*.ts'],
    ignores: ['apps/server/src/domain/clock.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Use the injected Clock.' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
