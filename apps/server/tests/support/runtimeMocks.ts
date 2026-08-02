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
