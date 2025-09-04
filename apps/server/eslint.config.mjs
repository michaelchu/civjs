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
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-var-requires': 'error',

      // General JavaScript/TypeScript
      'no-console': 'warn',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-unused-expressions': 'error',
      'prefer-const': 'error',
      'no-var': 'error',

      // Code quality (default thresholds for app/service code)
      complexity: ['warn', 10],
      'max-depth': ['warn', 4],
    },
  },
  // Higher thresholds for algorithmic modules (map gen, pathfinding, terrain, ruleset processing)
  {
    files: [
      'src/game/map/**/*.ts',
      'src/game/terrain/**/*.ts',
      'src/game/PathfindingManager.ts',
      'src/game/ActionSystem.ts',
      'src/shared/data/rulesets/RulesetLoader.ts',
      'src/game/constants/MovementConstants.ts'
    ],
    rules: {
      complexity: ['warn', 20],
      'max-depth': ['warn', 5],
    },
  },
  // Disable complexity rules for tests to reduce noise
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      complexity: 'off',
      'max-depth': 'off',
    },
  }
);
