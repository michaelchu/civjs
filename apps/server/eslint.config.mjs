import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'drizzle/**/*', 'coverage/**/*', '*.js', '*.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      prettier: prettier,
    },
    rules: {
      // Prettier integration
      'prettier/prettier': [
        'error',
        {
          endOfLine: 'auto',
        },
      ],

      // TypeScript specific
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-var-requires': 'error',

      // General JavaScript/TypeScript
      'no-console': 'warn',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-unused-expressions': 'error',
      'prefer-const': 'error',
      'no-var': 'error',

      // Code quality
      complexity: ['warn', 10],
      'max-depth': ['warn', 4],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      // Relax some rules for test files
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);
