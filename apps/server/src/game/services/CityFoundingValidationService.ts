/**
 * City founding validation service based on Freeciv reference implementation
 * References and ports key validation logic from freeciv/common/city.c
 */

import { logger } from '@utils/logger';
import { MapTile, TerrainType } from '@game/map/MapTypes';
import type { Unit } from '@game/managers/UnitManager';
import type { CityState } from '@game/managers/CityManager';
import type { MapManager } from '@game/managers/MapManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { CityFoundingRules } from '@shared/data/rulesets/schemas';

// Game constants from freeciv reference
// Reference: freeciv/common/game.h:492-494
export const GAME_DEFAULT_CITYMINDIST = 2;
export const GAME_MIN_CITYMINDIST = 1;
export const GAME_MAX_CITYMINDIST = 11;

// Action types for city founding
// Reference: freeciv/common/actions.h ACTION_FOUND_CITY
export enum ActionType {
  FOUND_CITY = 'FOUND_CITY',
}

export interface CityFoundingValidationResult {
  canFound: boolean;
  errorMessage?: string;
  errorCode?: CityFoundingErrorCode;
}

export enum CityFoundingErrorCode {
  TERRAIN_NO_CITIES = 'TERRAIN_NO_CITIES',
  CITYMINDIST_VIOLATION = 'CITYMINDIST_VIOLATION',
  EXISTING_CITY = 'EXISTING_CITY',
  UNIT_NOT_FOUND = 'UNIT_NOT_FOUND',
  UNIT_WRONG_OWNER = 'UNIT_WRONG_OWNER',
  UNIT_NOT_SETTLER = 'UNIT_NOT_SETTLER',
  UNIT_CANNOT_EXIST = 'UNIT_CANNOT_EXIST',
  TILE_FOREIGN_OWNED = 'TILE_FOREIGN_OWNED',
  ENEMY_UNIT_PRESENT = 'ENEMY_UNIT_PRESENT',
  TILE_UNKNOWN = 'TILE_UNKNOWN',
  TILE_NOT_EXPLORED = 'TILE_NOT_EXPLORED',
  INVALID_COORDINATES = 'INVALID_COORDINATES',
}

/**
 * Comprehensive city founding validation service
 * Ports validation logic from freeciv/common/city.c and freeciv/server/citytools.c
 */
export class CityFoundingValidationService {
  private mapManager: MapManager;
  private citymindist: number;
  private rulesetName: string;
  private foundingRules: CityFoundingRules;

  constructor(
    mapManager: MapManager,
    citymindist: number = GAME_DEFAULT_CITYMINDIST,
    rulesetName: string = 'classic'
  ) {
    this.mapManager = mapManager;
    this.citymindist = Math.max(GAME_MIN_CITYMINDIST, Math.min(GAME_MAX_CITYMINDIST, citymindist));
    this.rulesetName = rulesetName;
    this.foundingRules = rulesetLoader.getCityFoundingRules(rulesetName);
    logger.debug(`CityFoundingValidationService initialized with ruleset: ${rulesetName}`);
  }

  /**
   * Main validation entry point - ports city_can_be_built_here()
   * Reference: freeciv/common/city.c:1487-1551 city_can_be_built_here()
   */
  public validateCityFounding(
    x: number,
    y: number,
    unit: Unit | null,
    playerId: string,
    existingCities: Map<string, CityState>,
    hut_test: boolean = false
  ): CityFoundingValidationResult {
    // Validate coordinates first
    if (!this.mapManager.isValidPosition(x, y)) {
      return {
        canFound: false,
        errorMessage: `Invalid coordinates (${x}, ${y}) - outside map bounds`,
        errorCode: CityFoundingErrorCode.INVALID_COORDINATES,
      };
    }

    // Basic tile-only validation
    // Reference: freeciv/common/city.c:1492-1494
    const tileValidation = this.validateCityFoundingTileOnly(x, y, existingCities);
    if (!tileValidation.canFound) {
      return tileValidation;
    }

    // If no unit provided, only tile validation matters
    // Reference: freeciv/common/city.c:1496-1499
    if (unit === null) {
      return { canFound: true };
    }

    // Hut test has special rules
    // Reference: freeciv/common/city.c:1501-1518
    if (hut_test) {
      return this.validateHutCityFounding(x, y, unit, playerId);
    }

    // Full unit-based validation for normal city founding
    const unitValidation = this.validateUnitCityFounding(x, y, unit, playerId);
    if (!unitValidation.canFound) {
      return unitValidation;
    }

    // Map visibility validation - cities can only be founded on explored tiles
    const visibilityValidation = this.validateTileExploration(x, y, playerId);
    if (!visibilityValidation.canFound) {
      return visibilityValidation;
    }

    return { canFound: true };
  }

  /**
   * Tile-only validation - ports city_can_be_built_tile_only()
   * Reference: freeciv/common/city.c:1560-1573 city_can_be_built_tile_only()
   */
  private validateCityFoundingTileOnly(
    x: number,
    y: number,
    existingCities: Map<string, CityState>
  ): CityFoundingValidationResult {
    const tile = this.mapManager.getTile(x, y);
    if (!tile) {
      return {
        canFound: false,
        errorMessage: `Tile at (${x}, ${y}) not found`,
        errorCode: CityFoundingErrorCode.INVALID_COORDINATES,
      };
    }

    // Check for TER_NO_CITIES flag using ruleset
    // Reference: freeciv/common/city.c:1563-1566
    if (this.foundingRules.no_cities_terrains.includes(tile.terrain)) {
      return {
        canFound: false,
        errorMessage: `Cannot found city on ${tile.terrain} terrain - terrain does not support cities`,
        errorCode: CityFoundingErrorCode.TERRAIN_NO_CITIES,
      };
    }

    // Check existing city at this location
    if (tile.cityId) {
      return {
        canFound: false,
        errorMessage: `Cannot found city at (${x}, ${y}) - city already exists`,
        errorCode: CityFoundingErrorCode.EXISTING_CITY,
      };
    }

    // Check citymindist violations
    // Reference: freeciv/common/city.c:1568-1570
    if (this.citymindistPreventsCityOnTile(x, y, existingCities)) {
      return {
        canFound: false,
        errorMessage: `Cannot found city at (${x}, ${y}) - too close to existing city (minimum distance: ${this.citymindist})`,
        errorCode: CityFoundingErrorCode.CITYMINDIST_VIOLATION,
      };
    }

    return { canFound: true };
  }

  /**
   * Check citymindist rule - ports citymindist_prevents_city_on_tile()
   * Reference: freeciv/common/city.c:1465-1478 citymindist_prevents_city_on_tile()
   */
  private citymindistPreventsCityOnTile(
    x: number,
    y: number,
    existingCities: Map<string, CityState>
  ): boolean {
    // citymindist minimum is 1, meaning adjacent is okay
    // Reference: freeciv/common/city.c:1469
    const citymindist = this.citymindist;

    // square_iterate(nmap, ptile, citymindist - 1, ptile1) - check all tiles within citymindist-1
    // Reference: freeciv/common/city.c:1471-1475
    const radius = citymindist - 1;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const checkX = x + dx;
        const checkY = y + dy;

        // Check if there's a city at this position
        for (const city of existingCities.values()) {
          if (city.x === checkX && city.y === checkY) {
            return true; // City found within minimum distance
          }
        }
      }
    }

    return false;
  }

  /**
   * Validate hut-based city founding
   * Reference: freeciv/common/city.c:1501-1518
   */
  private validateHutCityFounding(
    x: number,
    y: number,
    unit: Unit,
    playerId: string
  ): CityFoundingValidationResult {
    const tile = this.mapManager.getTile(x, y);
    if (!tile) {
      return {
        canFound: false,
        errorMessage: `Tile at (${x}, ${y}) not found`,
        errorCode: CityFoundingErrorCode.INVALID_COORDINATES,
      };
    }

    // Huts can be found only from native tiles, owned by the unit owner
    // Reference: freeciv/common/city.c:1504-1509
    if (!this.canUnitExistAtTile(unit, tile)) {
      return {
        canFound: false,
        errorMessage: `Unit cannot exist at tile (${x}, ${y}) - not native terrain`,
        errorCode: CityFoundingErrorCode.UNIT_CANNOT_EXIST,
      };
    }

    // Check tile ownership for huts
    // Reference: freeciv/common/city.c:1511-1517
    const tileOwner = this.getTileOwner(tile);
    if (tileOwner !== null && tileOwner !== playerId) {
      return {
        canFound: false,
        errorMessage: `Cannot found city from hut on foreign territory`,
        errorCode: CityFoundingErrorCode.TILE_FOREIGN_OWNED,
      };
    }

    return { canFound: true };
  }

  /**
   * Validate normal unit-based city founding
   * Reference: freeciv/common/city.c:1520-1551
   */
  private validateUnitCityFounding(
    x: number,
    y: number,
    unit: Unit,
    playerId: string
  ): CityFoundingValidationResult {
    const tile = this.mapManager.getTile(x, y);
    if (!tile) {
      return {
        canFound: false,
        errorMessage: `Tile at (${x}, ${y}) not found`,
        errorCode: CityFoundingErrorCode.INVALID_COORDINATES,
      };
    }

    // Unit must be able to perform FOUND_CITY action
    // Reference: freeciv/common/city.c:1520-1524
    if (!this.unitCanDoAction(unit, ActionType.FOUND_CITY)) {
      return {
        canFound: false,
        errorMessage: `Unit type ${unit.unitTypeId} cannot found cities`,
        errorCode: CityFoundingErrorCode.UNIT_NOT_SETTLER,
      };
    }

    // Non-native tile detection
    // Reference: freeciv/common/city.c:1527-1534
    if (!this.canUnitExistAtTile(unit, tile)) {
      // Check if ruleset allows founding cities on non-native terrain
      const allowNonNative = this.canUnitFoundCityOnNonNativeTile(unit);
      if (!allowNonNative) {
        return {
          canFound: false,
          errorMessage: `Unit cannot exist at tile (${x}, ${y}) - not native terrain for city founding`,
          errorCode: CityFoundingErrorCode.UNIT_CANNOT_EXIST,
        };
      }
    }

    // Foreign tile detection
    // Reference: freeciv/common/city.c:1536-1545
    const tileOwner = this.getTileOwner(tile);
    if (tileOwner && tileOwner !== playerId) {
      // Check if ruleset allows founding cities on foreign terrain
      const allowForeignTerrain = this.canUnitFoundCityOnForeignTile(unit);
      if (!allowForeignTerrain) {
        return {
          canFound: false,
          errorMessage: `Cannot found city on foreign territory - borders must be settled by force`,
          errorCode: CityFoundingErrorCode.TILE_FOREIGN_OWNED,
        };
      }
    }

    return { canFound: true };
  }

  /**
   * Validate enemy units preventing city founding using ruleset
   * Reference: freeciv/server/citytools.c:580 (create_city_for_player)
   */
  public validateNoEnemyUnits(
    x: number,
    y: number,
    playerId: string,
    allUnits: Map<string, Unit>
  ): CityFoundingValidationResult {
    // If ruleset allows enemy units, skip this check
    if (!this.foundingRules.enemy_units_block) {
      return { canFound: true };
    }

    const tile = this.mapManager.getTile(x, y);
    if (!tile) {
      return {
        canFound: false,
        errorMessage: `Tile at (${x}, ${y}) not found`,
        errorCode: CityFoundingErrorCode.INVALID_COORDINATES,
      };
    }

    // Check for enemy units on the tile
    const enemyUnitsOnTile = tile.unitIds
      .map(unitId => allUnits.get(unitId))
      .filter((unit): unit is Unit => unit !== undefined && unit.playerId !== playerId);

    if (enemyUnitsOnTile.length > 0) {
      return {
        canFound: false,
        errorMessage: `Cannot found city at (${x}, ${y}) - enemy units present`,
        errorCode: CityFoundingErrorCode.ENEMY_UNIT_PRESENT,
      };
    }

    return { canFound: true };
  }

  /**
   * Validate tile exploration/visibility for city founding using ruleset
   * Cities must be founded on tiles that have been explored by the player
   */
  private validateTileExploration(
    x: number,
    y: number,
    _playerId: string
  ): CityFoundingValidationResult {
    // Skip exploration check if ruleset doesn't require it
    if (this.foundingRules.exploration_requirement === 0) {
      return { canFound: true };
    }

    const tile = this.mapManager.getTile(x, y);
    if (!tile) {
      return {
        canFound: false,
        errorMessage: `Tile at (${x}, ${y}) not found`,
        errorCode: CityFoundingErrorCode.INVALID_COORDINATES,
      };
    }

    // Check exploration requirement level
    // 1 = tile must be seen, 2 = tile must be explored
    if (this.foundingRules.exploration_requirement >= 1 && !tile.isExplored) {
      return {
        canFound: false,
        errorMessage: `Cannot found city at (${x}, ${y}) - tile has not been explored`,
        errorCode: CityFoundingErrorCode.TILE_NOT_EXPLORED,
      };
    }

    return { canFound: true };
  }

  /**
   * Check if unit can exist at tile (native terrain check)
   * Simplified version of freeciv/common/unit.c can_unit_exist_at_tile()
   */
  private canUnitExistAtTile(unit: Unit, tile: MapTile): boolean {
    // Simplified implementation - in a full version this would check
    // unit type movement class against terrain

    // Land units can exist on land terrains
    if (this.isLandUnit(unit) && this.isLandTerrain(tile.terrain)) {
      return true;
    }

    // Sea units can exist on ocean terrains
    if (this.isSeaUnit(unit) && this.isOceanTerrain(tile.terrain)) {
      return true;
    }

    // Air units can exist anywhere
    if (this.isAirUnit(unit)) {
      return true;
    }

    return false;
  }

  /**
   * Check if unit can do a specific action
   * Reference: freeciv/common/actions.h unit_can_do_action()
   */
  private unitCanDoAction(unit: Unit, action: ActionType): boolean {
    if (action === ActionType.FOUND_CITY) {
      // Check against ruleset founding units
      return this.foundingRules.founding_units.some(
        allowedUnit => unit.unitTypeId.toLowerCase() === allowedUnit.toLowerCase()
      );
    }
    return false;
  }

  /**
   * Check if unit can found city on non-native terrain
   * Reference: freeciv/common/city.c:1529-1530 utype_can_do_act_when_ustate
   */
  private canUnitFoundCityOnNonNativeTile(unit: Unit): boolean {
    // Most rulesets don't allow this, but some might for air units
    return this.isAirUnit(unit);
  }

  /**
   * Check if unit can found city on foreign territory using ruleset
   * Reference: freeciv/common/city.c:1539-1541 can_utype_do_act_if_tgt_diplrel
   */
  private canUnitFoundCityOnForeignTile(_unit: Unit): boolean {
    // Check ruleset setting for foreign territory founding
    return this.foundingRules.allow_foreign_territory;
  }

  /**
   * Get tile owner (simplified implementation)
   */
  private getTileOwner(_tile: MapTile): string | null {
    // In a full implementation, this would check tile ownership
    // For now, assume no tile ownership system
    return null;
  }

  // Helper methods for unit type classification
  private isLandUnit(unit: Unit): boolean {
    return [
      'settler',
      'warrior',
      'phalanx',
      'archer',
      'legion',
      'pikemen',
      'musketeers',
      'riflemen',
      'cavalry',
      'knights',
    ].includes(unit.unitTypeId);
  }

  private isSeaUnit(unit: Unit): boolean {
    return [
      'trireme',
      'caravel',
      'galleon',
      'frigate',
      'ironclad',
      'destroyer',
      'cruiser',
      'battleship',
      'submarine',
      'carrier',
    ].includes(unit.unitTypeId);
  }

  private isAirUnit(unit: Unit): boolean {
    return ['fighter', 'bomber', 'helicopter'].includes(unit.unitTypeId);
  }

  private isLandTerrain(terrain: TerrainType): boolean {
    return !this.isOceanTerrain(terrain);
  }

  private isOceanTerrain(terrain: TerrainType): boolean {
    return ['ocean', 'deep_ocean', 'coast'].includes(terrain);
  }

  /**
   * Set custom citymindist value
   */
  public setCityMinDist(value: number): void {
    this.citymindist = Math.max(GAME_MIN_CITYMINDIST, Math.min(GAME_MAX_CITYMINDIST, value));
    logger.debug(`CityFoundingValidationService: Set citymindist to ${this.citymindist}`);
  }

  /**
   * Get current citymindist value
   */
  public getCityMinDist(): number {
    return this.citymindist;
  }

  /**
   * Get current ruleset name
   */
  public getRulesetName(): string {
    return this.rulesetName;
  }
}
