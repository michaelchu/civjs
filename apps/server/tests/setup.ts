// Test setup and global mocks

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.PORT = '3000';

// Mock logger to prevent console spam during tests
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

// Mock Redis
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

// Create a comprehensive database mock
const mockDbChain = {
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([{ id: 'test-id' }]),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  query: {
    users: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    games: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
};

// Mock database
jest.mock('../src/database', () => ({
  db: mockDbChain,
}));

// Mock Socket.IO with proper typing
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

// Export mocks for use in tests
export { mockSocket, mockIo };
