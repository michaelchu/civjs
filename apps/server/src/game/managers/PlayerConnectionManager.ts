/**
 * PlayerConnectionManager - Handles all player join/leave operations and connection management
 * Extracted from GameManager.ts following the established refactoring patterns
 * @reference docs/refactor/REFACTORING_ARCHITECTURE_PATTERNS.md Manager-Service-Repository Pattern
 */

import { BaseGameService } from './GameService';
import { logger } from '../../utils/logger';
import { db } from '../../database';
import { gameState } from '../../database/redis';
import { games, players } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { RulesetLoader } from '../../shared/data/rulesets/RulesetLoader';
import serverConfig from '../../config';
import type { PlayerState } from '../GameManager';

export interface PlayerConnectionService {
  joinGame(gameId: string, userId: string, civilization?: string): Promise<string>;
  updatePlayerConnection(playerId: string, isConnected: boolean): Promise<void>;
  ensureMinimumPlayers(gameId: string): Promise<void>;
}

export class PlayerConnectionManager extends BaseGameService implements PlayerConnectionService {
  private playerToGame = new Map<string, string>();
  private onBroadcast?: (gameId: string, event: string, data: any) => void;
  private onAutoStartGame?: (gameId: string, hostId: string) => Promise<void>;

  constructor(
    onBroadcast?: (gameId: string, event: string, data: any) => void,
    onAutoStartGame?: (gameId: string, hostId: string) => Promise<void>
  ) {
    super(logger);
    this.onBroadcast = onBroadcast;
    this.onAutoStartGame = onAutoStartGame;
  }

  getServiceName(): string {
    return 'PlayerConnectionManager';
  }

  /**
   * Handle player joining a game with nation selection and validation
   * @reference Original GameManager.ts:138-285 joinGame()
   */
  async joinGame(gameId: string, userId: string, civilization?: string): Promise<string> {
    // Get game from database
    const game = await db.query.games.findFirst({
      where: eq(games.id, gameId),
      with: {
        players: true,
      },
    });

    if (!game) {
      throw new Error('Game not found');
    }

    // Check if user is already in the game first
    const existingPlayer = game.players.find(p => p.userId === userId);
    if (existingPlayer) {
      // Track player to game mapping for existing player
      this.playerToGame.set(existingPlayer.id, gameId);
      return existingPlayer.id; // Already joined - allow rejoining at any game status
    }

    // Only allow new players in waiting games
    if (game.status !== 'waiting') {
      throw new Error('Game is not accepting new players');
    }

    if (game.players.length >= game.maxPlayers) {
      throw new Error('Game is full');
    }

    // Create player in database
    const playerNumber = game.players.length + 1;

    // Validate and select nation
    const selectedNation = await this.validateAndSelectNation(civilization, game.players);

    const playerData = {
      gameId,
      userId,
      playerNumber,
      nation: selectedNation,
      civilization: selectedNation || `Civilization${playerNumber}`,
      leaderName: `Leader${playerNumber}`,
      color: {
        r: Math.floor(Math.random() * 255),
        g: Math.floor(Math.random() * 255),
        b: Math.floor(Math.random() * 255),
      },
    };

    const [newPlayer] = await db.insert(players).values(playerData).returning();

    // Track player to game mapping
    this.playerToGame.set(newPlayer.id, gameId);

    // Update Redis cache
    await gameState.setGameState(gameId, {
      state: game.status,
      currentTurn: game.currentTurn,
      turnPhase: game.turnPhase,
      playerCount: game.players.length + 1,
    });

    this.logger.info('Player joined game', { gameId, playerId: newPlayer.id, userId });

    // Notify all players in the game
    this.onBroadcast?.(gameId, 'player-joined', {
      playerId: newPlayer.id,
      playerNumber,
      civilization: playerData.civilization,
      playerCount: game.players.length + 1,
    });

    // Handle auto-start logic
    await this.handleAutoStart(gameId);

    return newPlayer.id;
  }

  /**
   * Update player connection status
   * @reference Original GameManager.ts:1292-1331 updatePlayerConnection()
   */
  async updatePlayerConnection(playerId: string, isConnected: boolean): Promise<void> {
    const gameId = this.playerToGame.get(playerId);
    if (!gameId) return;

    // Update database connection status
    try {
      await db
        .update(players)
        .set({
          connectionStatus: isConnected ? 'connected' : 'disconnected',
          lastActionAt: new Date(),
        })
        .where(eq(players.id, playerId));
    } catch (error) {
      this.logger.error('Failed to update player connection status in database:', error);
    }

    if (isConnected) {
      this.logger.info('Player reconnected', { gameId, playerId });
    } else {
      this.logger.info('Player disconnected', { gameId, playerId });
    }

    // Broadcast connection status update
    this.onBroadcast?.(gameId, 'player-connection-changed', {
      playerId,
      isConnected,
      timestamp: Date.now(),
    });
  }

  /**
   * Ensure game has minimum players by adding AI players if needed
   * @reference Original GameManager.ts:290-351 ensureMinimumPlayers()
   */
  async ensureMinimumPlayers(gameId: string): Promise<void> {
    // Get current game state
    const game = await db.query.games.findFirst({
      where: eq(games.id, gameId),
      with: { players: true },
    });

    if (!game) {
      this.logger.warn('Game not found for minimum player check', { gameId });
      return;
    }

    const currentPlayerCount = game.players.length;
    const minPlayers = serverConfig.game.minPlayersToStart;

    if (currentPlayerCount >= minPlayers) {
      this.logger.debug('Game already has sufficient players', { gameId, currentPlayerCount, minPlayers });
      return;
    }

    const aiPlayersNeeded = minPlayers - currentPlayerCount;
    this.logger.info('Adding AI players to meet minimum requirements', {
      gameId,
      currentPlayerCount,
      minPlayers,
      aiPlayersNeeded,
    });

    // Get available nations for AI players
    const availableNations = await this.getAvailableNations(game.players);

    for (let i = 0; i < aiPlayersNeeded && i < availableNations.length; i++) {
      const playerNumber = game.players.length + i + 1;
      const aiNation = availableNations[i];

      const aiPlayerData = {
        gameId,
        userId: null, // AI players have null userId
        playerNumber,
        nation: aiNation,
        civilization: aiNation,
        leaderName: `AI Leader ${playerNumber}`,
        color: {
          r: Math.floor(Math.random() * 255),
          g: Math.floor(Math.random() * 255),
          b: Math.floor(Math.random() * 255),
        },
        connectionStatus: 'connected',
        isReady: true,
      };

      try {
        const [aiPlayer] = await db.insert(players).values(aiPlayerData).returning();
        this.logger.info('Added AI player to game', { gameId, aiPlayerId: aiPlayer.id, nation: aiNation });

        // Broadcast AI player addition
        this.onBroadcast?.(gameId, 'player-joined', {
          playerId: aiPlayer.id,
          playerNumber,
          civilization: aiNation,
          isAI: true,
          playerCount: currentPlayerCount + i + 1,
        });
      } catch (error) {
        this.logger.error('Failed to add AI player:', error);
      }
    }
  }

  /**
   * Get player-to-game mapping
   */
  getPlayerToGame(): Map<string, string> {
    return this.playerToGame;
  }

  /**
   * Set player-to-game mapping (for recovery scenarios)
   */
  setPlayerToGame(playerId: string, gameId: string): void {
    this.playerToGame.set(playerId, gameId);
  }

  /**
   * Remove player from tracking
   */
  removePlayer(playerId: string): void {
    this.playerToGame.delete(playerId);
  }

  /**
   * Validate and select nation for player
   * @reference Original GameManager.ts:169-201 nation validation logic
   */
  private async validateAndSelectNation(civilization: string | undefined, existingPlayers: any[]): Promise<string> {
    // Validate nation is not already taken (reference: freeciv/server/plrhand.c:2129)
    if (civilization && civilization !== 'random') {
      const existingPlayerWithNation = existingPlayers.find(p => p.civilization === civilization);
      if (existingPlayerWithNation) {
        throw new Error('That nation is already in use.');
      }
      return civilization;
    }

    // Handle random nation selection
    let selectedNation = civilization || 'american';
    if (civilization === 'random') {
      try {
        const loader = RulesetLoader.getInstance();
        const nationsRuleset = loader.loadNationsRuleset('classic');

        if (nationsRuleset) {
          // Get playable nations (exclude barbarian and already taken nations)
          const takenNations = new Set(existingPlayers.map(p => p.civilization));
          const playableNations = Object.values(nationsRuleset.nations)
            .filter(nation => nation.id !== 'barbarian' && !takenNations.has(nation.id))
            .map(nation => nation.id);

          // Randomly select from available nations
          if (playableNations.length > 0) {
            const randomIndex = Math.floor(Math.random() * playableNations.length);
            selectedNation = playableNations[randomIndex];
          }
        }
      } catch (error) {
        this.logger.warn('Failed to load nations for random selection, using default', error);
        selectedNation = 'american';
      }
    }

    return selectedNation;
  }

  /**
   * Get available nations for AI players
   */
  private async getAvailableNations(existingPlayers: any[]): Promise<string[]> {
    try {
      const loader = RulesetLoader.getInstance();
      const nationsRuleset = loader.loadNationsRuleset('classic');

      if (!nationsRuleset) {
        // Fallback nations if ruleset loading fails
        return ['american', 'roman', 'german', 'japanese', 'russian', 'british'];
      }

      // Get playable nations (exclude barbarian and already taken nations)
      const takenNations = new Set(existingPlayers.map(p => p.civilization));
      const availableNations = Object.values(nationsRuleset.nations)
        .filter(nation => nation.id !== 'barbarian' && !takenNations.has(nation.id))
        .map(nation => nation.id);

      return availableNations;
    } catch (error) {
      this.logger.warn('Failed to load available nations, using fallback list', error);
      // Fallback nations
      const fallbackNations = ['american', 'roman', 'german', 'japanese', 'russian', 'british'];
      const takenNations = new Set(existingPlayers.map(p => p.civilization));
      return fallbackNations.filter(nation => !takenNations.has(nation));
    }
  }

  /**
   * Handle auto-start logic after player joins
   * @reference Original GameManager.ts:237-282 auto-start logic
   */
  private async handleAutoStart(gameId: string): Promise<void> {
    // Get updated game state
    const updatedGame = await db.query.games.findFirst({
      where: eq(games.id, gameId),
      with: { players: true },
    });

    this.logger.debug('Checking auto-start conditions', {
      gameId,
      gameExists: !!updatedGame,
      gameStatus: updatedGame?.status,
      playerCount: updatedGame?.players.length,
    });

    // Auto-start logic: immediately start single-player games, or start multiplayer when enough players join
    if (updatedGame && updatedGame.status === 'waiting') {
      const shouldAutoStart =
        updatedGame.gameType === 'single' || // Always start single-player games
        updatedGame.players.length >= serverConfig.game.minPlayersToStart; // Start multiplayer when enough players

      if (shouldAutoStart) {
        this.logger.info('Auto-starting game', {
          gameId,
          gameType: updatedGame.gameType,
          playerCount: updatedGame.players.length,
        });
        try {
          // Small delay to ensure socket room joins are complete
          await new Promise(resolve => setTimeout(resolve, 200));

          // Add AI player if needed to meet minimum requirements
          await this.ensureMinimumPlayers(gameId);

          // Trigger auto-start through callback
          await this.onAutoStartGame?.(gameId, updatedGame.hostId);
        } catch (error) {
          this.logger.error('Failed to auto-start game:', error);
        }
      } else {
        this.logger.debug('Auto-start conditions not met', {
          gameId,
          gameType: updatedGame.gameType,
          hasGame: !!updatedGame,
          status: updatedGame?.status,
          playerCount: updatedGame?.players.length,
        });
      }
    }
  }
}