# HTTP Multiplayer Migration Plan

**Branch:** `feature/http-multiplayer`  
**Goal:** Replace Socket.IO with HTTP REST API for Vercel compatibility while maintaining excellent multiplayer experience

## Why HTTP for Turn-Based Multiplayer?

- ✅ **Perfect for Civilization-style games** - Players take 1-5 minute turns
- ✅ **Works on Vercel serverless** - No WebSocket limitations
- ✅ **Simpler deployment** - Standard HTTP requests
- ✅ **Better error handling** - HTTP status codes
- ✅ **5-second polling feels instant** for turn-based gameplay
- ✅ **Free Vercel hosting** - No Railway costs for hobby projects

## Impact Assessment

### Single Player
- **Zero impact** - Runs 100% locally in browser
- **No networking needed** - Same UI, same gameplay

### Multiplayer  
- **Small migration effort** - 2-3 hours total work
- **Same game mechanics** - All game logic stays identical
- **Better platform compatibility** - Works everywhere

## Implementation Plan

### Phase 1: API Design 🎯

#### Game Management
```
POST   /api/games              - Create new game
GET    /api/games              - List available games  
POST   /api/games/:id/join     - Join existing game
GET    /api/games/:id          - Get game state & whose turn
DELETE /api/games/:id/leave    - Leave game
```

**Create Game Request:**
```json
{
  "name": "My Game",
  "maxPlayers": 4,
  "mapSettings": {
    "width": 80,
    "height": 50,
    "seed": 12345
  }
}
```

**Game State Response:**
```json
{
  "id": "game_123",
  "name": "My Game", 
  "status": "waiting|playing|finished",
  "currentPlayer": "player_456",
  "currentTurn": 15,
  "players": [
    {"id": "player_123", "name": "Alice", "ready": true},
    {"id": "player_456", "name": "Bob", "ready": false}
  ],
  "isMyTurn": true,
  "lastUpdated": "2025-01-28T21:30:00Z"
}
```

#### Game Actions (when it's your turn)
```
POST   /api/games/:id/actions/move        - Move unit
POST   /api/games/:id/actions/found-city  - Found city  
POST   /api/games/:id/actions/research    - Set research
POST   /api/games/:id/actions/end-turn    - End your turn
POST   /api/games/:id/actions/attack      - Attack with unit
```

**Move Unit Request:**
```json
{
  "unitId": "unit_123",
  "toX": 10,
  "toY": 15,
  "playerId": "player_456"
}
```

**Action Response:**
```json
{
  "success": true,
  "gameState": { /* updated game state */ },
  "events": [
    {"type": "unit_moved", "unitId": "unit_123", "x": 10, "y": 15},
    {"type": "turn_ended", "nextPlayer": "player_789"}
  ]
}
```

#### Game Data
```
GET    /api/games/:id/map         - Get map data
GET    /api/games/:id/tiles       - Get visible tiles  
GET    /api/games/:id/units       - Get your units
GET    /api/games/:id/cities      - Get your cities
GET    /api/games/:id/research    - Get research status
```

### Phase 2: Server Implementation 🔧

#### Strategy: Reuse Existing Logic
- Convert Socket.IO handlers in `/src/network/socket-handlers.ts` to Express routes
- Keep all game logic in GameManager, CityManager, etc. unchanged
- Add route handlers in `/src/routes/` that call existing managers

#### Example Conversion:
```javascript
// Before (Socket.IO)
socket.on('move_unit', async (data) => {
  const result = await gameManager.moveUnit(data);
  socket.emit('unit_moved', result);
});

// After (HTTP)
router.post('/games/:id/actions/move', async (req, res) => {
  const result = await gameManager.moveUnit(req.body);
  res.json({ success: true, ...result });
});
```

#### New Files to Create:
- `/src/routes/games.ts` - Game CRUD operations
- `/src/routes/actions.ts` - Game actions (move, attack, etc.)
- `/src/routes/data.ts` - Game data endpoints (map, units, etc.)
- `/src/middleware/auth.ts` - Player authentication
- `/src/middleware/gameAccess.ts` - Verify player can access game

### Phase 3: Client Implementation 💻

#### New HTTP GameClient
Replace `/src/services/GameClient.ts` Socket.IO implementation:

```typescript
class HttpGameClient {
  private baseUrl: string;
  private gameId: string | null = null;
  private playerId: string | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;

  // Replace socket.emit() calls
  async createGame(settings: GameSettings): Promise<Game> {
    const response = await fetch(`${this.baseUrl}/api/games`, {
      method: 'POST',
      body: JSON.stringify(settings),
      headers: { 'Content-Type': 'application/json' }
    });
    return response.json();
  }

  async moveUnit(unitId: string, x: number, y: number): Promise<ActionResult> {
    const response = await fetch(`${this.baseUrl}/api/games/${this.gameId}/actions/move`, {
      method: 'POST',
      body: JSON.stringify({ unitId, toX: x, toY: y, playerId: this.playerId })
    });
    return response.json();
  }

  // Replace socket.on() with polling
  startPolling(): void {
    this.pollingInterval = setInterval(async () => {
      if (this.gameId) {
        const gameState = await this.getGameState();
        this.handleGameStateUpdate(gameState);
      }
    }, 5000); // Poll every 5 seconds
  }
}
```

#### Polling Strategy
- **Poll every 5 seconds** when game is active
- **Poll every 30 seconds** in lobby/waiting
- **Stop polling** when it's your turn (resume after action)
- **Exponential backoff** on errors

#### State Management
- Keep same Zustand store interface
- Update store from polling responses instead of Socket.IO events
- Maintain same React component APIs

### Phase 4: Testing ✅

#### Single Player Testing
- [x] Game creation without networking
- [x] Unit movement, city founding, research
- [x] Turn progression, AI opponents
- [x] Save/load functionality

#### Multiplayer HTTP Testing
- [ ] Create game via HTTP
- [ ] Join game via HTTP  
- [ ] Turn-based gameplay
- [ ] Real-time turn notifications (via polling)
- [ ] Game state synchronization
- [ ] Error handling & reconnection

#### Load Testing
- [ ] Multiple concurrent games
- [ ] Polling frequency optimization
- [ ] Server response times

## Migration Steps

### Step 1: Server Routes (1 hour)
1. Create `/src/routes/games.ts` with basic CRUD
2. Add routes to serverless.ts
3. Test with Postman/curl

### Step 2: Client HTTP Layer (1 hour)  
1. Create new `HttpGameClient.ts`
2. Implement create/join game methods
3. Add basic polling loop

### Step 3: Integration (30 minutes)
1. Wire up new client to React components
2. Test single player (should work unchanged)
3. Test multiplayer create/join flow

### Step 4: Polish (30 minutes)
1. Error handling & loading states
2. Optimize polling frequency
3. Add reconnection logic

## Rollback Plan

If issues arise:
- **Keep Socket.IO code** alongside HTTP (feature flag)
- **Railway deployment** still works with Socket.IO
- **Easy branch switch** back to main

## Success Criteria

- ✅ **Single player unchanged** - Zero impact on gameplay
- ✅ **Multiplayer works** - Create/join/play games via HTTP
- ✅ **Fast turn notifications** - <10 second delay feels instant for turn-based
- ✅ **Vercel compatible** - Full deployment on free tier
- ✅ **Same user experience** - Players don't notice the difference

---

**Next Steps:**
1. Start with Phase 1 API design
2. Create server routes reusing existing game logic  
3. Build HTTP client with polling
4. Test end-to-end multiplayer flow