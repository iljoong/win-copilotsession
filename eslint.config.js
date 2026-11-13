import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.superpowers/**',
      'playwright-report/**',
      'test-results/**',
      'desktop/artifacts/**',
      'desktop/downloads/**',
      'desktop/**/bin/**',
      'desktop/**/obj/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS Node scripts used by desktop packaging and shell tests.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
);
