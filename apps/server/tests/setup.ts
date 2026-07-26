import './support/runtimeMocks';

const mockDbChain = {
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([{ id: 'test-id' }]),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  query: {
    users: { findFirst: jest.fn().mockResolvedValue(null) },
    games: { findMany: jest.fn().mockResolvedValue([]) },
  },
};

jest.mock('../src/database', () => ({
  db: mockDbChain,
}));
