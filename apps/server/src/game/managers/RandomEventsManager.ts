/**
 * @module server/game/managers/RandomEventsManager
 * RandomEventsManager - Orchestrates all random events during turn processing
 *
 * This manager coordinates the various random events that occur during
 * the PHASE_RANDOM_EVENTS phase of turn processing, including:
 * - Barbarian spawning and uprisings
 * - City disasters (earthquakes, fires, floods, etc.)
 * - Goody hut discoveries
 * - Natural resource changes
 * - Random unit movements
 *
 * @reference freeciv/server/srv_main.c - begin_turn() random event processing (lines 1394-1793)
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js - random event packet handling
 */

import { logger } from '@utils/logger';
import type { BarbarianManager } from './BarbarianManager';
import type { DisasterManager } from './DisasterManager';
import type { UnitManager } from './UnitManager';
import type { MapManager } from './MapManager';
import type { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';

export interface RandomEventConfig {
  // Barbarian settings
  barbarianRate: number; // 0=disabled, 1-5=frequency levels
  onsetBarbarian: number; // Turn number when barbarians start appearing

  // Disaster settings
  disastersEnabled: boolean;
  disasterFrequency: number; // Base disaster frequency multiplier

  // Random unit movement
  randomMovementsEnabled: boolean;

  // Natural events
  resourceChangesEnabled: boolean;
  resourceChangeFrequency: number;

  // Goody hut processing
  goodyHutsEnabled: boolean;
  barbarianHutChance: number; // Chance (0-100) that hut spawns barbarians
}

export interface RandomEventResult {
  eventType: string;
  success: boolean;
  playersAffected: string[];
  details: any;
  timestamp: number;
}

export interface RandomEventsPhaseResult {
  barbarianEvents: number;
  disasterEvents: number;
  unitMovements: number;
  resourceChanges: number;
  goodyHutDiscoveries: number;
  totalEvents: number;
  results: RandomEventResult[];
  duration: number;
}

export class RandomEventsManager {
  private gameId: string;
  private config: RandomEventConfig;
  private barbarianManager: BarbarianManager;
  private disasterManager: DisasterManager;
  private unitManager: UnitManager;
  private broadcastManager: Pick<GameBroadcastManager, 'broadcastToGame'>;

  constructor(
    gameId: string,
    config: RandomEventConfig,
    barbarianManager: BarbarianManager,
    disasterManager: DisasterManager,
    unitManager: UnitManager,
    _mapManager: MapManager,
    broadcastManager: GameBroadcastManager
  ) {
    this.gameId = gameId;
    this.config = config;
    this.barbarianManager = barbarianManager;
    this.disasterManager = disasterManager;
    this.unitManager = unitManager;
    this.broadcastManager = broadcastManager;
  }

  /**
   * Execute all random events for the current turn
   * @reference freeciv/server/srv_main.c begin_turn() lines 1394-1793
   */
  async processRandomEvents(
    turn: number,
    year: number,
    playerIds: string[]
  ): Promise<RandomEventsPhaseResult> {
    const startTime = Date.now();
    const result: RandomEventsPhaseResult = {
      barbarianEvents: 0,
      disasterEvents: 0,
      unitMovements: 0,
      resourceChanges: 0,
      goodyHutDiscoveries: 0,
      totalEvents: 0,
      results: [],
      duration: 0,
    };

    logger.debug('Processing random events phase', {
      gameId: this.gameId,
      turn,
      year,
      playerCount: playerIds.length,
    });

    try {
      // 1. Process random unit movements (freeciv srv_main.c:1394)
      if (this.config.randomMovementsEnabled) {
        result.unitMovements = await this.processRandomUnitMovements(playerIds, result);
      }

      // 2. Spawn barbarian uprisings (freeciv srv_main.c:1668)
      if (this.shouldSpawnBarbarians(turn)) {
        result.barbarianEvents = await this.processBarbarianSpawning(turn, result);
      }

      // 3. Check and apply city disasters (freeciv srv_main.c:1684)
      if (this.config.disastersEnabled) {
        result.disasterEvents = await this.processDisasters(playerIds, result, turn, year);
      }

      // 4. Process goody hut discoveries (if any pending)
      if (this.config.goodyHutsEnabled) {
        result.goodyHutDiscoveries = await this.processGoodyHutDiscoveries(playerIds, result);
      }

      // 5. Natural resource changes (freeciv srv_main.c:1758-1793)
      if (this.config.resourceChangesEnabled) {
        result.resourceChanges = await this.processNaturalResourceChanges(result);
      }

      result.totalEvents =
        result.barbarianEvents +
        result.disasterEvents +
        result.unitMovements +
        result.resourceChanges +
        result.goodyHutDiscoveries;

      result.duration = Date.now() - startTime;

      logger.info('Random events processing completed', {
        gameId: this.gameId,
        turn,
        totalEvents: result.totalEvents,
        duration: result.duration,
        breakdown: {
          barbarians: result.barbarianEvents,
          disasters: result.disasterEvents,
          unitMovements: result.unitMovements,
          resourceChanges: result.resourceChanges,
          goodyHuts: result.goodyHutDiscoveries,
        },
      });
    } catch (error) {
      logger.error('Error in random events processing', {
        gameId: this.gameId,
        turn,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }

    return result;
  }

  /**
   * Process random unit movements
   * @reference freeciv/server/srv_main.c:1394 random_movements()
   */
  private async processRandomUnitMovements(
    playerIds: string[],
    result: RandomEventsPhaseResult
  ): Promise<number> {
    logger.debug('Processing random unit movements', { gameId: this.gameId });

    let movementsProcessed = 0;

    for (const playerId of playerIds) {
      try {
        const randomUnits = this.unitManager.getUnitsWithRandomMovement(playerId);

        for (const unit of randomUnits) {
          const moveResult = await this.unitManager.executeRandomMovement(unit.id);

          if (moveResult.success) {
            movementsProcessed++;

            result.results.push({
              eventType: 'random_unit_movement',
              success: true,
              playersAffected: [playerId],
              details: {
                unitId: unit.id,
                unitType: unit.unitTypeId,
                fromTile: moveResult.fromTile,
                toTile: moveResult.toTile,
                movementPoints: moveResult.movementPointsUsed,
              },
              timestamp: Date.now(),
            });
          }
        }
      } catch (error) {
        logger.error('Error processing random unit movements', {
          gameId: this.gameId,
          playerId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    return movementsProcessed;
  }

  /**
   * Process barbarian spawning
   * @reference freeciv/server/barbarian.c:738 summon_barbarians()
   */
  private async processBarbarianSpawning(
    turn: number,
    result: RandomEventsPhaseResult
  ): Promise<number> {
    logger.debug('Processing barbarian spawning', { gameId: this.gameId, turn });

    try {
      const spawnResult = await this.barbarianManager.spawnBarbarians(turn);

      for (const spawn of spawnResult.spawns) {
        result.results.push({
          eventType: 'barbarian_uprising',
          success: spawn.success,
          playersAffected: [], // Affects all players indirectly
          details: {
            location: spawn.location,
            unitsSpawned: spawn.unitsCreated,
            barbarianPlayerId: spawn.barbarianPlayerId,
            spawnType: spawn.spawnType, // 'land', 'sea', or 'mixed'
          },
          timestamp: Date.now(),
        });

        if (spawn.success) {
          this.broadcastManager.broadcastToGame(this.gameId, 'barbarian_uprising', {
            location: spawn.location,
            unitsSpawned: spawn.unitsCreated,
            spawnType: spawn.spawnType,
            message: 'A barbarian uprising has been reported in the wilderness.',
          });
        }
      }

      return spawnResult.totalSpawns;
    } catch (error) {
      logger.error('Error processing barbarian spawning', {
        gameId: this.gameId,
        turn,
        error: error instanceof Error ? error.message : error,
      });
      return 0;
    }
  }

  /**
   * Process city disasters
   * @reference freeciv/server/cityturn.c:4517 check_disasters()
   */
  private async processDisasters(
    playerIds: string[],
    result: RandomEventsPhaseResult,
    turn: number = 0,
    year: number = 0
  ): Promise<number> {
    logger.debug('Processing disasters', { gameId: this.gameId });

    let disastersProcessed = 0;

    for (const playerId of playerIds) {
      try {
        const disasters = await this.disasterManager.checkPlayerDisasters(playerId, turn, year);

        for (const disaster of disasters) {
          disastersProcessed++;

          result.results.push({
            eventType: 'city_disaster',
            success: disaster.success,
            playersAffected: [playerId],
            details: {
              cityId: disaster.cityId,
              cityName: disaster.cityName,
              disasterType: disaster.type,
              effects: disaster.effects,
              severity: disaster.severity,
            },
            timestamp: Date.now(),
          });

          if (disaster.success) {
            // Notify affected player (placeholder)
            // this.broadcastManager.sendPacketToPlayer(playerId, {
            //   type: 'city_disaster',
            //   cityId: disaster.cityId,
            //   disasterType: disaster.type,
            //   message: disaster.message,
            //   effects: disaster.effects,
            // });
          }
        }
      } catch (error) {
        logger.error('Error processing disasters for player', {
          gameId: this.gameId,
          playerId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    return disastersProcessed;
  }

  /**
   * Process goody hut discoveries
   * @reference freeciv/server/unittools.c unit_enter_hut()
   */
  private async processGoodyHutDiscoveries(
    playerIds: string[],
    result: RandomEventsPhaseResult
  ): Promise<number> {
    logger.debug('Processing goody hut discoveries', { gameId: this.gameId });

    // Silence unused variables warning
    void playerIds;
    void result;

    // Goody huts are typically processed when units move onto hut tiles
    // For now, this is a placeholder for any pending hut discoveries
    // that might need to be resolved during the random events phase

    return 0; // Will be enhanced when goody hut system is implemented
  }

  /**
   * Process natural resource changes
   * @reference freeciv/server/srv_main.c:1758-1793 spontaneous extra appearance
   */
  private async processNaturalResourceChanges(result: RandomEventsPhaseResult): Promise<number> {
    logger.debug('Processing natural resource changes', { gameId: this.gameId });

    try {
      // Placeholder implementation
      const changes: any[] = []; // await this.mapManager.processNaturalResourceChanges(
      //   this.config.resourceChangeFrequency
      // );

      for (const change of changes) {
        result.results.push({
          eventType: 'natural_resource_change',
          success: change.success,
          playersAffected: change.playersAffected,
          details: {
            tileId: change.tileId,
            position: change.position,
            changeType: change.type, // 'appeared' or 'disappeared'
            resourceType: change.resourceType,
          },
          timestamp: Date.now(),
        });

        if (change.success && change.playersAffected.length > 0) {
          // Notify affected players of resource changes (placeholder)
          // for (const playerId of change.playersAffected) {
          //   this.broadcastManager.sendPacketToPlayer(playerId, {
          //     type: 'resource_change',
          //     tileId: change.tileId,
          //     changeType: change.type,
          //     resourceType: change.resourceType,
          //     message: change.message,
          //   });
          // }
        }
      }

      return changes.length;
    } catch (error) {
      logger.error('Error processing natural resource changes', {
        gameId: this.gameId,
        error: error instanceof Error ? error.message : error,
      });
      return 0;
    }
  }

  /**
   * Determine if barbarians should spawn this turn
   * @reference freeciv/server/barbarian.c:738-760
   */
  private shouldSpawnBarbarians(turn: number): boolean {
    // Disabled rates
    if (this.config.barbarianRate === 0) {
      return false;
    }

    // Too early in the game
    if (turn < this.config.onsetBarbarian) {
      return false;
    }

    return true;
  }

  /**
   * Update random events configuration
   */
  updateConfig(newConfig: Partial<RandomEventConfig>): void {
    this.config = { ...this.config, ...newConfig };

    logger.debug('Random events configuration updated', {
      gameId: this.gameId,
      config: this.config,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): RandomEventConfig {
    return { ...this.config };
  }
}
