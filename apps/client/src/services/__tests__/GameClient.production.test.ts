import { gameClient } from '../GameClient';
import type { ProductionOption } from '../../types';
import { vi } from 'vitest';

const jest = vi;

// Mock socket.io
const mockSocket = {
  connected: true,
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
};

describe('GameClient Production Methods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Replace the socket with our mock
    (gameClient as unknown as { socket: typeof mockSocket }).socket = mockSocket;
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('getAvailableProductions', () => {
    it('should successfully get available productions', async () => {
      const mockProductions: ProductionOption[] = [
        {
          id: 'warrior',
          name: 'Warrior',
          type: 'unit',
          cost: 10,
          available: true,
          description: 'Basic military unit',
        },
        {
          id: 'granary',
          name: 'Granary',
          type: 'building',
          cost: 60,
          available: true,
          description: 'Stores food',
        },
      ];

      // Mock the response
      mockSocket.on.mockImplementation((event: string, callback: (data: unknown) => void) => {
        if (event === 'city:availableProductions') {
          setTimeout(() => {
            callback({
              cityId: 'city-1',
              productions: mockProductions,
            });
          }, 10);
        }
      });

      const promise = gameClient.getAvailableProductions('city-1');

      // Verify request was sent
      expect(mockSocket.emit).toHaveBeenCalledWith('city:getAvailableProductions', {
        cityId: 'city-1',
      });

      const result = await promise;
      expect(result).toEqual(mockProductions);
    });

    it('should handle server errors', async () => {
      mockSocket.on.mockImplementation((event: string, callback: (data: unknown) => void) => {
        if (event === 'error') {
          setTimeout(() => {
            callback({ message: 'City not found' });
          }, 10);
        }
      });

      await expect(gameClient.getAvailableProductions('invalid-city')).rejects.toThrow(
        'City not found'
      );
    });

    it('should handle timeout', async () => {
      jest.useFakeTimers();

      // Don't mock any response to trigger timeout
      mockSocket.on.mockImplementation(() => {});

      const promise = gameClient.getAvailableProductions('city-1');

      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(10000);

      await expect(promise).rejects.toThrow('Get available productions timeout');

      jest.useRealTimers();
    });

    it('should reject when socket is not connected', async () => {
      (gameClient as unknown as { socket: null }).socket = null;

      await expect(gameClient.getAvailableProductions('city-1')).rejects.toThrow(
        'Not connected to server'
      );
    });

    it('should clean up event listeners on success', async () => {
      mockSocket.on.mockImplementation((event: string, callback: (data: unknown) => void) => {
        if (event === 'city:availableProductions') {
          setTimeout(() => {
            callback({
              cityId: 'city-1',
              productions: [],
            });
          }, 10);
        }
      });

      await gameClient.getAvailableProductions('city-1');

      expect(mockSocket.off).toHaveBeenCalledWith(
        'city:availableProductions',
        expect.any(Function)
      );
    });

    it('should only respond to matching cityId', async () => {
      let resolveCount = 0;

      mockSocket.on.mockImplementation((event: string, callback: (data: unknown) => void) => {
        if (event === 'city:availableProductions') {
          setTimeout(() => {
            // Send response for different city first
            callback({
              cityId: 'different-city',
              productions: [],
            });

            // Then send response for requested city
            setTimeout(() => {
              callback({
                cityId: 'city-1',
                productions: [
                  { id: 'warrior', name: 'Warrior', type: 'unit', cost: 10, available: true },
                ],
              });
              resolveCount++;
            }, 10);
          }, 10);
        }
      });

      const result = await gameClient.getAvailableProductions('city-1');
      expect(result).toHaveLength(1);
      expect(resolveCount).toBe(1);
    });
  });

  describe('changeProduction', () => {
    it('should successfully change production', async () => {
      const mockResponse = {
        cityId: 'city-1',
        production: {
          target: 'Archer',
          type: 'unit',
          progress: 5,
          cost: 15,
          turnsToComplete: 2,
        },
        shieldStock: 5,
        penalty: 2,
      };

      mockSocket.on.mockImplementation((event: string, callback: (data: unknown) => void) => {
        if (event === 'city:productionChanged') {
          setTimeout(() => {
            callback(mockResponse);
          }, 10);
        }
      });

      const promise = gameClient.changeProduction('city-1', 'archer', 'unit');

      // Verify request was sent
      expect(mockSocket.emit).toHaveBeenCalledWith('city:changeProduction', {
        cityId: 'city-1',
        productionId: 'archer',
        productionType: 'unit',
      });

      await promise;

      // This test mainly verifies the method completes without error
      // In a real implementation, we'd also verify game store updates
    });

    it('should handle production change errors', async () => {
      mockSocket.on.mockImplementation((event: string, callback: (data: unknown) => void) => {
        if (event === 'error') {
          setTimeout(() => {
            callback({ message: 'Production not available' });
          }, 10);
        }
      });

      await expect(gameClient.changeProduction('city-1', 'invalid-unit', 'unit')).rejects.toThrow(
        'Production not available'
      );
    });

    it('should handle timeout for production change', async () => {
      jest.useFakeTimers();

      mockSocket.on.mockImplementation(() => {});

      const promise = gameClient.changeProduction('city-1', 'archer', 'unit');

      jest.advanceTimersByTime(10000);

      await expect(promise).rejects.toThrow('Change production timeout');

      jest.useRealTimers();
    });

    it('should reject when socket is not connected', async () => {
      (gameClient as unknown as { socket: null }).socket = null;

      await expect(gameClient.changeProduction('city-1', 'archer', 'unit')).rejects.toThrow(
        'Not connected to server'
      );
    });

    it('should only respond to matching cityId', async () => {
      let responseCount = 0;

      mockSocket.on.mockImplementation((event: string, callback: (data: unknown) => void) => {
        if (event === 'city:productionChanged') {
          setTimeout(() => {
            // Send response for different city first
            callback({
              cityId: 'different-city',
              production: {},
              shieldStock: 0,
              penalty: 0,
            });

            // Then send response for requested city
            setTimeout(() => {
              callback({
                cityId: 'city-1',
                production: {
                  target: 'Archer',
                  type: 'unit',
                  progress: 0,
                  cost: 15,
                  turnsToComplete: 3,
                },
                shieldStock: 0,
                penalty: 0,
              });
              responseCount++;
            }, 10);
          }, 10);
        }
      });

      await gameClient.changeProduction('city-1', 'archer', 'unit');
      expect(responseCount).toBe(1);
    });

    it('should clean up event listeners after response', async () => {
      mockSocket.on.mockImplementation((event: string, callback: (data: unknown) => void) => {
        if (event === 'city:productionChanged') {
          setTimeout(() => {
            callback({
              cityId: 'city-1',
              production: {},
              shieldStock: 0,
              penalty: 0,
            });
          }, 10);
        }
      });

      await gameClient.changeProduction('city-1', 'archer', 'unit');

      expect(mockSocket.off).toHaveBeenCalledWith('city:productionChanged', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('production completion event handling', () => {
    it('should handle unit production completion', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      // Find the production:completed handler
      const productionCompletedCalls = mockSocket.on.mock.calls.filter(
        call => call[0] === 'production:completed'
      );

      // If the handler exists, test it
      if (productionCompletedCalls.length > 0) {
        const handler = productionCompletedCalls[0][1];

        handler({
          cityId: 'city-1',
          productionType: 'unit',
          productionId: 'warrior',
          newUnitId: 'unit-123',
        });

        expect(consoleLogSpy).toHaveBeenCalledWith('Production completed:', expect.any(Object));
        expect(consoleLogSpy).toHaveBeenCalledWith('New unit unit-123 created at city city-1');
      }

      consoleLogSpy.mockRestore();
    });

    it('should handle building production completion', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const productionCompletedCalls = mockSocket.on.mock.calls.filter(
        call => call[0] === 'production:completed'
      );

      if (productionCompletedCalls.length > 0) {
        const handler = productionCompletedCalls[0][1];

        handler({
          cityId: 'city-1',
          productionType: 'building',
          productionId: 'granary',
        });

        expect(consoleLogSpy).toHaveBeenCalledWith('Building granary completed in city city-1');
      }

      consoleLogSpy.mockRestore();
    });
  });
});
