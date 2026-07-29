module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  testPathIgnorePatterns: process.env.CI
    ? ['/node_modules/', 'tests/e2e/audit/']
    : ['/node_modules/'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@config$': '<rootDir>/src/config',
    '^@database/schema$': '<rootDir>/src/database/schema/index.ts',
    '^@database$': '<rootDir>/src/database/index',
    '^@database/(.*)$': '<rootDir>/src/database/$1',
    '^@game/(.*)$': '<rootDir>/src/game/$1',
    '^@network/(.*)$': '<rootDir>/src/network/$1',
    '^@app-types/(.*)$': '<rootDir>/src/types/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    'src/game/ai/': {
      statements: 84,
      branches: 69,
      functions: 82,
      lines: 87,
    },
    'src/game/ai/AICityController.ts': {
      statements: 78,
      branches: 65,
      functions: 62,
      lines: 80,
    },
    'src/game/ai/AIDiplomacyController.ts': {
      statements: 82,
      branches: 69,
      functions: 80,
      lines: 84,
    },
    'src/game/ai/AIDomesticController.ts': {
      statements: 89,
      branches: 69,
      functions: 100,
      lines: 94,
    },
    'src/game/ai/AISpecialUnitController.ts': {
      statements: 72,
      branches: 52,
      functions: 59,
      lines: 75,
    },
    'src/game/ai/AITransportController.ts': {
      statements: 79,
      branches: 58,
      functions: 50,
      lines: 82,
    },
    'src/game/ai/AIUnitController.ts': {
      statements: 80,
      branches: 69,
      functions: 83,
      lines: 84,
    },
    'src/game/ai/AISpaceshipPlanner.ts': {
      statements: 97,
      branches: 75,
      functions: 90,
      lines: 100,
    },
    'src/game/ai/AITreasuryPlanner.ts': {
      statements: 94,
      branches: 80,
      functions: 85,
      lines: 97,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 10000,
  clearMocks: true,
  resetMocks: false,
  restoreMocks: true,
  // Run tests in parallel for performance, but integration tests use their own config
  maxWorkers: '50%',
};
