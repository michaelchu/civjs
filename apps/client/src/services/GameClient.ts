/* eslint-disable @typescript-eslint/no-explicit-any */
import { SERVER_URL } from '../config';
import { useGameStore } from '../store/gameStore';
import { storeGameSession, clearGameSession } from '../utils/gameSession';

interface GameState {
  id: string;
  name: string;
  status: string;
  currentPlayer: string | null;
  currentPlayerNumber: number;
  currentTurn: number;
  maxPlayers: number;
  players: Array<{
    id: string;
    userId: string;
    playerNumber: number;
    civilization: string;
    isReady: boolean;
    hasEndedTurn: boolean;
    isConnected: boolean;
  }>;
  isMyTurn: boolean;
  isHost: boolean;
  canObserve: boolean;
  lastUpdated: string;
  year: number;
}

interface ActionResult {
  success: boolean;
  error?: string;
  message?: string;
  [key: string]: any;
}

class GameClient {
  private baseUrl: string;
  private sessionId: string | null = null;
  private currentGameId: string | null = null;
  private lastGameState: GameState | null = null;
  private pendingActions: Array<{ type: string; data: any; timestamp: string }> = [];
  private currentTurnVersion: number = 0;

  constructor() {
    this.baseUrl = SERVER_URL;
    console.log('HTTP Game Client initialized with server:', this.baseUrl);
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: any = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.sessionId) {
      headers['x-session-id'] = this.sessionId;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error(`HTTP request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  async connect(): Promise<void> {
    // HTTP client doesn't need to "connect" like Socket.IO
    // But we can use this to test the server connection
    try {
      await this.makeRequest('/health');
      console.log('Connected to HTTP server');
      useGameStore.getState().setClientState('connecting');
    } catch (error) {
      console.error('Failed to connect to HTTP server:', error);
      throw error;
    }
  }

  async authenticatePlayer(playerName: string): Promise<void> {
    try {
      const response = await this.makeRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: playerName }),
      });

      if (response.success) {
        this.sessionId = response.sessionId;
        console.log(`Authenticated as ${playerName} with session ${this.sessionId}`);
      } else {
        throw new Error(response.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  }

  async createGame(gameData: {
    gameName: string;
    playerName: string;
    gameType: 'single' | 'multiplayer';
    maxPlayers: number;
    mapSize: string;
    terrainSettings?: {
      generator: string;
      landmass: string;
      huts: number;
      temperature: number;
      wetness: number;
      rivers: number;
      resources: string;
    };
  }): Promise<string> {
    // First authenticate
    await this.authenticatePlayer(gameData.playerName);

    const mapSizes: Record<string, { width: number; height: number }> = {
      small: { width: 40, height: 25 },
      standard: { width: 80, height: 50 },
      large: { width: 120, height: 75 },
    };

    const dimensions = mapSizes[gameData.mapSize] || mapSizes.standard;

    const response = await this.makeRequest('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        name: gameData.gameName,
        gameType: gameData.gameType,
        maxPlayers: gameData.maxPlayers,
        mapWidth: dimensions.width,
        mapHeight: dimensions.height,
        terrainSettings: gameData.terrainSettings || {
          generator: 'random',
          landmass: 'normal',
          huts: 15,
          temperature: 50,
          wetness: 50,
          rivers: 50,
          resources: 'normal',
        },
      }),
    });

    if (response.success) {
      this.currentGameId = response.gameId;
      console.log('Game created:', response.gameId);

      // Store game session data for persistence across refreshes
      storeGameSession({
        playerName: gameData.playerName,
        gameId: response.gameId,
        gameType: gameData.gameType,
      });

      // Fetch initial game data directly
      await this.fetchGameData();

      if (gameData.gameType === 'single') {
        useGameStore.getState().setClientState('running');
      } else {
        useGameStore.getState().setClientState('waiting_for_players');
      }

      return response.gameId;
    } else {
      throw new Error(response.error || 'Failed to create game');
    }
  }

  async joinSpecificGame(gameId: string, playerName: string): Promise<void> {
    // First authenticate
    await this.authenticatePlayer(playerName);

    // Get game info to determine game type
    const gameInfoResponse = await this.makeRequest(`/api/games/${gameId}`);
    const gameType = gameInfoResponse.success
      ? gameInfoResponse.game?.gameType || 'multiplayer'
      : 'multiplayer';

    const response = await this.makeRequest(`/api/games/${gameId}/join`, {
      method: 'POST',
      body: JSON.stringify({ civilization: 'random' }),
    });

    if (response.success) {
      this.currentGameId = gameId;
      console.log(`Joined game ${gameId}`);

      // Store game session data for persistence across refreshes
      storeGameSession({
        playerName,
        gameId,
        gameType: gameType as 'single' | 'multiplayer',
      });

      // Fetch game data directly after joining
      await this.fetchGameData();
    } else {
      throw new Error(response.error || 'Failed to join game');
    }
  }

  async observeGame(gameId: string): Promise<void> {
    const response = await this.makeRequest(`/api/games/${gameId}/observe`, {
      method: 'POST',
    });

    if (response.success) {
      this.currentGameId = gameId;
      console.log(`Observing game ${gameId}`);
      // Fetch game data directly after observing
      await this.fetchGameData();
    } else {
      throw new Error(response.error || 'Failed to observe game');
    }
  }

  async getGameList(): Promise<any[]> {
    const response = await this.makeRequest('/api/games');
    return response.success ? response.games : [];
  }

  public async fetchGameData(): Promise<void> {
    if (!this.currentGameId) {
      return;
    }

    try {
      // Fetch game state
      const gameResponse = await this.makeRequest(`/api/games/${this.currentGameId}`);

      if (gameResponse.success) {
        const gameState = gameResponse.game as GameState;
        this.handleGameStateUpdate(gameState);
        this.lastGameState = gameState;
      }

      // Fetch map data
      await this.refreshGameData();
    } catch (error) {
      console.error('Error fetching game data:', error);
    }
  }

  private handleGameStateUpdate(gameState: GameState): void {
    const store = useGameStore.getState();

    // Map players data from server response to client format
    const playersMap: Record<string, any> = {};
    if (gameState.players && Array.isArray(gameState.players)) {
      gameState.players.forEach(player => {
        playersMap[player.id] = {
          id: player.id,
          name: player.civilization || `Player ${player.playerNumber}`,
          nation: player.civilization,
          color: '#0066cc', // Default color, should come from server
          gold: 0, // Should come from server
          science: 0, // Should come from server
          isHuman: true, // Assume human for now
          isActive: player.id === gameState.currentPlayer,
          phase_done: player.hasEndedTurn,
        };
      });
    }

    // Update basic game state and current turn version
    this.currentTurnVersion = gameState.currentTurn;
    store.updateGameState({
      turn: gameState.currentTurn,
      currentPlayerId: gameState.currentPlayer || undefined,
      players: playersMap,
    });

    // Check for state changes
    if (this.lastGameState) {
      // Turn changed
      if (this.lastGameState.currentTurn !== gameState.currentTurn) {
        console.log('Turn advanced to:', gameState.currentTurn);
        // Fetch updated game data
        this.refreshGameData();
      }

      // My turn started/ended
      if (this.lastGameState.isMyTurn !== gameState.isMyTurn) {
        if (gameState.isMyTurn) {
          console.log('Your turn started!');
          store.setClientState('running');
        } else {
          console.log('Your turn ended');
        }
      }

      // Game status changed
      if (this.lastGameState.status !== gameState.status) {
        console.log('Game status changed to:', gameState.status);
        if (gameState.status === 'playing') {
          store.setClientState('running');
        } else if (gameState.status === 'waiting') {
          store.setClientState('waiting_for_players');
        }
      }
    }

    // Update client state based on game status
    if (gameState.status === 'playing' && !gameState.isMyTurn) {
      store.setClientState('running'); // Keep as 'running' even when waiting for turn
    }
  }

  private async refreshGameData(): Promise<void> {
    if (!this.currentGameId) return;

    try {
      // Fetch map data
      const mapResponse = await this.makeRequest(`/api/games/${this.currentGameId}/map`);
      if (mapResponse.success) {
        this.handleMapData(mapResponse.mapData);
      }

      // Fetch units
      const unitsResponse = await this.makeRequest(`/api/games/${this.currentGameId}/units`);
      if (unitsResponse.success) {
        this.handleUnitsData(unitsResponse.units);
      }

      // Fetch cities
      const citiesResponse = await this.makeRequest(`/api/games/${this.currentGameId}/cities`);
      if (citiesResponse.success) {
        this.handleCitiesData(citiesResponse.cities);
      }
    } catch (error) {
      console.error('Error refreshing game data:', error);
    }
  }

  private handleMapData(mapData: any): void {
    // Store in global map variable exactly like freeciv-web
    (window as any).map = {
      xsize: mapData.width,
      ysize: mapData.height,
      topology: mapData.topology || 0,
      wrap_id: mapData.wrap_id || 0,
    };

    const totalTiles = mapData.width * mapData.height;
    (window as any).tiles = new Array(totalTiles);

    // Process tiles
    const updatedTiles: any = {};

    if (mapData.tiles) {
      Object.keys(mapData.tiles).forEach(tileKey => {
        const tile = mapData.tiles[tileKey];
        if (tile && (tile.isVisible || tile.isExplored)) {
          const index = tile.y * mapData.width + tile.x;
          (window as any).tiles[index] = {
            index,
            x: tile.x,
            y: tile.y,
            terrain: tile.terrain,
            known: tile.isExplored ? 1 : 0,
            seen: tile.isVisible ? 1 : 0,
            resource: tile.resource,
            riverMask: tile.riverMask || 0, // Add riverMask for river rendering
            river_mask: tile.riverMask || 0, // Legacy compatibility field
          };

          updatedTiles[tileKey] = {
            x: tile.x,
            y: tile.y,
            terrain: tile.terrain,
            visible: tile.isVisible,
            known: tile.isExplored,
            units: [],
            city: undefined,
            resource: tile.resource,
            riverMask: tile.riverMask || 0, // Add riverMask for river rendering
          };
        }
      });
    }

    useGameStore.getState().updateGameState({
      map: {
        width: mapData.width,
        height: mapData.height,
        tiles: updatedTiles,
        xsize: mapData.width,
        ysize: mapData.height,
        wrap_id: mapData.wrap_id || 0,
      },
    });
  }

  private handleUnitsData(units: any[]): void {
    const unitsMap: any = {};

    units.forEach(unit => {
      unitsMap[unit.id] = unit;
    });

    useGameStore.getState().updateGameState({
      units: unitsMap,
    });
  }

  private handleCitiesData(cities: any[]): void {
    const citiesMap: any = {};

    cities.forEach(city => {
      citiesMap[city.id] = city;
    });

    useGameStore.getState().updateGameState({
      cities: citiesMap,
    });
  }

  // Helper method to queue actions for batch processing
  private queueAction(type: string, data: any): void {
    this.pendingActions.push({
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  // Clear pending actions (used after turn resolution)
  private clearPendingActions(): void {
    this.pendingActions = [];
  }

  // Game Actions - now queue actions instead of immediate HTTP calls
  async moveUnit(
    unitId: string,
    _fromX: number,
    _fromY: number,
    toX: number,
    toY: number
  ): Promise<ActionResult> {
    this.queueAction('unit_move', { unitId, toX, toY });
    return { success: true, message: 'Move queued for next turn resolution' };
  }

  async foundCity(name: string, x: number, y: number): Promise<ActionResult> {
    this.queueAction('found_city', { name, x, y });
    return { success: true, message: 'City founding queued for next turn resolution' };
  }

  async setResearch(techId: string): Promise<ActionResult> {
    this.queueAction('research_selection', { techId });
    return { success: true, message: 'Research selection queued for next turn resolution' };
  }

  async attackUnit(attackerUnitId: string, defenderUnitId: string): Promise<ActionResult> {
    this.queueAction('unit_attack', { attackerUnitId, defenderUnitId });
    return { success: true, message: 'Attack queued for next turn resolution' };
  }

  /**
   * End turn using synchronous resolution with SSE streaming
   * Processes all queued actions and advances the turn
   */
  async endTurn(): Promise<ActionResult> {
    if (!this.currentGameId) {
      throw new Error('No active game');
    }

    try {
      // Generate idempotency key to prevent duplicate requests
      const idempotencyKey = `${this.currentGameId}_${this.currentTurnVersion}_${Date.now()}`;

      // Prepare request body
      const requestBody = {
        turnVersion: this.currentTurnVersion,
        playerActions: [...this.pendingActions], // Copy the array
        idempotencyKey,
      };

      console.log('Starting turn resolution with', requestBody.playerActions.length, 'actions');

      // Set up progress tracking
      const store = useGameStore.getState();
      store.setTurnResolving(true);
      store.setTurnProgress(null);
      store.setClientState('preparing'); // Show loading state

      // Stream turn resolution with Server-Sent Events
      const response = await this.streamTurnResolution(requestBody);

      // Clear queued actions after successful resolution
      this.clearPendingActions();

      // Update game state with new data
      await this.fetchGameData();

      // Clear turn resolution state
      store.setTurnResolving(false);
      store.setTurnProgress(null);
      store.setClientState('running');

      return {
        success: true,
        message: 'Turn resolved successfully',
        ...response,
      };
    } catch (error) {
      console.error('Error ending turn:', error);

      // Clear turn resolution state on error
      const store = useGameStore.getState();
      store.setTurnResolving(false);
      store.setTurnProgress(null);
      store.setClientState('running'); // Reset state

      throw new Error(error instanceof Error ? error.message : 'Failed to end turn');
    }
  }

  /**
   * Stream turn resolution using Server-Sent Events
   */
  private async streamTurnResolution(requestBody: any): Promise<any> {
    const url = `${this.baseUrl}/api/games/${this.currentGameId}/turns/resolve`;
    const headers: any = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    };

    if (this.sessionId) {
      headers['x-session-id'] = this.sessionId;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      // Process Server-Sent Events stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: any = null;

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('event:') || line.startsWith('data:')) {
            const [prefix, ...rest] = line.split(' ');
            const content = rest.join(' ');

            if (prefix === 'data:' && content.trim()) {
              try {
                const eventData = JSON.parse(content);
                this.handleTurnProgressEvent(eventData);

                // Check if this is the final result
                if (eventData.success !== undefined) {
                  finalResult = eventData;
                }
              } catch {
                console.warn('Failed to parse SSE data:', content);
              }
            }
          }
        }
      }

      if (!finalResult) {
        throw new Error('Turn resolution completed but no final result received');
      }

      return finalResult;
    } catch (error) {
      console.error('Turn resolution streaming failed:', error);
      throw error;
    }
  }

  /**
   * Handle progress events during turn resolution
   */
  private handleTurnProgressEvent(eventData: any): void {
    console.log('Turn progress:', eventData);

    const store = useGameStore.getState();

    // Update store with progress information
    if (eventData.stage && eventData.message) {
      store.setTurnProgress({
        stage: eventData.stage,
        message: eventData.message,
        progress: eventData.progress || 0,
        actionType: eventData.actionType,
        error: eventData.error,
      });

      console.log(
        `${eventData.stage}: ${eventData.message} (${Math.round((eventData.progress || 0) * 100)}%)`
      );
    }

    if (eventData.error) {
      console.error('Turn resolution error:', eventData.error);
    }
  }

  // Data getters (legacy compatibility methods)
  async getMapData(): Promise<any> {
    const response = await this.makeRequest(`/api/games/${this.currentGameId}/map`);
    return response.mapData;
  }

  async getVisibleTiles(): Promise<any> {
    const response = await this.makeRequest(`/api/games/${this.currentGameId}/tiles`);
    return response.visibleTiles;
  }

  disconnect(): void {
    if (this.sessionId) {
      // Fire and forget logout
      this.makeRequest('/api/auth/logout', { method: 'POST' }).catch(() => {
        // Ignore logout errors
      });
    }

    // Clear stored game session data
    clearGameSession();

    this.sessionId = null;
    this.currentGameId = null;
    console.log('Disconnected from HTTP server');

    useGameStore.getState().setClientState('initial');
  }

  isConnected(): boolean {
    return this.sessionId !== null;
  }

  getCurrentGameId(): string | null {
    return this.currentGameId;
  }

  // Legacy compatibility method - no longer used
  joinGame(): void {
    console.warn('joinGame() is deprecated. Use joinSpecificGame() instead.');
  }
}

export const gameClient = new GameClient();
