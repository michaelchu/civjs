const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: mockLogger,
  logger: mockLogger,
}));

jest.mock('../../src/database/redis', () => ({
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
    deleteGameState: jest.fn().mockResolvedValue(undefined),
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
    adapter: { rooms: new Map() },
  },
} as any;

jest.mock('socket.io', () => ({
  Server: jest.fn().mockImplementation(() => mockIo),
}));

export { mockIo, mockLogger, mockSocket };
