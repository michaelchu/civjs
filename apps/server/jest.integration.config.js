module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.integration.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
    },
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
};