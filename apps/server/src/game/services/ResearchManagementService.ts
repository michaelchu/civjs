import { GameInstance } from '@game/managers/GameManager';
import { BaseGameService } from '@game/orchestrators/GameService';
import { logger } from '@utils/logger';

/**
 * ResearchManagementService - Extracted research operations from GameManager
 * @reference docs/refactor/REFACTORING_PLAN.md - Phase 1 GameManager refactoring
 *
 * Handles all research-related operations including:
 * - Research goal setting and current research management
 * - Research progress tracking and point allocation
 * - Available technology queries
 * - Research turn processing with tech completion
 * - Research-related broadcasting coordination
 */
export class ResearchManagementService extends BaseGameService {
  constructor(
    private games: Map<string, GameInstance>,
    private broadcastToGame: (gameId: string, event: string, data: any) => void
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'ResearchManagementService';
  }

  /**
   * Set a player's current research target
   * @reference Original GameManager.setPlayerResearch()
   */
  public async setPlayerResearch(gameId: string, playerId: string, techId: string): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      throw new Error('Player not found in game');
    }

    await gameInstance.researchManager.setCurrentResearch(playerId, techId);

    // Broadcast research change to the player
    this.broadcastToGame(gameId, 'research_changed', {
      gameId,
      playerId,
      techId,
      availableTechs: gameInstance.researchManager.getAvailableTechnologies(playerId),
    });
  }

  /**
   * Set a player's research goal (long-term target)
   * @reference Original GameManager.setResearchGoal()
   */
  public async setResearchGoal(gameId: string, playerId: string, techId: string): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      throw new Error('Player not found in game');
    }

    await gameInstance.researchManager.setResearchGoal(playerId, techId);

    // Broadcast goal change to the player
    this.broadcastToGame(gameId, 'research_goal_changed', {
      gameId,
      playerId,
      techGoal: techId,
    });
  }

  /**
   * Get a player's current research information
   * @reference Original GameManager.getPlayerResearch()
   */
  public getPlayerResearch(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.researchManager.getPlayerResearch(playerId);
  }

  /**
   * Get technologies available for research by a player
   * @reference Original GameManager.getAvailableTechnologies()
   */
  public getAvailableTechnologies(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.researchManager.getAvailableTechnologies(playerId);
  }

  /**
   * Get research progress for a player
   * @reference Original GameManager.getResearchProgress()
   */
  public getResearchProgress(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.researchManager.getResearchProgress(playerId);
  }

  /**
   * Process research advancement for all players in a game
   * @reference Original GameManager.processResearchTurn()
   */
  public async processResearchTurn(gameId: string): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    // Process research for each player
    for (const [playerId, player] of gameInstance.players) {
      if (!player.isConnected) continue;

      // Get science output from cities
      const playerCities = gameInstance.cityManager.getPlayerCities(playerId);
      let totalScience = 0;

      for (const city of playerCities) {
        totalScience += city.sciencePerTurn || 0;
      }

      // Add research points and check for completed techs
      const completedTech = await gameInstance.researchManager.addResearchPoints(
        playerId,
        totalScience
      );

      if (completedTech) {
        // Broadcast tech completion to all players
        this.broadcastToGame(gameId, 'tech_completed', {
          gameId,
          playerId,
          techId: completedTech,
          playerName: player.civilization,
          availableTechs: gameInstance.researchManager.getAvailableTechnologies(playerId),
        });

        logger.info('Technology completed', { gameId, playerId, techId: completedTech });
      }
    }
  }
}
