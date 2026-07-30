import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import { CityState, WorkableTile, SpecialistType } from '@game/managers/CityManager';
import type { MapManager } from '@game/managers/MapManager';
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { TerrainType } from '@shared/data/rulesets/schemas';
import { EffectsManager, EffectType, OutputType } from '@game/managers/EffectsManager';

/**
 * CityTileManagementService - Manages city workable tiles and citizen assignments
 * Handles all city-tile related operations including:
 * - Workable tile initialization and management
 * - Citizen assignment to tiles
 * - Tile worker to specialist conversion
 * - City output calculations from worked tiles
 */
export class CityTileManagementService extends BaseGameService {
  private playerGovernmentProvider: (playerId: string) => string = () => 'despotism';

  constructor(
    private cities: Map<string, CityState>,
    private mapManager: MapManager,
    private CITY_MAP_DEFAULT_RADIUS_SQ: number,
    private readonly ruleset: Pick<RulesetLoader, 'getTerrain' | 'getCivstyle'> &
      Partial<Pick<RulesetLoader, 'getResource'>> = rulesetLoader,
    private readonly effectsManager: EffectsManager = new EffectsManager()
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'CityTileManagementService';
  }

  private get rulesetName(): string {
    return this.effectsManager.getRulesetName();
  }

  setPlayerGovernmentProvider(provider: (playerId: string) => string): void {
    this.playerGovernmentProvider = provider;
  }

  /**
   * Check if a tile is within the workable area of a city
   * @reference freeciv-web's city_map_includes_tile() and sq_map_distance()
   */
  private cityMapIncludesTile(tile: { x: number; y: number }, city: CityState): boolean {
    const topology = (this.mapManager as Partial<MapManager>).getTopology?.();
    const { dx, dy } = topology
      ? topology.distanceVector(city.x, city.y, tile.x, tile.y)
      : { dx: tile.x - city.x, dy: tile.y - city.y };
    const distanceSq = dx * dx + dy * dy;
    // Use <= comparison like freeciv-web: sq_map_distance(a,e) > c
    return distanceSq <= this.CITY_MAP_DEFAULT_RADIUS_SQ;
  }

  /**
   * Calculate squared distance between two points
   * @reference Original CityManager.calculateSquaredDistance()
   */
  // Note: calculateSquaredDistance method removed as it's not currently used
  // It would be used for distance-based tile calculations

  /**
   * Initialize workable tiles for a newly founded city
   * @reference Original CityManager.initializeWorkableTiles()
   */
  public initializeWorkableTiles(city: CityState): void {
    if (!this.mapManager) {
      logger.warn('Cannot initialize workable tiles: MapManager not available, using fallback', {
        cityId: city.id,
      });
      // Provide fallback workable tiles with just city center
      city.workableTiles = [
        {
          x: city.x,
          y: city.y,
          isCenter: true,
          isWorked: true,
          isBlocked: false,
          outputs: this.applyCityCenterMinimums(this.getTerrainBaseOutputs('grassland')),
        },
      ];
      return;
    }

    const mapData = this.mapManager.getMapData();
    if (!mapData) {
      logger.warn('Cannot initialize workable tiles: no map data available, using fallback', {
        cityId: city.id,
      });
      // Provide fallback workable tiles with just city center
      city.workableTiles = [
        {
          x: city.x,
          y: city.y,
          isCenter: true,
          isWorked: true,
          isBlocked: false,
          outputs: this.applyCityCenterMinimums(this.getTerrainBaseOutputs('grassland')),
        },
      ];
      return;
    }

    city.workableTiles = [];

    // Generate all possible tiles within city radius
    // Calculate the linear radius from radius_sq, following freeciv-web's build_city_tile_map
    const linearRadius = Math.floor(Math.sqrt(this.CITY_MAP_DEFAULT_RADIUS_SQ));
    const topology = (this.mapManager as Partial<MapManager>).getTopology?.();
    const candidates = topology
      ? topology.getPositionsWithinRadius(city.x, city.y, linearRadius)
      : Array.from({ length: linearRadius * 2 + 1 }, (_, xIndex) =>
          Array.from({ length: linearRadius * 2 + 1 }, (_, yIndex) => ({
            x: city.x + xIndex - linearRadius,
            y: city.y + yIndex - linearRadius,
          }))
        ).flat();

    for (const { x: tileX, y: tileY } of candidates) {
      if (!this.mapManager.isValidPosition(tileX, tileY)) {
        continue;
      }

      // Check if tile is within workable radius
      if (!this.cityMapIncludesTile({ x: tileX, y: tileY }, city)) {
        continue;
      }

      const mapTile = this.mapManager.getTile(tileX, tileY);
      if (!mapTile) {
        continue;
      }

      // Create workable tile entry
      const workableTile: WorkableTile = {
        x: tileX,
        y: tileY,
        isWorked: false,
        isCenter: tileX === city.x && tileY === city.y,
        outputs: {
          food: this.calculateTileFood(mapTile),
          shields: this.calculateTileShields(mapTile),
          trade: this.calculateTileTradeFromTerrain(mapTile),
        },
        terrain: mapTile.terrain,
        resource: mapTile.resource,
        improvements: [], // Could be roads, irrigation, etc.
      };

      // City center is always worked
      if (workableTile.isCenter) {
        workableTile.isWorked = true;
        workableTile.outputs = this.applyCityCenterMinimums(workableTile.outputs);
      }

      city.workableTiles.push(workableTile);
    }

    // Auto-assign citizens to work the best tiles based on population
    // Each citizen can work one tile (excluding the city center which is free)
    this.autoAssignCitizensToTiles(city);

    logger.info('Initialized workable tiles for city', {
      cityId: city.id,
      cityName: city.name,
      tilesCount: city.workableTiles.length,
      workedTiles: city.workableTiles.filter(t => t.isWorked).length,
    });
  }

  /**
   * Reassign citizens after city growth
   * Public method for CityManager to call when city grows
   */
  public reassignCitizensAfterGrowth(city: CityState): void {
    this.autoAssignCitizensToTiles(city);
  }

  /**
   * Automatically assign citizens to work the best available tiles
   * Citizens = population, but city center is worked for free
   */
  private autoAssignCitizensToTiles(city: CityState): void {
    if (!city.workableTiles) return;

    // Get tile scoring weights from ruleset (could be expanded later)
    // For now, we'll use a balanced approach that prioritizes growth
    const getTileScore = (tile: WorkableTile): number => {
      // Prioritize food for growth, then shields for production, then trade
      // This reflects typical city management strategy
      return tile.outputs.food * 3 + tile.outputs.shields * 2 + tile.outputs.trade;
    };

    // Sort tiles by total output (food + shields + trade), excluding city center
    const availableTiles = city.workableTiles
      .filter(t => !t.isCenter && !t.isBlocked && !this.isWorkedByAnotherCity(city.id, t.x, t.y))
      .sort((a, b) => getTileScore(b) - getTileScore(a));

    // Reset all non-center tiles to not worked
    city.workableTiles.forEach(tile => {
      if (!tile.isCenter) {
        tile.isWorked = false;
      }
    });

    // The center is worked for free; every citizen may therefore work one
    // additional tile. At size one this produces the center plus one worker,
    // matching Freeciv's city-map accounting.
    const citizensToAssign = Math.max(0, city.population);
    for (let i = 0; i < Math.min(citizensToAssign, availableTiles.length); i++) {
      availableTiles[i].isWorked = true;
    }
  }

  private isWorkedByAnotherCity(cityId: string, x: number, y: number): boolean {
    return Array.from(this.cities.values()).some(
      other =>
        other.id !== cityId &&
        other.workableTiles?.some(tile => tile.x === x && tile.y === y && tile.isWorked)
    );
  }

  /**
   * Calculate food output from a map tile
   */
  private calculateTileFood(mapTile: any): number {
    let food = this.getTerrainBaseOutputs(mapTile.terrain).food;

    food += this.getResourceOutput(mapTile.resource, 'food');

    return food;
  }

  /**
   * Calculate shield output from a map tile
   */
  private calculateTileShields(mapTile: any): number {
    let shields = this.getTerrainBaseOutputs(mapTile.terrain).shields;

    shields += this.getResourceOutput(mapTile.resource, 'shield');

    return shields;
  }

  /**
   * Calculate trade output from a map tile
   */
  private calculateTileTradeFromTerrain(mapTile: any): number {
    let trade = this.getTerrainBaseOutputs(mapTile.terrain).trade;

    trade += this.getResourceOutput(mapTile.resource, 'trade');

    return trade;
  }

  private getResourceOutput(
    resource: string | undefined,
    output: 'food' | 'shield' | 'trade'
  ): number {
    if (!resource) return 0;
    try {
      const value = (this.ruleset.getResource ?? rulesetLoader.getResource.bind(rulesetLoader))(
        resource,
        this.rulesetName
      )[output];
      return typeof value === 'number' ? value : 0;
    } catch {
      logger.warn('Ignoring unknown map resource', { resource });
      return 0;
    }
  }

  /**
   * Base terrain yield comes from terrain.ruleset; resource modifiers remain
   * runtime map state and are applied by the individual output methods.
   * @reference reference/freeciv/data/classic/terrain.ruleset
   */
  private getTerrainBaseOutputs(terrain: string): {
    food: number;
    shields: number;
    trade: number;
  } {
    const definition = this.ruleset.getTerrain(terrain as TerrainType, this.rulesetName);
    return {
      food: definition.food,
      shields: definition.shields,
      trade: definition.trade,
    };
  }

  /**
   * Assign a citizen to work a specific tile
   * @reference Original CityManager.assignCitizenToTile()
   */
  public async assignCitizenToTile(cityId: string, tileX: number, tileY: number): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn('Cannot assign citizen to tile: city not found', { cityId });
      return false;
    }

    if (!city.workableTiles) {
      logger.warn('Cannot assign citizen to tile: no workable tiles initialized', { cityId });
      return false;
    }

    const tile = city.workableTiles.find(t => t.x === tileX && t.y === tileY);
    if (!tile) {
      logger.warn('Cannot assign citizen to tile: tile not workable by this city', {
        cityId,
        tileX,
        tileY,
      });
      return false;
    }

    if (tile.isWorked) {
      logger.warn('Cannot assign citizen to tile: tile already worked', { cityId, tileX, tileY });
      return false;
    }

    if (this.isWorkedByAnotherCity(city.id, tileX, tileY)) {
      logger.warn('Cannot assign citizen to tile: tile worked by another city', {
        cityId,
        tileX,
        tileY,
      });
      return false;
    }

    // Check if city has available workers
    const workedTiles = city.workableTiles.filter(t => t.isWorked && !t.isCenter).length;
    const totalSpecialists = Object.values(city.specialists).reduce((sum, count) => sum + count, 0);
    const availableWorkers = city.population - workedTiles - totalSpecialists;

    if (availableWorkers <= 0) {
      logger.warn('Cannot assign citizen to tile: no available workers', { cityId });
      return false;
    }

    tile.isWorked = true;

    logger.info('Citizen assigned to tile', { cityId, tileX, tileY });
    return true;
  }

  /**
   * Convert a tile worker to a specialist
   * @reference Original CityManager.convertTileWorkerToSpecialist()
   */
  public async convertTileWorkerToSpecialist(
    cityId: string,
    tileX: number,
    tileY: number,
    specialistType: number
  ): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn('Cannot convert tile worker: city not found', { cityId });
      return false;
    }

    if (!city.workableTiles) {
      logger.warn('Cannot convert tile worker: no workable tiles', { cityId });
      return false;
    }

    const tile = city.workableTiles.find(t => t.x === tileX && t.y === tileY);
    if (!tile) {
      logger.warn('Cannot convert tile worker: tile not found', { cityId, tileX, tileY });
      return false;
    }

    if (!tile.isWorked || tile.isCenter) {
      logger.warn('Cannot convert tile worker: tile not worked by citizen or is city center', {
        cityId,
        tileX,
        tileY,
      });
      return false;
    }

    // Remove worker from tile
    tile.isWorked = false;

    // Add specialist
    const currentCount = city.specialists[specialistType as SpecialistType] || 0;
    city.specialists[specialistType as SpecialistType] = currentCount + 1;

    logger.info('Converted tile worker to specialist', {
      cityId,
      tileX,
      tileY,
      specialistType,
    });
    return true;
  }

  /**
   * Get all workable tiles for a city
   * @reference Original CityManager.getWorkableTiles()
   */
  public getWorkableTiles(cityId: string): WorkableTile[] | null {
    const city = this.cities.get(cityId);
    if (!city) {
      return null;
    }
    return city.workableTiles || [];
  }

  /**
   * Calculate gross city outputs from worked tiles only (without buildings/specialists).
   * @reference Original CityManager.calculateCityOutputs()
   * @reference reference/freeciv/common/city.c:2950-3050 set_city_production()
   */
  public calculateCityOutputs(cityId: string): {
    food: number;
    shields: number;
    trade: number;
  } {
    const city = this.cities.get(cityId);
    if (!city || !city.workableTiles) {
      return { food: 0, shields: 0, trade: 0 };
    }

    let food = 0;
    let shields = 0;
    let trade = 0;

    // Sum outputs from all worked tiles
    for (const tile of city.workableTiles) {
      if (tile.isWorked) {
        const mapTile = this.mapManager?.getTile(tile.x, tile.y);
        let outputs = mapTile
          ? {
              food: this.calculateTileFood(mapTile),
              shields: this.calculateTileShields(mapTile),
              trade: this.calculateTileTradeFromTerrain(mapTile),
            }
          : tile.outputs;
        if (mapTile?.improvements?.includes('irrigation')) {
          outputs.food += this.ruleset.getTerrain(
            mapTile.terrain,
            this.rulesetName
          ).irrigationFoodIncr;
        }
        if (mapTile?.improvements?.includes('mine')) {
          outputs.shields += this.ruleset.getTerrain(
            mapTile.terrain,
            this.rulesetName
          ).miningShieldIncr;
        }
        const terrain = mapTile?.terrain ?? tile.terrain ?? '';
        const hasRoad = mapTile?.hasRoad || mapTile?.improvements?.includes('road');
        if (hasRoad && ['grassland', 'plains'].includes(terrain)) {
          outputs.trade += 1;
        }
        if ((mapTile?.riverMask ?? 0) !== 0) {
          outputs.trade += 1;
        }
        if (mapTile?.hasRailroad || mapTile?.improvements?.includes('railroad')) {
          outputs.shields = Math.floor(outputs.shields * 1.5);
        }
        outputs = this.applyRulesetTileEffects(city, tile, terrain, outputs);
        if (tile.isCenter) outputs = this.applyCityCenterMinimums(outputs);
        tile.outputs = outputs;
        food += outputs.food;
        shields += outputs.shields;
        trade += outputs.trade;
      }
    }

    return { food, shields, trade };
  }

  /**
   * Apply ruleset tile effects in Freeciv's city_tile_output() order.
   * @reference reference/freeciv/common/city.c:1334-1358
   */
  private applyRulesetTileEffects(
    city: CityState,
    tile: WorkableTile,
    terrain: string,
    outputs: { food: number; shields: number; trade: number }
  ): { food: number; shields: number; trade: number } {
    const celebrating =
      city.wasHappy === true &&
      city.population >= 3 &&
      city.happiness.unhappy === 0 &&
      city.happiness.angry === 0 &&
      city.happiness.happy >= Math.ceil(city.population / 2);
    const adjusted = { ...outputs };
    const terrainRules = this.ruleset.getTerrain(terrain as TerrainType, this.rulesetName);
    const terrainClass = terrainRules.properties?.MG_OCEAN_DEPTH !== undefined ? 'Oceanic' : 'Land';
    const outputTypes = {
      food: OutputType.FOOD,
      shields: OutputType.SHIELD,
      trade: OutputType.TRADE,
    } as const;

    for (const output of ['food', 'shields', 'trade'] as const) {
      const context = {
        playerId: city.playerId,
        cityId: city.id,
        tileX: tile.x,
        tileY: tile.y,
        government: this.playerGovernmentProvider(city.playerId),
        outputType: outputTypes[output],
        tileTerrain: terrain,
        tileTerrainClass: terrainClass,
        tileIsCityCenter: tile.isCenter,
        cityCelebrating: celebrating,
        cityBuildings: new Set(city.buildings),
      };

      adjusted[output] += this.effectsManager.calculateEffect(
        EffectType.OUTPUT_ADD_TILE,
        context
      ).value;
      if (adjusted[output] <= 0) continue;

      const penaltyLimit = this.effectsManager.calculateEffect(
        EffectType.OUTPUT_PENALTY_TILE,
        context
      ).value;
      // Classic's output granularity is one. Increment effects do not make a
      // zero-output tile productive.
      if (adjusted[output] >= 1) {
        adjusted[output] += this.effectsManager.calculateEffect(
          EffectType.OUTPUT_INC_TILE,
          context
        ).value;
        if (celebrating) {
          adjusted[output] += this.effectsManager.calculateEffect(
            EffectType.OUTPUT_INC_TILE_CELEBRATE,
            context
          ).value;
        }
      }
      if (penaltyLimit > 0 && adjusted[output] > penaltyLimit) {
        adjusted[output] = adjusted[output] <= 1 ? 0 : adjusted[output] - 1;
      }
    }
    return adjusted;
  }

  /**
   * City-center minimums apply to the center tile, not to aggregate city output.
   * @reference reference/freeciv/common/city.c:2917-2945 city_get_output_tile()
   */
  private applyCityCenterMinimums(outputs: { food: number; shields: number; trade: number }): {
    food: number;
    shields: number;
    trade: number;
  } {
    const civstyle = this.ruleset.getCivstyle();
    return {
      food: Math.max(outputs.food, civstyle.min_city_center_food),
      shields: Math.max(outputs.shields, civstyle.min_city_center_shield),
      trade: Math.max(outputs.trade, civstyle.min_city_center_trade),
    };
  }
}
