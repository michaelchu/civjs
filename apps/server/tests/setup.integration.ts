// Integration test setup with real database
import dotenv from 'dotenv';

// Load test environment variables
// In CI, environment variables are already set by GitHub Actions
if (!process.env.CI) {
  dotenv.config({ path: '.env.test' });
}

// Set test environment
process.env.NODE_ENV = 'test';

// Mock logger to reduce noise in tests
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

jest.mock('../src/utils/logger', () => ({
  default: mockLogger,
  logger: mockLogger,
}));

// Import after mocking
import { setupTestDatabase, cleanupTestDatabase } from './utils/testDatabase';

// Note: Database mocking removed for simplified ActionSystem tests
// The simplified tests focus on ActionSystem behavior with mock units
// rather than complex GameManager database integration

// Mock Redis (still mock this for integration tests to avoid external dependencies)
jest.mock('../src/database/redis', () => ({
  redis: {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    hset: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({}),
    rpush: jest.fn().mockResolvedValue(1),
    lrange: jest.fn().mockResolvedValue([]),
    ltrim: jest.fn().mockResolvedValue('OK'),
  },
  gameState: {
    setGameState: jest.fn().mockResolvedValue(undefined),
    getGameState: jest.fn().mockResolvedValue({}),
    clearGameState: jest.fn().mockResolvedValue(undefined),
  },
  sessionCache: {
    setSession: jest.fn().mockResolvedValue(undefined),
    getSession: jest.fn().mockResolvedValue('test-user-id'),
    deleteSession: jest.fn().mockResolvedValue(undefined),
  },
  turnQueue: {
    addAction: jest.fn().mockResolvedValue(undefined),
    getActions: jest.fn().mockResolvedValue([]),
    clearActions: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock Socket.IO (still mock for unit tests)
const mockSocket = {
  id: 'test-socket-id',
  emit: jest.fn(),
  to: jest.fn().mockReturnThis(),
  join: jest.fn(),
  leave: jest.fn(),
  on: jest.fn(),
  disconnect: jest.fn(),
};

const mockIo = {
  emit: jest.fn(),
  to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  sockets: {
    sockets: new Map([['test-socket-id', mockSocket]]),
    adapter: {
      rooms: new Map(),
    },
  },
} as any;

jest.mock('socket.io', () => ({
  Server: jest.fn().mockImplementation(() => mockIo),
}));

// Setup and teardown for integration tests
let testDbInitialized = false;

beforeAll(async () => {
  try {
    await setupTestDatabase();
    testDbInitialized = true;
  } catch (error) {
    console.error('Failed to setup test database:', error);
    process.exit(1);
  }
}, 30000); // 30 second timeout for database setup

afterAll(async () => {
  if (testDbInitialized) {
    await cleanupTestDatabase();
  }
}, 10000); // 10 second timeout for cleanup

// Export mocks for use in tests
export { mockSocket, mockIo };
