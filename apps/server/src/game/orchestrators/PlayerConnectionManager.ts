/**
 * PlayerConnectionManager - Handles all player join/leave operations and connection management
 * Extracted from GameManager.ts following the established refactoring patterns
 */

import { BaseGameService } from './GameService';
import { logger } from '@utils/logger';
import { DEFAULT_TAX_RATES } from '@game/systems/Economic/constants/EconomicConstants';
import { DatabaseProvider } from '@database';
import { gameState } from '@database/redis';
import { games, players } from '@database/schema';
import { eq } from 'drizzle-orm';
import { RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';
import serverConfig from '@config';
import { getNextPlayerColorTheme, type PlayerColor } from '../../utils/playerColors';
import { isSettableAILevel } from '../ai/AIProfile';
import { createAIState } from '../ai/AIStateStore';
// PlayerState type is used in comments and method parameters but imported from GameManager

export interface PlayerConnectionService {
  joinGame(
    gameId: string,
    userId: string,
    civilization?: string
  ): Promise<{ playerId: string; assignedNation: string; assignedColor: PlayerColor }>;
  updatePlayerConnection(playerId: string, isConnected: boolean): Promise<void>;
  ensureMinimumPlayers(gameId: string): Promise<void>;
}

export class PlayerConnectionManager extends BaseGameService implements PlayerConnectionService {
  private playerToGame = new Map<string, string>();
  private databaseProvider: DatabaseProvider;
  private onBroadcast?: (gameId: string, event: string, data: any) => void;
  private onAutoStartGame?: (gameId: string, hostId: string) => Promise<void>;

  constructor(
    databaseProvider: DatabaseProvider,
    onBroadcast?: (gameId: string, event: string, data: any) => void,
    onAutoStartGame?: (gameId: string, hostId: string) => Promise<void>
  ) {
    super(logger);
    this.databaseProvider = databaseProvider;
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
  async joinGame(
    gameId: string,
    userId: string,
    civilization?: string
  ): Promise<{ playerId: string; assignedNation: string; assignedColor: PlayerColor }> {
    // Get game from database
    const game = await this.databaseProvider.getDatabase().query.games.findFirst({
      where: eq(games.id, gameId),
      with: {
        players: true,
      },
    });

    this.assertGameCanBeJoined(game);

    // Check if user is already in the game first
    const existingPlayer = game.players.find(p => p.userId === userId);
    if (existingPlayer) {
      // Track player to game mapping for existing player
      this.playerToGame.set(existingPlayer.id, gameId);
      const existingResult = {
        playerId: existingPlayer.id,
        assignedNation: existingPlayer.nation || existingPlayer.civilization || 'american',
        assignedColor: existingPlayer.color as PlayerColor,
      };
      return existingResult; // Already joined - allow rejoining at any game status
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
    const selectedNation = await this.validateAndSelectNation(
      civilization,
      game.players,
      game.ruleset ?? DEFAULT_RULESET
    );

    // Get next available color theme from predefined palette
    // For backward compatibility, we store the primary color in the old 'color' field
    const usedThemes = game.players
      .map(p => {
        const color = p.color as PlayerColor;
        // Convert old single color to theme format for comparison
        return {
          primary: color,
          secondary: { r: 255, g: 255, b: 255 },
          tertiary: { r: 0, g: 0, b: 0 },
          name: 'Legacy',
        };
      })
      .filter(theme => theme && theme.primary); // Filter out invalid themes
    const assignedTheme = getNextPlayerColorTheme(usedThemes);

    // Safety check for testing and edge cases - provide fallback color
    const safeTheme = assignedTheme || {
      primary: { r: 128, g: 128, b: 128 }, // Default gray
      secondary: { r: 255, g: 255, b: 255 },
      tertiary: { r: 0, g: 0, b: 0 },
      name: 'Fallback Gray',
    };

    const playerData = {
      gameId,
      userId,
      playerNumber,
      nation: selectedNation,
      civilization: selectedNation || `Civilization${playerNumber}`,
      leaderName: `Leader${playerNumber}`,
      color: safeTheme.primary, // Store primary color for backward compatibility
      taxRate: DEFAULT_TAX_RATES.tax,
      luxuryRate: DEFAULT_TAX_RATES.luxury,
      scienceRate: DEFAULT_TAX_RATES.science,
    };

    const [newPlayer] = await this.databaseProvider
      .getDatabase()
      .insert(players)
      .values(playerData)
      .returning();

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

    const finalResult = {
      playerId: newPlayer.id,
      assignedNation: selectedNation,
      assignedColor: safeTheme.primary,
    };
    return finalResult;
  }

  private assertGameCanBeJoined<T extends { status: string }>(
    game: T | null | undefined
  ): asserts game is T {
    if (!game) {
      throw new Error('Game not found');
    }

    // Finished games are immutable. Validate before the existing-player
    // rejoin path so nobody can enter an ended game.
    if (game.status === 'ended') {
      throw new Error('Game has finished');
    }
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
      await this.databaseProvider
        .getDatabase()
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
    const game = await this.databaseProvider.getDatabase().query.games.findFirst({
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
      this.logger.debug('Game already has sufficient players', {
        gameId,
        currentPlayerCount,
        minPlayers,
      });
      return;
    }

    const aiPlayersNeeded = minPlayers - currentPlayerCount;
    const configuredAILevel = isSettableAILevel((game.gameState as any)?.aiLevel)
      ? (game.gameState as any).aiLevel
      : 'easy';
    this.logger.info('Adding AI players to meet minimum requirements', {
      gameId,
      currentPlayerCount,
      minPlayers,
      aiPlayersNeeded,
    });

    // Get available nations for AI players
    const availableNations = await this.getAvailableNations(
      game.players,
      game.ruleset ?? DEFAULT_RULESET
    );

    for (let i = 0; i < aiPlayersNeeded && i < availableNations.length; i++) {
      const playerNumber = game.players.length + i + 1;
      const aiNation = availableNations[i];

      // Get next available color theme for AI player
      const currentUsedThemes = game.players
        .map(p => {
          const color = p.color as PlayerColor;
          // Convert old single color to theme format for comparison
          return {
            primary: color,
            secondary: { r: 255, g: 255, b: 255 },
            tertiary: { r: 0, g: 0, b: 0 },
            name: 'Legacy',
          };
        })
        .filter(theme => theme && theme.primary); // Filter out invalid themes
      const aiTheme = getNextPlayerColorTheme(currentUsedThemes);

      // Safety check for AI player colors
      const safeAiTheme = aiTheme || {
        primary: { r: 64, g: 64, b: 64 }, // Dark gray for AI
        secondary: { r: 255, g: 255, b: 255 },
        tertiary: { r: 0, g: 0, b: 0 },
        name: 'AI Fallback Gray',
      };

      const aiPlayerData = {
        gameId,
        userId: null, // AI players have null userId
        playerNumber,
        nation: aiNation,
        civilization: aiNation,
        leaderName: `AI Leader ${playerNumber}`,
        color: safeAiTheme.primary, // Store primary color for backward compatibility
        connectionStatus: 'connected',
        isAI: true,
        aiLevel: configuredAILevel,
        aiTraits: { expansionist: 50, trader: 50, aggressive: 50, builder: 50 },
        aiState: createAIState(),
        isReady: true,
        taxRate: DEFAULT_TAX_RATES.tax,
        luxuryRate: DEFAULT_TAX_RATES.luxury,
        scienceRate: DEFAULT_TAX_RATES.science,
      };

      try {
        const [aiPlayer] = await this.databaseProvider
          .getDatabase()
          .insert(players)
          .values(aiPlayerData)
          .returning();
        this.logger.info('Added AI player to game', {
          gameId,
          aiPlayerId: aiPlayer.id,
          nation: aiNation,
        });

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
  private async validateAndSelectNation(
    civilization: string | undefined,
    existingPlayers: any[],
    rulesetName: string
  ): Promise<string> {
    // Validate nation is not already taken (reference: freeciv/server/plrhand.c:2129)
    if (civilization && civilization !== 'random') {
      const nations = RulesetLoader.getInstance().loadNationsRuleset(rulesetName).nations;
      if (!nations[civilization] || civilization === 'barbarian' || civilization === 'pirate') {
        throw new Error('That nation is not supported in the Civ III–V roster.');
      }
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
        const nationsRuleset = loader.loadNationsRuleset(rulesetName);

        if (nationsRuleset) {
          // Get supported nations that are not already taken.
          const takenNations = new Set(existingPlayers.map(p => p.civilization));

          const playableNations = Object.values(nationsRuleset.nations)
            .filter(nation => nation.is_playable !== false)
            .filter(nation => !takenNations.has(nation.id))
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
  private async getAvailableNations(
    existingPlayers: any[],
    rulesetName: string
  ): Promise<string[]> {
    try {
      const loader = RulesetLoader.getInstance();
      const nationsRuleset = loader.loadNationsRuleset(rulesetName);

      if (!nationsRuleset) {
        // Fallback nations if ruleset loading fails
        return ['american', 'roman', 'german', 'japanese', 'russian', 'english'];
      }

      // Get supported nations that are not already taken.
      const takenNations = new Set(existingPlayers.map(p => p.civilization));
      const availableNations = Object.values(nationsRuleset.nations)
        .filter(nation => nation.is_playable !== false)
        .filter(nation => !takenNations.has(nation.id))
        .map(nation => nation.id);

      return availableNations;
    } catch (error) {
      this.logger.warn('Failed to load available nations, using fallback list', error);
      // Fallback nations
      const fallbackNations = ['american', 'roman', 'german', 'japanese', 'russian', 'english'];
      const takenNations = new Set(existingPlayers.map(p => p.civilization));
      return fallbackNations.filter(nation => !takenNations.has(nation));
    }
  }

  /**
   * Handle auto-start logic after player joins
   * @reference Original GameManager.ts:237-282 auto-start logic
   */
  private async handleAutoStart(gameId: string): Promise<void> {
    const updatedGame = await this.databaseProvider.getDatabase().query.games.findFirst({
      where: eq(games.id, gameId),
      with: { players: true },
    });

    this.logger.debug('Checking auto-start conditions', {
      gameId,
      gameExists: !!updatedGame,
      gameStatus: updatedGame?.status,
      playerCount: updatedGame?.players.length,
    });

    if (updatedGame && updatedGame.status === 'waiting') {
      const shouldAutoStart = this.shouldAutoStart(updatedGame);
      if (shouldAutoStart) {
        await this.performAutoStart(gameId, updatedGame);
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

  private shouldAutoStart(updatedGame: any): boolean {
    return (
      updatedGame.gameType === 'single' ||
      updatedGame.players.length >= serverConfig.game.minPlayersToStart
    );
  }

  private async performAutoStart(gameId: string, updatedGame: any): Promise<void> {
    this.logger.info('Auto-starting game', {
      gameId,
      gameType: updatedGame.gameType,
      playerCount: updatedGame.players.length,
    });
    try {
      await new Promise(resolve => setTimeout(resolve, 200));
      await this.ensureMinimumPlayers(gameId);
      await this.onAutoStartGame?.(gameId, updatedGame.hostId);
    } catch (error) {
      this.logger.error('Failed to auto-start game:', error);
    }
  }
}
