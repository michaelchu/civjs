/* eslint-disable @typescript-eslint/no-explicit-any */
import { SERVER_URL } from '../config';
import { useGameStore } from '../store/gameStore';

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
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastGameState: GameState | null = null;
  private pollingFrequency: number = 5000; // 5 seconds default

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
      
      // Start polling for single player games
      if (gameData.maxPlayers === 1) {
        useGameStore.getState().setClientState('running');
        this.startPolling();
      } else {
        useGameStore.getState().setClientState('waiting_for_players');
        this.startPolling(30000); // Poll every 30 seconds in lobby
      }
      
      return response.gameId;
    } else {
      throw new Error(response.error || 'Failed to create game');
    }
  }

  async joinSpecificGame(gameId: string, playerName: string): Promise<void> {
    // First authenticate
    await this.authenticatePlayer(playerName);

    const response = await this.makeRequest(`/api/games/${gameId}/join`, {
      method: 'POST',
      body: JSON.stringify({ civilization: 'random' }),
    });

    if (response.success) {
      this.currentGameId = gameId;
      console.log(`Joined game ${gameId}`);
      this.startPolling();
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
      this.startPolling();
    } else {
      throw new Error(response.error || 'Failed to observe game');
    }
  }

  async getGameList(): Promise<any[]> {
    const response = await this.makeRequest('/api/games');
    return response.success ? response.games : [];
  }

  private async pollGameState(): Promise<void> {
    if (!this.currentGameId) {
      return;
    }

    try {
      const response = await this.makeRequest(`/api/games/${this.currentGameId}`);
      
      if (response.success) {
        const gameState = response.game as GameState;
        this.handleGameStateUpdate(gameState);
        this.lastGameState = gameState;
      }
    } catch (error) {
      console.error('Polling error:', error);
      // Implement exponential backoff on errors
      this.pollingFrequency = Math.min(this.pollingFrequency * 1.5, 30000);
    }
  }

  private handleGameStateUpdate(gameState: GameState): void {
    const store = useGameStore.getState();
    
    // Update basic game state
    store.updateGameState({
      turn: gameState.currentTurn,
      currentPlayerId: gameState.currentPlayer,
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
          // Stop polling during player's turn for immediate actions
          this.stopPolling();
        } else {
          console.log('Your turn ended');
          // Resume polling to wait for other players
          this.startPolling();
        }
      }

      // Game status changed
      if (this.lastGameState.status !== gameState.status) {
        console.log('Game status changed to:', gameState.status);
        if (gameState.status === 'playing') {
          store.setClientState('running');
          this.pollingFrequency = 5000; // 5 seconds during gameplay
        } else if (gameState.status === 'waiting') {
          store.setClientState('waiting_for_players');
          this.pollingFrequency = 30000; // 30 seconds in lobby
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

  startPolling(frequency: number = 5000): void {
    this.stopPolling();
    this.pollingFrequency = frequency;
    
    console.log(`Starting polling every ${frequency}ms`);
    this.pollingInterval = setInterval(() => {
      this.pollGameState();
    }, frequency);
    
    // Poll immediately
    this.pollGameState();
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('Stopped polling');
    }
  }

  // Game Actions
  async moveUnit(unitId: string, _fromX: number, _fromY: number, toX: number, toY: number): Promise<ActionResult> {
    const response = await this.makeRequest(`/api/games/${this.currentGameId}/actions/move`, {
      method: 'POST',
      body: JSON.stringify({ unitId, toX, toY }),
    });

    // After action, resume polling to check for turn changes
    this.startPolling();
    
    return response;
  }

  async foundCity(name: string, x: number, y: number): Promise<ActionResult> {
    const response = await this.makeRequest(`/api/games/${this.currentGameId}/actions/found-city`, {
      method: 'POST',
      body: JSON.stringify({ name, x, y }),
    });

    this.startPolling();
    return response;
  }

  async setResearch(techId: string): Promise<ActionResult> {
    const response = await this.makeRequest(`/api/games/${this.currentGameId}/actions/research`, {
      method: 'POST',
      body: JSON.stringify({ techId }),
    });

    this.startPolling();
    return response;
  }

  async endTurn(): Promise<ActionResult> {
    const response = await this.makeRequest(`/api/games/${this.currentGameId}/actions/end-turn`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    // After ending turn, resume polling immediately to watch for game updates
    this.startPolling();
    return response;
  }

  async attackUnit(attackerUnitId: string, defenderUnitId: string): Promise<ActionResult> {
    const response = await this.makeRequest(`/api/games/${this.currentGameId}/actions/attack`, {
      method: 'POST',
      body: JSON.stringify({ attackerUnitId, defenderUnitId }),
    });

    this.startPolling();
    return response;
  }

  // Data getters (now handled by polling, but keeping for compatibility)
  async getMapData(): Promise<any> {
    const response = await this.makeRequest(`/api/games/${this.currentGameId}/map`);
    return response.mapData;
  }

  async getVisibleTiles(): Promise<any> {
    const response = await this.makeRequest(`/api/games/${this.currentGameId}/tiles`);
    return response.visibleTiles;
  }

  disconnect(): void {
    this.stopPolling();
    
    if (this.sessionId) {
      // Fire and forget logout
      this.makeRequest('/api/auth/logout', { method: 'POST' }).catch(() => {
        // Ignore logout errors
      });
    }
    
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