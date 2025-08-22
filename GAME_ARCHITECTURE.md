# Game Architecture - Database vs In-Memory

## Current Hybrid Approach

After refactoring to fix the game listing issue, we now have a **hybrid architecture**:

### ✅ Database-First Operations
- **Game Creation**: `createGame()` - Persists to PostgreSQL 
- **Game Joining**: `joinGame()` - Database queries and player creation
- **Game Listing**: `getGameListForLobby()` - Fetches from database
- **Game Starting**: `startGame()` - Updates database status

### 🔄 Complex Game Mechanics (Still In-Memory)
- **Unit Management**: UnitManager, movement, combat
- **City Management**: CityManager, production, growth  
- **Research**: ResearchManager, technology trees
- **Visibility**: VisibilityManager, fog of war
- **Turn Management**: TurnManager, turn processing

## Benefits of Current Approach

1. **Fixed Frontend Issue**: Game lobby now shows all games from database
2. **Persistence**: Games survive server restarts  
3. **Gradual Migration**: Complex mechanics can be refactored incrementally
4. **Stability**: Existing game features continue to work

## Future Refactoring Plan

### Phase 1: Basic CRUD (✅ Complete)
- Game creation, joining, listing
- Database persistence for game metadata

### Phase 2: Game State Persistence 
- Move unit positions to database
- Move city data to database  
- Move research progress to database

### Phase 3: Eliminate In-Memory Managers
- Replace UnitManager with database queries
- Replace CityManager with database queries
- Replace ResearchManager with database queries

## Database Schema

```sql
-- Core tables now properly used:
games (✅ Used for listing/creation)
players (✅ Used for joining games)  
users (✅ Used for host lookup)

-- Future tables to implement:
units (positions, stats, ownership)
cities (positions, population, production)
research (player tech progress)
```

## Technical Debt

- Complex managers still create in-memory game instances
- Some methods still reference removed `this.games` Map
- Game mechanics not yet persistent across restarts

## Immediate Benefits

- ✅ Frontend shows all available games
- ✅ Real host names from database
- ✅ Accurate player counts  
- ✅ Games persist across server restarts
- ✅ No more "empty lobby" issue