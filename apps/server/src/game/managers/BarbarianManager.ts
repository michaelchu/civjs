/**
 * BarbarianManager - Manages barbarian civilizations and spawning
 *
 * This manager handles the creation, spawning, and management of barbarian
 * tribes and their units. Barbarians are AI-controlled civilizations that
 * appear randomly on the map to provide challenges for players.
 *
 * @reference freeciv/server/barbarian.c - barbarian spawning and management
 * @reference freeciv/common/barbarian.h - barbarian definitions and constants
 */

import { logger } from '@utils/logger';
import type { UnitManager } from './UnitManager';
import type { MapManager } from './MapManager';
import type { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import type { DatabaseProvider } from '@database/DatabaseProvider';
import { barbarianTribes } from '@database/schema';

export interface BarbarianSpawnLocation {
  x: number;
  y: number;
  tileId: string;
  terrain: string;
  isLand: boolean;
  isSea: boolean;
  distanceToNearestCity: number;
}

export interface BarbarianSpawnConfig {
  rate: number; // 1-5, controls spawn frequency
  onsetTurn: number; // Turn when barbarians first appear
  landBarbarianChance: number; // 0-100, chance for land barbarians
  seaBarbarianChance: number; // 0-100, chance for sea barbarians
  minDistanceFromCity: number; // Minimum distance from cities to spawn
  maxDistanceFromCity: number; // Maximum distance from cities to spawn
  unitsPerSpawn: { min: number; max: number }; // Range of units to spawn
  leaderChance: number; // 0-100, chance to spawn a leader unit
}

export enum BarbarianType {
  LAND_BARBARIAN = 'land',
  SEA_BARBARIAN = 'sea',
  LAND_AND_SEA_BARBARIAN = 'mixed',
}

export interface BarbarianSpawn {
  success: boolean;
  location: BarbarianSpawnLocation;
  barbarianPlayerId?: string;
  unitsCreated: number;
  spawnType: BarbarianType;
  unitIds: string[];
  error?: string;
}

export interface BarbarianSpawnResult {
  totalSpawns: number;
  successfulSpawns: number;
  spawns: BarbarianSpawn[];
  mapFactor: number; // Used for spawn rate calculation
}

export interface BarbarianTribe {
  id: string;
  playerId: string;
  spawnTurn: number;
  spawnLocation: BarbarianSpawnLocation;
  type: BarbarianType;
  unitIds: string[];
  isActive: boolean;
  lastSeenTurn: number;
}

export class BarbarianManager {
  private gameId: string;
  private config: BarbarianSpawnConfig;
  // private unitManager: UnitManager; // Placeholder for future use
  // private mapManager: MapManager; // Placeholder for future use
  // private broadcastManager: GameBroadcastManager; // Placeholder for future use
  private databaseProvider: DatabaseProvider;

  private activeBarbarians: Map<string, BarbarianTribe> = new Map();

  // Constants from freeciv/server/barbarian.c
  private static readonly MAP_FACTOR = 2000; // Used to calculate spawn frequency
  // private static readonly MIN_UNREST_DIST = 3; // Minimum distance from cities - for future use
  // private static readonly MAX_UNREST_DIST = 8; // Maximum distance from cities - for future use

  constructor(
    gameId: string,
    config: BarbarianSpawnConfig,
    _unitManager: UnitManager,
    _mapManager: MapManager,
    _broadcastManager: GameBroadcastManager,
    databaseProvider: DatabaseProvider
  ) {
    this.gameId = gameId;
    this.config = config;
    // this.unitManager = unitManager; // Placeholder for future use
    // this.mapManager = mapManager; // Placeholder for future use
    // this.broadcastManager = broadcastManager; // Placeholder for future use
    this.databaseProvider = databaseProvider;
  }

  /**
   * Spawn barbarians for the current turn
   * @reference freeciv/server/barbarian.c:738 summon_barbarians()
   */
  async spawnBarbarians(turn: number): Promise<BarbarianSpawnResult> {
    const result: BarbarianSpawnResult = {
      totalSpawns: 0,
      successfulSpawns: 0,
      spawns: [],
      mapFactor: 0,
    };

    // Check if barbarians are disabled or it's too early
    if (this.config.rate === 0 || turn < this.config.onsetTurn) {
      return result;
    }

    logger.debug('Spawning barbarians', {
      gameId: this.gameId,
      turn,
      rate: this.config.rate,
    });

    try {
      // Calculate number of spawn attempts based on map size and rate (placeholder)
      const mapSize = 10000; // await this.mapManager.getMapSize();
      const mapFactor = Math.max(1, Math.floor(mapSize / BarbarianManager.MAP_FACTOR));
      const spawnAttempts = mapFactor * (this.config.rate - 1);

      result.mapFactor = mapFactor;

      logger.debug('Barbarian spawn calculation', {
        gameId: this.gameId,
        mapSize,
        mapFactor,
        spawnAttempts,
      });

      // Attempt to spawn barbarians
      for (let i = 0; i < spawnAttempts; i++) {
        const spawn = await this.attemptBarbarianSpawn(turn);
        result.spawns.push(spawn);
        result.totalSpawns++;

        if (spawn.success) {
          result.successfulSpawns++;
          await this.recordBarbarianSpawn(spawn, turn);
        }
      }

      logger.info('Barbarian spawning completed', {
        gameId: this.gameId,
        turn,
        totalAttempts: result.totalSpawns,
        successfulSpawns: result.successfulSpawns,
      });
    } catch (error) {
      logger.error('Error in barbarian spawning', {
        gameId: this.gameId,
        turn,
        error: error instanceof Error ? error.message : error,
      });
    }

    return result;
  }

  /**
   * Attempt to spawn a single barbarian group
   * @reference freeciv/server/barbarian.c:587 try_summon_barbarians()
   */
  private async attemptBarbarianSpawn(_turn: number): Promise<BarbarianSpawn> {
    const spawn: BarbarianSpawn = {
      success: false,
      location: {} as BarbarianSpawnLocation,
      spawnType: BarbarianType.LAND_BARBARIAN,
      unitsCreated: 0,
      unitIds: [],
    };

    try {
      // 1. Find suitable spawn location (placeholder)
      const location = null; // await this.findBarbarianSpawnLocation();
      if (!location) {
        spawn.error = 'No suitable spawn location found';
        return spawn;
      }

      spawn.location = location;

      // 2. Determine barbarian type based on location
      spawn.spawnType = this.determineBarbarianType(location || ({} as BarbarianSpawnLocation));

      // 3. Create or get barbarian player
      const barbarianPlayerId = await this.getOrCreateBarbarianPlayer(spawn.spawnType);
      if (!barbarianPlayerId) {
        spawn.error = 'Failed to create barbarian player';
        return spawn;
      }

      spawn.barbarianPlayerId = barbarianPlayerId;

      // 4. Spawn barbarian units
      const unitsSpawned = await this.spawnBarbarianUnits(
        barbarianPlayerId,
        location,
        spawn.spawnType
      );

      spawn.unitsCreated = unitsSpawned.length;
      spawn.unitIds = unitsSpawned;
      spawn.success = unitsSpawned.length > 0;

      if (spawn.success) {
        logger.debug('Barbarian spawn successful', {
          gameId: this.gameId,
          location: spawn.location,
          type: spawn.spawnType,
          unitsCreated: spawn.unitsCreated,
        });
      }
    } catch (error) {
      spawn.error = error instanceof Error ? error.message : String(error);
      logger.error('Error in barbarian spawn attempt', {
        gameId: this.gameId,
        error: spawn.error,
      });
    }

    return spawn;
  }

  // PLACEHOLDER: Find a suitable location for barbarian spawning
  // This method would be implemented when MapManager has the required methods
  // @reference freeciv/server/barbarian.c:587-650 location finding logic

  /**
   * Determine barbarian type based on spawn location
   */
  private determineBarbarianType(location: BarbarianSpawnLocation): BarbarianType {
    const landRoll = Math.random() * 100;
    const seaRoll = Math.random() * 100;

    const canSpawnLand = location.isLand && landRoll < this.config.landBarbarianChance;
    const canSpawnSea = location.isSea && seaRoll < this.config.seaBarbarianChance;

    if (canSpawnLand && canSpawnSea) {
      return BarbarianType.LAND_AND_SEA_BARBARIAN;
    } else if (canSpawnSea) {
      return BarbarianType.SEA_BARBARIAN;
    } else {
      return BarbarianType.LAND_BARBARIAN;
    }
  }

  /**
   * Get existing or create new barbarian player
   * @reference freeciv/server/barbarian.c:425 create_barbarian_player()
   */
  private async getOrCreateBarbarianPlayer(_type: BarbarianType): Promise<string | null> {
    try {
      // Check if we have an existing barbarian player of this type
      // const existingBarbarian = await this.findAvailableBarbarianPlayer(type);
      // if (existingBarbarian) {
      //   return existingBarbarian;
      // }

      // Create new barbarian player (placeholder)
      // const barbarianPlayerId = await this.createBarbarianPlayer(type);
      return null; // barbarianPlayerId;
    } catch (error) {
      logger.error('Error getting/creating barbarian player', {
        gameId: this.gameId,
        type: _type,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  // PLACEHOLDER: Find an available barbarian player of the specified type
  // This method would be implemented in a full barbarian system

  // PLACEHOLDER: Create a new barbarian player/civilization
  // This method would be implemented when player/civilization system is ready

  /**
   * Spawn barbarian units at the specified location
   * @reference freeciv/server/barbarian.c:650-737 unit creation
   */
  private async spawnBarbarianUnits(
    barbarianPlayerId: string,
    location: BarbarianSpawnLocation,
    type: BarbarianType
  ): Promise<string[]> {
    const unitIds: string[] = [];

    try {
      // Determine number of units to spawn
      const unitCount =
        Math.floor(
          Math.random() * (this.config.unitsPerSpawn.max - this.config.unitsPerSpawn.min + 1)
        ) + this.config.unitsPerSpawn.min;

      // Get appropriate unit types for barbarians
      const unitTypes = await this.getBarbarianUnitTypes(type);

      // Spawn leader unit (if chance permits)
      const shouldSpawnLeader = Math.random() * 100 < this.config.leaderChance;
      if (shouldSpawnLeader) {
        const leaderId = await this.spawnBarbarianUnit(
          barbarianPlayerId,
          location,
          'barbarian_leader'
        );
        if (leaderId) {
          unitIds.push(leaderId);
        }
      }

      // Spawn regular units
      for (let i = 0; i < unitCount; i++) {
        const unitType = unitTypes[Math.floor(Math.random() * unitTypes.length)];
        const unitId = await this.spawnBarbarianUnit(barbarianPlayerId, location, unitType);

        if (unitId) {
          unitIds.push(unitId);
        }
      }

      logger.debug('Barbarian units spawned', {
        gameId: this.gameId,
        barbarianPlayerId,
        location,
        type,
        unitsCreated: unitIds.length,
        hasLeader: shouldSpawnLeader,
      });
    } catch (error) {
      logger.error('Error spawning barbarian units', {
        gameId: this.gameId,
        barbarianPlayerId,
        location,
        type,
        error: error instanceof Error ? error.message : error,
      });
    }

    return unitIds;
  }

  /**
   * Get appropriate unit types for barbarian spawning
   */
  private async getBarbarianUnitTypes(type: BarbarianType): Promise<string[]> {
    // This would be loaded from rulesets/configuration
    // For now, return basic barbarian unit types

    const landUnits = ['warriors', 'archers', 'horsemen'];
    const seaUnits = ['trireme', 'galley'];

    switch (type) {
      case BarbarianType.SEA_BARBARIAN:
        return seaUnits;
      case BarbarianType.LAND_AND_SEA_BARBARIAN:
        return [...landUnits, ...seaUnits];
      case BarbarianType.LAND_BARBARIAN:
      default:
        return landUnits;
    }
  }

  /**
   * Spawn a single barbarian unit
   */
  private async spawnBarbarianUnit(
    _barbarianPlayerId: string,
    _location: BarbarianSpawnLocation,
    _unitType: string
  ): Promise<string | null> {
    try {
      // Placeholder implementation
      // const unitId = await this.unitManager.createUnit({
      //   playerId: barbarianPlayerId,
      //   type: unitType,
      //   position: { x: location.x, y: location.y },
      //   tileId: location.tileId,
      //   isBarbarianUnit: true,
      // });

      return null; // unitId;
    } catch (error) {
      logger.error('Error spawning barbarian unit', {
        gameId: this.gameId,
        barbarianPlayerId: _barbarianPlayerId,
        unitType: _unitType,
        location: _location,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Record successful barbarian spawn in database and memory
   */
  private async recordBarbarianSpawn(spawn: BarbarianSpawn, turn: number): Promise<void> {
    if (!spawn.success || !spawn.barbarianPlayerId) {
      return;
    }

    const tribe: BarbarianTribe = {
      id: `barbarian_tribe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      playerId: spawn.barbarianPlayerId,
      spawnTurn: turn,
      spawnLocation: spawn.location,
      type: spawn.spawnType,
      unitIds: spawn.unitIds,
      isActive: true,
      lastSeenTurn: turn,
    };

    // Store in memory
    this.activeBarbarians.set(tribe.id, tribe);

    // Store in database
    try {
      await this.databaseProvider
        .getDatabase()
        .insert(barbarianTribes)
        .values({
          gameId: this.gameId,
          playerId: tribe.playerId,
          name: this.generateBarbarianName(tribe.type),
          type: tribe.type,
          spawnTurn: tribe.spawnTurn,
          spawnLocation: tribe.spawnLocation,
          unitIds: tribe.unitIds,
          isActive: tribe.isActive,
          lastSeenTurn: tribe.lastSeenTurn,
        });
    } catch (error) {
      logger.error('Error recording barbarian spawn in database', {
        gameId: this.gameId,
        tribeId: tribe.id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Generate a name for barbarian civilization
   */
  private generateBarbarianName(type: BarbarianType): string {
    const landNames = ['Vandals', 'Visigoths', 'Huns', 'Mongols', 'Celts', 'Saxons'];
    const seaNames = ['Sea Peoples', 'Pirates', 'Raiders', 'Corsairs', 'Vikings'];

    const names = type === BarbarianType.SEA_BARBARIAN ? seaNames : landNames;
    return names[Math.floor(Math.random() * names.length)];
  }

  /**
   * Get all active barbarian tribes
   */
  getActiveBarbarians(): BarbarianTribe[] {
    return Array.from(this.activeBarbarians.values()).filter(tribe => tribe.isActive);
  }

  /**
   * Update barbarian configuration
   */
  updateConfig(newConfig: Partial<BarbarianSpawnConfig>): void {
    this.config = { ...this.config, ...newConfig };

    logger.debug('Barbarian configuration updated', {
      gameId: this.gameId,
      config: this.config,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): BarbarianSpawnConfig {
    return { ...this.config };
  }
}
