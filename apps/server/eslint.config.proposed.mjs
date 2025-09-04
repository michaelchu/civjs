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

      // Code quality - default thresholds for application code
      complexity: ['warn', 12],
      'max-depth': ['warn', 4],
    },
  },
  {
    // Algorithmic modules - higher complexity allowed with documentation requirements
    files: [
      'src/game/map/**/*.ts',
      'src/game/terrain/**/*.ts',
      'src/shared/data/rulesets/**/*.ts',
      '**/PathfindingManager.ts',
      '**/TerrainGenerator.ts',
      '**/TerrainUtils.ts',
      '**/FractalHeightGenerator.ts',
      '**/RiverGenerator.ts',
      '**/IslandGenerator.ts',
      '**/BiomeProcessor.ts',
      '**/MapValidator.ts',
      '**/TerrainPlacementProcessor.ts'
    ],
    rules: {
      complexity: ['warn', 20],
      'max-depth': ['warn', 5]
    }
  },
  {
    // Test files - complexity rules disabled for setup flexibility
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      // Relax some rules for test files
      '@typescript-eslint/no-explicit-any': 'off',
      complexity: 'off',
      'max-depth': 'off'
    },
  },
  {
    // Manager and service classes - moderate complexity for business logic
    files: [
      'src/managers/**/*.ts', 
      'src/game/*Manager.ts',
      'src/network/**/*.ts',
      'src/controllers/**/*.ts'
    ],
    rules: {
      complexity: ['warn', 15],
      'max-depth': ['warn', 4]
    }
  }
);