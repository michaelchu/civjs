# Turn Resolution API Documentation

## Endpoint Overview

The Turn Resolution API enables synchronous processing of all player actions in a single batch request with real-time progress updates via Server-Sent Events.

**Base URL**: `/api/games/{gameId}/turns/resolve`  
**Method**: `POST`  
**Content-Type**: `application/json`  
**Response**: `text/event-stream` (Server-Sent Events)

## Authentication

Requires valid session authentication via `x-session-id` header:

```http
POST /api/games/abc123/turns/resolve
Content-Type: application/json
x-session-id: def456
```

## Request Schema

### TurnResolveRequest

```typescript
interface TurnResolveRequest {
  turnVersion: number;           // Current turn number for optimistic locking
  playerActions: PlayerAction[]; // Array of queued player actions
  idempotencyKey: string;       // Unique identifier for request deduplication
}
```

### PlayerAction

```typescript
interface PlayerAction {
  type: ActionType;      // Type of action to perform
  data: ActionData;      // Action-specific payload
  timestamp?: string;    // ISO string of when action was queued (optional)
}

type ActionType = 
  | 'unit_move'
  | 'unit_attack' 
  | 'found_city'
  | 'research_selection'
  | 'end_turn';
```

### Action Data Schemas

#### Unit Movement
```typescript
interface UnitMoveData {
  unitId: string;    // ID of unit to move
  toX: number;       // Target X coordinate
  toY: number;       // Target Y coordinate
}
```

#### Unit Attack
```typescript
interface UnitAttackData {
  attackerUnitId: string;  // ID of attacking unit
  defenderUnitId: string;  // ID of defending unit
}
```

#### City Founding
```typescript
interface FoundCityData {
  name: string;      // Name for the new city
  x: number;         // X coordinate for city location
  y: number;         // Y coordinate for city location
}
```

#### Research Selection
```typescript
interface ResearchSelectionData {
  techId: string;    // ID of technology to research
}
```

#### Turn End
```typescript
interface EndTurnData {
  // No additional data required
}
```

## Request Example

```http
POST /api/games/game123/turns/resolve
Content-Type: application/json
x-session-id: session456

{
  "turnVersion": 42,
  "playerActions": [
    {
      "type": "unit_move",
      "data": {
        "unitId": "unit789",
        "toX": 15,
        "toY": 23
      },
      "timestamp": "2023-12-01T10:30:00Z"
    },
    {
      "type": "unit_attack", 
      "data": {
        "attackerUnitId": "unit789",
        "defenderUnitId": "unit101"
      },
      "timestamp": "2023-12-01T10:30:05Z"
    },
    {
      "type": "research_selection",
      "data": {
        "techId": "tech_bronze_working"
      },
      "timestamp": "2023-12-01T10:30:10Z"
    }
  ],
  "idempotencyKey": "game123_42_1701426600000"
}
```

## Response Format (Server-Sent Events)

The server responds with a stream of Server-Sent Events. Each event has a `type` and `data` field.

### Event Types

#### `init` - Initialization
Sent immediately to establish the connection and confirm turn processing has started.

```
event: init
data: {
  "message": "Turn resolution started",
  "turnVersion": 42,
  "timestamp": "2023-12-01T10:30:15Z"
}
```

#### `progress` - Progress Updates
Sent throughout turn processing to provide real-time status updates.

```
event: progress
data: {
  "stage": "processing_actions",
  "message": "Processing action 2/3: unit_attack",
  "progress": 0.25,
  "actionType": "unit_attack"
}
```

**Progress Stages:**
- `processing_actions` (0.0 - 0.3): Player action execution
- `ai_processing` (0.3 - 0.6): AI player move computation  
- `world_update` (0.7 - 0.9): World state updates and turn advancement
- `complete` (1.0): Final processing complete

#### `complete` - Successful Completion
Sent when turn resolution completes successfully.

```
event: complete
data: {
  "success": true,
  "newTurnVersion": 43,
  "turnResolutionTime": 2150,
  "actionResults": [
    {
      "action": { "type": "unit_move", ... },
      "result": { "success": true, "newX": 15, "newY": 23 },
      "success": true
    },
    {
      "action": { "type": "unit_attack", ... },
      "result": { "success": true, "damageDealt": 25, "damageReceived": 10 },
      "success": true
    }
  ],
  "fullState": { /* complete game state */ },
  "message": "Turn resolution complete",
  "progress": 1.0
}
```

#### `error` - Error Conditions
Sent when turn resolution fails.

```
event: error
data: {
  "error": "Turn version mismatch",
  "code": "STALE_TURN_VERSION", 
  "expected": 43,
  "received": 42
}
```

## Query Parameters

### `full`
Request full game state instead of incremental patch.

```http
POST /api/games/game123/turns/resolve?full=1
```

**Default**: Returns optimized patch diff  
**With `full=1`**: Returns complete game state

## Error Codes

### `STALE_TURN_VERSION`
The provided `turnVersion` doesn't match the current game turn.

```json
{
  "error": "Turn version mismatch",
  "code": "STALE_TURN_VERSION",
  "expected": 43,
  "received": 42
}
```

**Resolution**: Client should refetch game state and retry with correct version.

### `GAME_NOT_FOUND`
The specified game ID doesn't exist or is not accessible.

```json
{
  "error": "Game not found", 
  "code": "GAME_NOT_FOUND"
}
```

### `INVALID_ACTION`
One or more player actions are invalid.

```json
{
  "error": "Unit not found",
  "code": "INVALID_ACTION",
  "actionType": "unit_move",
  "details": "Unit unit789 does not exist"
}
```

### `TURN_RESOLUTION_FAILED`
General turn processing failure.

```json
{
  "error": "Database connection timeout",
  "code": "TURN_RESOLUTION_FAILED"
}
```

### `DUPLICATE_REQUEST`
Request with same `idempotencyKey` already processed.

```json
{
  "error": "Request already processed",
  "code": "DUPLICATE_REQUEST",
  "originalResult": { /* previous result */ }
}
```

## Response Schema

### TurnResolveSuccess

```typescript
interface TurnResolveSuccess {
  success: true;
  newTurnVersion: number;
  turnResolutionTime: number;        // Processing time in milliseconds
  actionResults: ActionResult[];
  fullState?: GameState;             // Present when ?full=1
  patch?: GameStatePatch;           // Present by default
  message: string;
  progress: 1.0;
}
```

### ActionResult

```typescript
interface ActionResult {
  action: PlayerAction;              // Original action
  result: ActionResultData;          // Action-specific result
  success: boolean;
  error?: string;                    // Present if success=false
}
```

### GameStatePatch

```typescript
interface GameStatePatch {
  type: 'full_replace' | 'incremental';
  turnVersion: number;
  changes: Partial<GameState>;       // Changed fields only
}
```

## Client Implementation

### Basic Usage

```typescript
async function resolveTurn(actions: PlayerAction[]): Promise<TurnResult> {
  const response = await fetch('/api/games/123/turns/resolve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'x-session-id': sessionId,
    },
    body: JSON.stringify({
      turnVersion: currentTurn,
      playerActions: actions,
      idempotencyKey: generateIdempotencyKey(),
    }),
  });

  const reader = response.body.getReader();
  return processEventStream(reader);
}
```

### Progress Handling

```typescript
function handleProgressEvent(eventData: ProgressEvent): void {
  const progressBar = document.getElementById('progress');
  progressBar.style.width = `${eventData.progress * 100}%`;
  
  const statusText = document.getElementById('status');
  statusText.textContent = eventData.message;
  
  if (eventData.error) {
    showError(eventData.error);
  }
}
```

### Error Handling

```typescript
function handleErrorEvent(eventData: ErrorEvent): void {
  switch (eventData.code) {
    case 'STALE_TURN_VERSION':
      // Refresh game state and retry
      await refreshGameState();
      return retryTurnResolution();
      
    case 'GAME_NOT_FOUND':
      // Navigate back to game selection
      return redirectToLobby();
      
    case 'TURN_RESOLUTION_FAILED':
      // Show user-friendly error message
      return showRetryDialog(eventData.error);
      
    default:
      return showGenericError();
  }
}
```

## Rate Limiting

- **Per User**: 10 turn resolutions per minute
- **Per Game**: 1 concurrent resolution per game
- **Global**: 1000 concurrent resolutions across all games

Rate limit headers:
```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 1701426660
```

## Performance Characteristics

### Typical Response Times

| Scenario | Expected Time | P95 Time |
|----------|--------------|----------|
| Simple turn (1-2 actions) | 500-1000ms | 2s |
| Complex turn (5+ actions) | 1-3s | 5s |
| Large game (6+ AI players) | 3-8s | 15s |

### Resource Limits

- **Maximum Actions**: 50 per turn
- **Processing Timeout**: 300 seconds
- **Response Size**: 10MB max
- **Connection Timeout**: 330 seconds

## Testing

### Mock Server Response

```typescript
// Test SSE event stream
const mockEvents = [
  { event: 'init', data: { message: 'Started', turnVersion: 1 } },
  { event: 'progress', data: { stage: 'processing_actions', progress: 0.2 } },
  { event: 'complete', data: { success: true, newTurnVersion: 2 } }
];
```

### Integration Test Example

```typescript
describe('Turn Resolution API', () => {
  it('should process turn with multiple actions', async () => {
    const actions = [
      { type: 'unit_move', data: { unitId: '1', toX: 5, toY: 5 } },
      { type: 'end_turn', data: {} }
    ];
    
    const result = await resolveTurn(actions);
    
    expect(result.success).toBe(true);
    expect(result.newTurnVersion).toBe(currentTurn + 1);
    expect(result.actionResults).toHaveLength(2);
  });
});
```

---

This API provides efficient, reliable turn processing with excellent user experience through real-time progress updates and comprehensive error handling.