module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.integration.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json'
    }],
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
  setupFilesAfterEnv: ['<rootDir>/tests/setup.integration.ts'],
  testTimeout: 30000, // Longer timeout for integration tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  // Run tests serially to avoid database conflicts
  maxWorkers: 1,
  // Force Jest to exit after tests complete (needed for integration tests with DB connections)
  forceExit: true,
};