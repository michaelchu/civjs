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
import { randomInt, type RandomSource } from '@game/random/FreecivRandom';
import type { Unit, UnitManager } from './UnitManager';
import type { MapManager } from './MapManager';
import type { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import type { DatabaseProvider } from '@database/DatabaseProvider';
import { barbarianTribes, players } from '@database/schema';
import { and, eq } from 'drizzle-orm';
import { createAIState } from '@game/ai/AIStateStore';
import { ActionType } from '@app-types/shared/actions';
import type { MapTile } from '@game/map/MapTypes';
import { canUnitEnterTerrain } from '@game/constants/MovementConstants';

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
  allowHutBarbarians?: boolean;
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
  private databaseProvider: DatabaseProvider;

  private activeBarbarians: Map<string, BarbarianTribe> = new Map();

  // Constants from freeciv/server/barbarian.c
  private static readonly MAP_FACTOR = 2000; // Used to calculate spawn frequency
  // private static readonly MIN_UNREST_DIST = 3; // Minimum distance from cities - for future use
  // private static readonly MAX_UNREST_DIST = 8; // Maximum distance from cities - for future use

  constructor(
    gameId: string,
    config: BarbarianSpawnConfig,
    private readonly unitManager: UnitManager,
    private readonly mapManager: MapManager,
    _broadcastManager: GameBroadcastManager,
    databaseProvider: DatabaseProvider,
    private readonly random: RandomSource = Math.random,
    private readonly playerFactory?: (type: BarbarianType) => Promise<string | null>
  ) {
    this.gameId = gameId;
    this.config = config;
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

    await this.manageActiveBarbarianUnits();

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
      // Calculate number of spawn attempts based on map size and rate
      // @reference freeciv/server/barbarian.c:751 n = map_num_tiles() / MAP_FACTOR;
      const mapData = this.mapManager.getMapData();
      const mapSize = mapData ? mapData.width * mapData.height : 0;
      if (mapSize === 0) return result;
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
   * Unleash a hut horde at the hut tile. The result indicates whether the
   * explorer survives: protected, disabled, and failed spawns return true;
   * a successful horde returns false.
   * @reference reference/freeciv/data/default/default.lua:103-130
   */
  async unleashBarbariansAt(x: number, y: number): Promise<boolean> {
    if (this.config.allowHutBarbarians === false) return true;
    const map = this.mapManager.getMapData();
    if (!map) return true;
    const tile = map?.tiles.flat().find(candidate => candidate.x === x && candidate.y === y);
    if (!tile) return true;

    const cityTiles = map.tiles.flat().filter(candidate => candidate.cityId);
    if (cityTiles.some(city => this.mapManager.getDistance(x, y, city.x, city.y) <= 2)) {
      return true;
    }

    const location: BarbarianSpawnLocation = {
      x,
      y,
      tileId: `${x},${y}`,
      terrain: String(tile.terrain),
      isLand: tile.continentId > 0,
      isSea: tile.continentId === 0,
      distanceToNearestCity:
        cityTiles.length === 0
          ? this.config.maxDistanceFromCity
          : Math.min(...cityTiles.map(city => this.mapManager.getDistance(x, y, city.x, city.y))),
    };
    const type = location.isLand ? BarbarianType.LAND_BARBARIAN : BarbarianType.SEA_BARBARIAN;
    const barbarianPlayerId = await this.getOrCreateBarbarianPlayer(type);
    if (!barbarianPlayerId) return true;
    const unitIds = await this.spawnBarbarianUnits(barbarianPlayerId, location, type);
    return unitIds.length === 0;
  }

  /**
   * Existing uprisings remain aggressive even on turns where no new group is
   * summoned. Land units pillage first, then attack adjacent foreigners, then
   * advance toward the nearest city; leaders stay with their stack.
   *
   * @reference reference/freeciv/ai/default/daiunit.c:dai_military_findjob
   * @reference reference/freeciv/ai/default/daiunit.c:dai_manage_barbarian_leader
   */
  private isBarbarianLeader(unit: Unit): boolean {
    return Boolean(
      this.unitManager.getUnitType(unit.unitTypeId)?.roles?.includes('BarbarianLeader')
    );
  }

  private closestBarbarianGuard(unit: Unit, warriors: Unit[]): Unit | undefined {
    return warriors
      .slice()
      .sort(
        (left, right) =>
          this.mapManager.getDistance(unit.x, unit.y, left.x, left.y) -
            this.mapManager.getDistance(unit.x, unit.y, right.x, right.y) ||
          left.id.localeCompare(right.id)
      )[0];
  }

  private async manageBarbarianLeader(
    unit: Unit,
    warriors: Unit[],
    playerId: string
  ): Promise<void> {
    const guard = this.closestBarbarianGuard(unit, warriors);
    const shouldRendezvous = Boolean(guard && (guard.x !== unit.x || guard.y !== unit.y));
    const action = shouldRendezvous ? ActionType.GOTO : ActionType.SENTRY;
    const targetX = shouldRendezvous ? guard!.x : undefined;
    const targetY = shouldRendezvous ? guard!.y : undefined;
    if (!this.unitManager.canUnitPerformAction(unit.id, action, targetX, targetY)) return;
    await this.unitManager.executeUnitAction(unit.id, action, targetX, targetY, playerId);
  }

  private async manageBarbarianWarrior(
    unit: Unit,
    cityTiles: MapTile[] | undefined,
    playerId: string
  ): Promise<void> {
    if (this.unitManager.canUnitPerformAction(unit.id, ActionType.PILLAGE)) {
      const result = await this.unitManager.executeUnitAction(
        unit.id,
        ActionType.PILLAGE,
        undefined,
        undefined,
        playerId
      );
      if (result.success) return;
    }
    const adjacent = Array.from(this.unitManager.getAllUnits().values())
      .filter(other => other.playerId !== playerId)
      .find(other => this.mapManager.getDistance(unit.x, unit.y, other.x, other.y) <= 1);
    if (adjacent) {
      await this.unitManager.attackUnit(unit.id, adjacent.id);
      return;
    }
    const target = cityTiles
      ?.slice()
      .sort(
        (left, right) =>
          this.mapManager.getDistance(unit.x, unit.y, left.x, left.y) -
            this.mapManager.getDistance(unit.x, unit.y, right.x, right.y) ||
          left.x - right.x ||
          left.y - right.y
      )[0];
    if (!target) return;
    if (!this.unitManager.canUnitPerformAction(unit.id, ActionType.GOTO, target.x, target.y))
      return;
    await this.unitManager.executeUnitAction(
      unit.id,
      ActionType.GOTO,
      target.x,
      target.y,
      playerId
    );
  }

  private async manageActiveBarbarianUnits(): Promise<void> {
    const cityTiles = this.mapManager
      .getMapData()
      ?.tiles.flat()
      .filter(tile => tile.cityId);
    for (const tribe of this.getActiveBarbarians()) {
      const units = tribe.unitIds
        .map(id => this.unitManager.getUnit(id))
        .filter((unit): unit is Unit => Boolean(unit));
      const warriors = units.filter(unit => !this.isBarbarianLeader(unit));
      for (const unit of units) {
        if (unit.movementLeft <= 0) continue;
        if (this.isBarbarianLeader(unit)) {
          await this.manageBarbarianLeader(unit, warriors, tribe.playerId);
        } else {
          await this.manageBarbarianWarrior(unit, cityTiles, tribe.playerId);
        }
      }
    }
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
      const location = this.findBarbarianSpawnLocation();
      if (!location) {
        spawn.error = 'No suitable spawn location found';
        return spawn;
      }

      spawn.location = location;

      // 2. Determine barbarian type based on location
      spawn.spawnType = this.determineBarbarianType(location);

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

  /**
   * Choose an unoccupied wilderness tile in the configured city-distance
   * band. City tiles are read from the authoritative map snapshot.
   *
   * @reference freeciv/server/barbarian.c:587-650
   */
  private findBarbarianSpawnLocation(): BarbarianSpawnLocation | null {
    const map = this.mapManager.getMapData();
    if (!map) return null;
    const tiles = map.tiles.flat();
    const cityTiles = tiles.filter(tile => tile.cityId);
    const occupied = new Set(
      Array.from(this.unitManager.getAllUnits().values()).map(unit => `${unit.x},${unit.y}`)
    );
    const candidates = tiles
      .filter(tile => !tile.cityId && !occupied.has(`${tile.x},${tile.y}`))
      .map(tile => {
        const nearest =
          cityTiles.length === 0
            ? this.config.maxDistanceFromCity
            : Math.min(
                ...cityTiles.map(city =>
                  this.mapManager.getDistance(tile.x, tile.y, city.x, city.y)
                )
              );
        return {
          x: tile.x,
          y: tile.y,
          tileId: `${tile.x},${tile.y}`,
          terrain: String(tile.terrain),
          isLand: tile.continentId > 0,
          isSea: tile.continentId === 0,
          distanceToNearestCity: nearest,
        };
      })
      .filter(
        location =>
          location.distanceToNearestCity >= this.config.minDistanceFromCity &&
          location.distanceToNearestCity <= this.config.maxDistanceFromCity
      )
      .sort((left, right) => left.x - right.x || left.y - right.y);
    return candidates.length > 0 ? candidates[randomInt(this.random, candidates.length)]! : null;
  }

  /**
   * Determine barbarian type based on spawn location
   */
  private determineBarbarianType(location: BarbarianSpawnLocation): BarbarianType {
    const landRoll = randomInt(this.random, 100);
    const seaRoll = randomInt(this.random, 100);

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
      if (this.playerFactory) return this.playerFactory(_type);
      const database = this.databaseProvider.getDatabase();
      const civilization = `barbarian-${_type}`;
      const existing = await database.query.players.findFirst({
        where: and(eq(players.gameId, this.gameId), eq(players.civilization, civilization)),
      });
      if (existing) return existing.id;
      const existingPlayers = await database.query.players.findMany({
        where: eq(players.gameId, this.gameId),
      });
      const playerNumber =
        existingPlayers.reduce((highest, player) => Math.max(highest, player.playerNumber), -1) + 1;
      const [created] = await database
        .insert(players)
        .values({
          gameId: this.gameId,
          userId: null,
          playerNumber,
          nation: 'barbarian',
          civilization,
          leaderName: this.generateBarbarianName(_type),
          color: { r: 128, g: 32, b: 32 },
          isAI: true,
          aiLevel: 'hard',
          aiState: createAIState(),
          isReady: true,
          connectionStatus: 'connected',
        })
        .returning();
      return created?.id ?? null;
    } catch (error) {
      logger.error('Error getting/creating barbarian player', {
        gameId: this.gameId,
        type: _type,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Spawn barbarian units at the specified location
   * @reference freeciv/server/barbarian.c:650-737 unit creation
   */
  private async spawnBarbarianUnits(
    barbarianPlayerId: string,
    location: BarbarianSpawnLocation,
    type: BarbarianType
  ): Promise<string[]> {
    if (type === BarbarianType.SEA_BARBARIAN) {
      return this.spawnSeaBarbarianUnits(barbarianPlayerId, location);
    }

    const unitIds: string[] = [];

    try {
      // Determine number of units to spawn
      const unitCount =
        randomInt(this.random, this.config.unitsPerSpawn.max - this.config.unitsPerSpawn.min + 1) +
        this.config.unitsPerSpawn.min;

      // Get appropriate unit types for barbarians
      const unitTypes = await this.getBarbarianUnitTypes(type);

      // Spawn leader unit (if chance permits)
      const shouldSpawnLeader = randomInt(this.random, 100) < this.config.leaderChance;
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
        const unitType = unitTypes[randomInt(this.random, unitTypes.length)];
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
   * Sea uprisings use a transport and keep all land units embarked.
   * @reference reference/freeciv/server/barbarian.c:643-698
   */
  private async spawnSeaBarbarianUnits(
    barbarianPlayerId: string,
    location: BarbarianSpawnLocation
  ): Promise<string[]> {
    const unitIds: string[] = [];
    const boatType = this.findBarbarianRoleUnit('BarbarianBoat', ['trireme']);
    const boatDefinition = boatType ? this.unitManager.getUnitType(boatType) : undefined;
    if (!this.canSeaBarbariansUseBoat(boatType, boatDefinition, location)) {
      return unitIds;
    }

    const boatId = await this.spawnBarbarianUnit(barbarianPlayerId, location, boatType!);
    if (!boatId) return unitIds;
    unitIds.push(boatId);

    const capacity = boatDefinition!.transport_capacity ?? 0;
    const unitCount =
      randomInt(this.random, this.config.unitsPerSpawn.max - this.config.unitsPerSpawn.min + 1) +
      this.config.unitsPerSpawn.min;
    const seaUnitType = this.findBarbarianRoleUnit('BarbarianSea', [
      'warriors',
      'archers',
      'horsemen',
    ]);
    let remainingCapacity = capacity;

    // Reserve one berth for the leader, as Freeciv does for sea raiders.
    remainingCapacity = await this.spawnEmbarkedSeaUnits(
      unitIds,
      barbarianPlayerId,
      location,
      boatId,
      seaUnitType,
      unitCount,
      remainingCapacity
    );

    const shouldSpawnLeader = randomInt(this.random, 100) < this.config.leaderChance;
    await this.spawnEmbarkedLeader(
      unitIds,
      barbarianPlayerId,
      location,
      boatId,
      shouldSpawnLeader,
      remainingCapacity
    );

    return unitIds;
  }

  private canSeaBarbariansUseBoat(
    boatType: string | undefined,
    boatDefinition: { transport_capacity?: number } | undefined,
    location: BarbarianSpawnLocation
  ): boolean {
    return Boolean(
      boatType &&
      boatDefinition &&
      (boatDefinition.transport_capacity ?? 0) > 0 &&
      canUnitEnterTerrain(location.terrain, boatType)
    );
  }

  private async spawnEmbarkedSeaUnits(
    unitIds: string[],
    barbarianPlayerId: string,
    location: BarbarianSpawnLocation,
    boatId: string,
    seaUnitType: string | undefined,
    unitCount: number,
    capacity: number
  ): Promise<number> {
    if (!seaUnitType) return capacity;

    const count = Math.min(unitCount, Math.max(0, capacity - 1));
    let remainingCapacity = capacity;
    for (let i = 0; i < count; i++) {
      const unitId = await this.spawnBarbarianUnit(
        barbarianPlayerId,
        location,
        seaUnitType,
        boatId
      );
      if (unitId) {
        unitIds.push(unitId);
        remainingCapacity--;
      }
    }
    return remainingCapacity;
  }

  private async spawnEmbarkedLeader(
    unitIds: string[],
    barbarianPlayerId: string,
    location: BarbarianSpawnLocation,
    boatId: string,
    shouldSpawnLeader: boolean,
    capacity: number
  ): Promise<void> {
    if (!shouldSpawnLeader || capacity <= 0) return;

    const leaderId = await this.spawnBarbarianUnit(
      barbarianPlayerId,
      location,
      'barbarian_leader',
      boatId
    );
    if (leaderId) unitIds.push(leaderId);
  }

  private findBarbarianRoleUnit(role: string, fallbacks: string[]): string | undefined {
    const getUnitTypes = (
      this.unitManager as UnitManager & {
        getUnitTypes?: () => Readonly<Record<string, { id: string; roles?: string[] }>>;
      }
    ).getUnitTypes;
    const roleUnit = getUnitTypes?.call(this.unitManager);
    const matchingUnit = roleUnit
      ? Object.values(roleUnit).find(unit => unit.roles?.includes(role))
      : undefined;
    if (matchingUnit) return matchingUnit.id;
    return fallbacks.find(unitType => Boolean(this.unitManager.getUnitType(unitType)));
  }

  /**
   * Get appropriate unit types for barbarian spawning
   */
  private async getBarbarianUnitTypes(type: BarbarianType): Promise<string[]> {
    const landUnits = ['warriors', 'archers', 'horsemen'];

    switch (type) {
      case BarbarianType.SEA_BARBARIAN:
        return [this.findBarbarianRoleUnit('BarbarianSea', landUnits)].filter(
          (unitType): unitType is string => Boolean(unitType)
        );
      case BarbarianType.LAND_AND_SEA_BARBARIAN:
        return landUnits;
      case BarbarianType.LAND_BARBARIAN:
      default:
        return [this.findBarbarianRoleUnit('Barbarian', landUnits)].filter(
          (unitType): unitType is string => Boolean(unitType)
        );
    }
    return [];
  }

  /**
   * Spawn a single barbarian unit
   */
  private async spawnBarbarianUnit(
    barbarianPlayerId: string,
    location: BarbarianSpawnLocation,
    unitType: string,
    transportedBy?: string
  ): Promise<string | null> {
    try {
      if (!this.unitManager.getUnitType(unitType)) return null;
      const unit = transportedBy
        ? await this.unitManager.createUnit(
            barbarianPlayerId,
            unitType,
            location.x,
            location.y,
            undefined,
            transportedBy
          )
        : await this.unitManager.createUnit(barbarianPlayerId, unitType, location.x, location.y);
      return unit.id;
    } catch (error) {
      logger.error('Error spawning barbarian unit', {
        gameId: this.gameId,
        barbarianPlayerId,
        unitType,
        location,
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
      id: `${spawn.barbarianPlayerId}:${turn}:${spawn.location.tileId}`,
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
    return names[randomInt(this.random, names.length)];
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
