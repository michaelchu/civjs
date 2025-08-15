# API Testing Guide

## Test the CivJS API

Once the server is running (`npm run dev`), you can test the API endpoints:

### 1. Test Health Check
```bash
curl http://localhost:3001/health
```

### 2. Get Available Games
```bash
curl http://localhost:3001/api/games
```

### 3. Create a New Game
```bash
curl -X POST http://localhost:3001/api/games \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Game",
    "settings": {
      "mapSize": "small",
      "turnTimer": 300,
      "allowSpectators": false
    }
  }'
```

### 4. Join a Game (replace GAME_ID with actual ID from step 3)
```bash
curl -X POST http://localhost:3001/api/games/GAME_ID/join \
  -H "Content-Type: application/json" \
  -d '{
    "civilization": "Romans"
  }'
```

### 5. Start a Game (replace GAME_ID)
```bash
curl -X POST http://localhost:3001/api/games/GAME_ID/start
```

### 6. Get Game State (replace GAME_ID)
```bash
curl http://localhost:3001/api/games/GAME_ID/state
```

## Expected Results

- Health check should return `{"status":"OK","timestamp":"..."}` 
- Empty games list initially: `{"games":[]}`
- Game creation should return the new game object with an ID
- Joining should work until the game reaches max players
- Starting should generate the map and units
- Game state should show map tiles, units, cities, and player data

## Quick Test with PowerShell

```powershell
# Test health
Invoke-RestMethod -Uri "http://localhost:3001/health"

# Get games
Invoke-RestMethod -Uri "http://localhost:3001/api/games"

# Create game
$gameData = @{
    name = "Test Game"
    settings = @{
        mapSize = "small"
        turnTimer = 300
        allowSpectators = $false
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3001/api/games" -Method Post -Body $gameData -ContentType "application/json"
```
