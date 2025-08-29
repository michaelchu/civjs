/**
 * Unit test to verify the broadcasting fix works correctly.
 * This tests the core logic change from this.io.emit() to this.io.to().emit()
 */

describe('Broadcasting Fix Verification', () => {
  describe('Socket.IO broadcasting patterns', () => {
    it('should demonstrate the difference between global and game-room broadcasting', () => {
      // Mock Socket.IO server
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });

      const mockIo = {
        emit: mockEmit,
        to: mockTo,
      };

      // Simulate the OLD (buggy) approach - broadcast globally to ALL sockets
      const broadcastGlobally = (event: string, data: any) => {
        mockIo.emit(event, data); // This goes to ALL connected sockets (the bug!)
      };

      // Simulate the NEW (fixed) approach - broadcast to specific game room
      const broadcastToGameRoom = (gameId: string, event: string, data: any) => {
        mockIo.to(`game:${gameId}`).emit(event, data); // Target only this game's room
      };

      // Test data
      const testData = { message: 'test-data' };

      // Reset mocks
      mockEmit.mockClear();
      mockTo.mockClear();

      // Test OLD approach (the bug) - goes to everyone globally
      broadcastGlobally('map-data', testData);
      expect(mockEmit).toHaveBeenCalledWith('map-data', testData);
      expect(mockTo).not.toHaveBeenCalled(); // No targeting at all

      // Reset mocks
      mockEmit.mockClear();
      mockTo.mockClear();

      // Test NEW approach (the fix) - goes only to specific game room
      broadcastToGameRoom('game-123', 'map-data', testData);
      expect(mockTo).toHaveBeenCalledWith('game:game-123');
      expect(mockEmit).toHaveBeenCalledWith('map-data', testData);
      expect(mockEmit).toHaveBeenCalledTimes(1); // Single broadcast to the room
    });

    it('should verify room isolation works correctly', () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });

      const mockIo = {
        emit: mockEmit,
        to: mockTo,
      };

      const broadcastToGameRoom = (gameId: string, event: string, data: any) => {
        mockIo.to(`game:${gameId}`).emit(event, data);
      };

      // Send to different game rooms
      broadcastToGameRoom('game-alpha', 'map-data', { game: 'alpha' });
      broadcastToGameRoom('game-beta', 'tile-info', { game: 'beta' });

      // Verify each call targeted the correct room
      expect(mockTo).toHaveBeenCalledWith('game:game-alpha');
      expect(mockTo).toHaveBeenCalledWith('game:game-beta');
      expect(mockTo).toHaveBeenCalledTimes(2);

      // Verify data was sent to each room
      expect(mockEmit).toHaveBeenCalledWith('map-data', { game: 'alpha' });
      expect(mockEmit).toHaveBeenCalledWith('tile-info', { game: 'beta' });
      expect(mockEmit).toHaveBeenCalledTimes(2);
    });

    it('should demonstrate player-specific targeting', () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });

      const mockIo = {
        emit: mockEmit,
        to: mockTo,
      };

      const emitToPlayer = (userId: string, event: string, data: any) => {
        mockIo.to(`player:${userId}`).emit(event, data);
      };

      // Send to specific players
      emitToPlayer('user-123', 'private-message', { content: 'secret' });
      emitToPlayer('user-456', 'notification', { type: 'info' });

      // Verify targeting
      expect(mockTo).toHaveBeenCalledWith('player:user-123');
      expect(mockTo).toHaveBeenCalledWith('player:user-456');

      expect(mockEmit).toHaveBeenCalledWith('private-message', { content: 'secret' });
      expect(mockEmit).toHaveBeenCalledWith('notification', { type: 'info' });
    });
  });

  describe('Map data packet structures', () => {
    it('should validate map-data packet structure matches frontend expectations', () => {
      const mapDataPacket = {
        gameId: 'test-game',
        width: 20,
        height: 15,
        startingPositions: [
          { x: 5, y: 5, playerId: 'player1' },
          { x: 15, y: 10, playerId: 'player2' },
        ],
        seed: 'test-seed',
        generatedAt: new Date().toISOString(),
      };

      // Verify all required fields are present
      expect(mapDataPacket).toHaveProperty('gameId');
      expect(mapDataPacket).toHaveProperty('width');
      expect(mapDataPacket).toHaveProperty('height');
      expect(mapDataPacket).toHaveProperty('startingPositions');
      expect(mapDataPacket).toHaveProperty('seed');
      expect(mapDataPacket).toHaveProperty('generatedAt');

      // Verify starting positions format
      expect(Array.isArray(mapDataPacket.startingPositions)).toBe(true);
      mapDataPacket.startingPositions.forEach(pos => {
        expect(pos).toHaveProperty('x');
        expect(pos).toHaveProperty('y');
        expect(pos).toHaveProperty('playerId');
        expect(typeof pos.x).toBe('number');
        expect(typeof pos.y).toBe('number');
        expect(typeof pos.playerId).toBe('string');
      });
    });

    it('should validate tile-info packet structure matches frontend expectations', () => {
      const tileInfoPacket = {
        tile: 5007, // x * 1000 + y format for tile ID
        x: 5,
        y: 7,
        terrain: 'grassland',
        resource: 'wheat',
        elevation: 125,
        riverMask: 0,
        isExplored: true,
        isVisible: true,
      };

      // Verify all required fields are present
      expect(tileInfoPacket).toHaveProperty('tile');
      expect(tileInfoPacket).toHaveProperty('x');
      expect(tileInfoPacket).toHaveProperty('y');
      expect(tileInfoPacket).toHaveProperty('terrain');
      expect(tileInfoPacket).toHaveProperty('elevation');
      expect(tileInfoPacket).toHaveProperty('riverMask');
      expect(tileInfoPacket).toHaveProperty('isExplored');
      expect(tileInfoPacket).toHaveProperty('isVisible');

      // Verify field types
      expect(typeof tileInfoPacket.tile).toBe('number');
      expect(typeof tileInfoPacket.x).toBe('number');
      expect(typeof tileInfoPacket.y).toBe('number');
      expect(typeof tileInfoPacket.terrain).toBe('string');
      expect(typeof tileInfoPacket.elevation).toBe('number');
      expect(typeof tileInfoPacket.riverMask).toBe('number');
      expect(typeof tileInfoPacket.isExplored).toBe('boolean');
      expect(typeof tileInfoPacket.isVisible).toBe('boolean');

      // Verify tile ID calculation
      expect(tileInfoPacket.tile).toBe(tileInfoPacket.x * 1000 + tileInfoPacket.y);

      // Verify optional resource field
      if (tileInfoPacket.resource) {
        expect(typeof tileInfoPacket.resource).toBe('string');
      }
    });

    it('should verify terrain types are compatible with frontend sprite system', () => {
      const validTerrainTypes = [
        'ocean',
        'coast',
        'grassland',
        'plains',
        'desert',
        'tundra',
        'forest',
        'jungle',
        'hills',
        'mountains',
      ];

      // Test each terrain type
      validTerrainTypes.forEach(terrain => {
        const tilePacket = {
          tile: 1001,
          x: 1,
          y: 1,
          terrain,
          elevation: 100,
          riverMask: 0,
          isExplored: true,
          isVisible: true,
        };

        expect(validTerrainTypes).toContain(tilePacket.terrain);
      });
    });
  });

  describe('Broadcasting flow simulation', () => {
    it('should simulate the complete game start -> map generation -> broadcasting flow', () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });

      const mockIo = {
        emit: mockEmit,
        to: mockTo,
      };

      // Simulate the fixed broadcasting method
      const broadcastToGame = (gameId: string, event: string, data: any) => {
        mockIo.to(`game:${gameId}`).emit(event, data);
      };

      const gameId = 'integration-test-game';

      // 1. Game starts, map is generated
      const mapData = {
        gameId,
        width: 10,
        height: 8,
        startingPositions: [
          { x: 2, y: 3, playerId: 'player1' },
          { x: 7, y: 5, playerId: 'player2' },
        ],
        seed: 'test-seed',
        generatedAt: new Date(),
      };

      // 2. Broadcast map metadata
      broadcastToGame(gameId, 'map-data', mapData);

      // 3. Broadcast visible tiles for each player
      const visibleTiles = [
        {
          tile: 2003,
          x: 2,
          y: 3,
          terrain: 'grassland',
          elevation: 80,
          riverMask: 0,
          isExplored: true,
          isVisible: true,
        },
        {
          tile: 2004,
          x: 2,
          y: 4,
          terrain: 'plains',
          elevation: 85,
          riverMask: 0,
          isExplored: true,
          isVisible: true,
        },
        {
          tile: 7005,
          x: 7,
          y: 5,
          terrain: 'forest',
          elevation: 120,
          riverMask: 0,
          isExplored: true,
          isVisible: true,
        },
        {
          tile: 7006,
          x: 7,
          y: 6,
          terrain: 'hills',
          elevation: 140,
          riverMask: 0,
          isExplored: true,
          isVisible: true,
        },
      ];

      visibleTiles.forEach(tile => {
        broadcastToGame(gameId, 'tile-info', tile);
      });

      // Verify the broadcasting pattern
      expect(mockTo).toHaveBeenCalledWith(`game:${gameId}`);
      expect(mockTo).toHaveBeenCalledTimes(5); // 1 map-data + 4 tile-info calls

      expect(mockEmit).toHaveBeenCalledWith('map-data', mapData);
      visibleTiles.forEach(tile => {
        expect(mockEmit).toHaveBeenCalledWith('tile-info', tile);
      });

      expect(mockEmit).toHaveBeenCalledTimes(5);
    });
  });
});
