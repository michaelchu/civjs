import { logger } from '@utils/logger';
import { PlayerState } from '@game/managers/GameManager';
import {
  MapData,
  MapTile,
  MapStartpos,
  type MapGenerationOptions,
  type TerrainType,
  type ResourceType,
} from './MapTypes';
import { BaseMapGenerationService } from './BaseMapGenerationService';
import { IslandMapService } from './IslandMapService';
import { Position } from './MapValidator';
import { type MapTopologyOptions } from './MapTopology';
import { createBaseTile, isLandTile, setTerrainGameProperties } from './TerrainUtils';

/**
 * Resource balance validation result
 */
interface ResourceBalanceResult {
  balanced: boolean;
  score: number;
  issues: string[];
}

/**
 * Fair islands generation service with enhanced validation and retry logic
 * Implements freeciv's fair islands algorithm with comprehensive feasibility checks
 * @reference freeciv/server/generator/mapgen.c:3395-3754 fair islands generation
 * @reference freeciv/server/generator/mapgen.c:1316 fair islands validation
 */
export class FairIslandsService extends BaseMapGenerationService {
  private islandMapService: IslandMapService;
  private currentMapData: MapData | null = null;

  constructor(
    width: number,
    height: number,
    seed: string,
    generator: string,
    random: () => number,
    defaultStartPosMode: MapStartpos,
    cleanupTemperatureMapAfterUse: boolean = false,
    temperatureParam: number = 50,
    topologyOptions: MapTopologyOptions = {},
    generationOptions: MapGenerationOptions = {}
  ) {
    super(
      width,
      height,
      seed,
      generator,
      random,
      defaultStartPosMode,
      cleanupTemperatureMapAfterUse,
      temperatureParam,
      topologyOptions,
      generationOptions
    );

    // Create island map service for actual generation
    this.islandMapService = new IslandMapService(
      width,
      height,
      seed,
      generator,
      random,
      defaultStartPosMode,
      cleanupTemperatureMapAfterUse,
      temperatureParam,
      topologyOptions,
      generationOptions
    );
  }

  /**
   * Attempt fair islands generation with enhanced validation and retry logic
   * @reference freeciv/server/generator/mapgen.c:3395-3754 fair islands algorithm
   */
  public async generateMap(players: Map<string, PlayerState>): Promise<MapData> {
    try {
      return this.generateSymmetricFairMap(players);
    } catch (error) {
      logger.warn('Dedicated fair-island generation failed; using validated legacy fallback', {
        error: error instanceof Error ? error.message : error,
      });
      return this.generateLegacyFairMap(players);
    }
  }

  private async generateLegacyFairMap(players: Map<string, PlayerState>): Promise<MapData> {
    const maxAttempts = 3; // Allow multiple attempts with parameter adjustment
    const startTime = Date.now();
    let attempt = 0;

    // @reference freeciv/server/generator/mapgen.c:1316
    // !map_generate_fair_islands() - pre-validation equivalent
    // Use 'ALL' startpos mode for fair islands validation (maps to mapGenerator4)
    if (!this.validateFairIslands(players, MapStartpos.ALL)) {
      logger.info(
        'Enhanced fair islands pre-validation failed (equivalent to early return FALSE)',
        {
          reference: 'freeciv/server/generator/mapgen.c:1316',
        }
      );
      throw new Error('FALLBACK_TO_ISLAND');
    }

    // Enhanced retry logic with adaptive parameters (inspired by freeciv iteration logic)
    while (attempt < maxAttempts) {
      attempt++;

      try {
        logger.info(`Fair islands generation attempt ${attempt}/${maxAttempts}`, {
          players: players.size,
          reference: 'Enhanced retry logic with adaptive parameters',
        });

        // Apply adaptive parameters based on attempt number
        // @reference freeciv/server/generator/mapgen.c:3689-3702 parameter reduction logic
        const parameterAdjustment = this.calculateParameterAdjustment(attempt, maxAttempts);
        const adjustedTerrainPercentages = this.adjustTerrainPercentages(parameterAdjustment);

        // Store original percentages for restoration
        const originalPercentages = { ...this.terrainPercentages };
        this.terrainPercentages = adjustedTerrainPercentages;
        this.islandMapService.setTerrainPercentages(adjustedTerrainPercentages);

        // @reference freeciv/server/generator/mapgen.c:3523-3753
        // Fair islands algorithm attempts with iteration limits
        // Use 'ALL' startpos mode for fair islands (equivalent to mapgenerator4)
        const generationTimeout = 30000 + (attempt - 1) * 10000; // Increase timeout for later attempts
        const generationPromise = this.islandMapService.generateMap(players, MapStartpos.ALL);
        let timeout: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<MapData>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Fair islands generation timeout')),
            generationTimeout
          );
        });
        const mapData = await Promise.race([generationPromise, timeoutPromise]).finally(() => {
          if (timeout) clearTimeout(timeout);
        });
        this.currentMapData = mapData;

        // Restore original percentages
        this.terrainPercentages = originalPercentages;
        this.islandMapService.setTerrainPercentages(originalPercentages);

        // Enhanced post-generation validation equivalent to freeciv's done check
        if (!this.validateGeneratedFairMap(players)) {
          logger.warn(
            `Fair islands attempt ${attempt} failed post-validation (equivalent to !done)`,
            {
              attempt,
              maxAttempts,
              parameterAdjustment,
              reference: 'freeciv/server/generator/mapgen.c:3699-3703',
            }
          );

          if (attempt < maxAttempts) {
            logger.info('Retrying fair islands generation with adjusted parameters');
            continue; // Try again with different parameters
          }
          throw new Error('FALLBACK_TO_ISLAND');
        }

        const generationTime = Date.now() - startTime;
        logger.info(
          `Enhanced fair islands generation succeeded on attempt ${attempt} (equivalent to return TRUE)`,
          {
            attempt,
            generationTime,
            parameterAdjustment,
            reference: 'freeciv/server/generator/mapgen.c:3754',
          }
        );

        return mapData;
      } catch (error) {
        // Restore original percentages on error
        if (error instanceof Error && error.message === 'FALLBACK_TO_ISLAND') {
          throw error; // Re-throw fallback errors
        }

        logger.warn(`Fair islands attempt ${attempt} failed with error`, {
          attempt,
          maxAttempts,
          error: error instanceof Error ? error.message : error,
          reference: 'freeciv/server/generator/mapgen.c:3699-3703',
        });

        if (attempt < maxAttempts) {
          logger.info('Retrying fair islands generation after error');
          continue; // Try again
        }
      }
    }

    const totalTime = Date.now() - startTime;
    logger.warn(
      `Fair islands generation failed after ${maxAttempts} attempts (equivalent to return FALSE)`,
      {
        attempts: maxAttempts,
        totalTime,
        reference: 'Enhanced retry logic based on freeciv iteration pattern',
      }
    );

    throw new Error('FALLBACK_TO_ISLAND');
  }

  /**
   * Freeciv fair islands are built from one shared island template so every
   * player group receives the same land, terrain, resources, huts, and start
   * geometry. CivJS keeps rectangular native coordinates but follows that
   * defining fairness contract.
   * @reference reference/freeciv/server/generator/mapgen.c:3395-3754
   */
  private generateSymmetricFairMap(players: Map<string, PlayerState>): MapData {
    if (players.size === 0) {
      return {
        width: this.width,
        height: this.height,
        tiles: this.createOceanMap(),
        startingPositions: [],
        seed: this.seed,
        generatedAt: new Date(),
        topologyId: this.topology.topologyId,
        wrapId: this.topology.wrapId,
      };
    }

    const playerIds = [...players.keys()];
    const playersPerIsland = this.getFairPlayersPerIsland(playerIds.length);
    const islandCount = Math.ceil(playerIds.length / playersPerIsland);
    const columns = Math.ceil(Math.sqrt((islandCount * this.width) / this.height));
    const rows = Math.ceil(islandCount / columns);
    const cellWidth = Math.floor(this.width / columns);
    const cellHeight = Math.floor(this.height / rows);
    const usableHalfWidth = Math.max(2, Math.floor((cellWidth - 4) / 2));
    const usableHalfHeight = Math.max(2, Math.floor((cellHeight - 4) / 2));
    const capacity = (usableHalfWidth * 2 + 1) * (usableHalfHeight * 2 + 1);
    const targetPerIsland = Math.min(
      capacity,
      Math.max(
        9,
        Math.floor(
          (this.width * this.height * this.generationOptions.landPercent) / 100 / islandCount
        )
      )
    );
    if (targetPerIsland < Math.max(9, playersPerIsland * 5)) {
      throw new Error('Map is too small for fair player islands');
    }

    const template = this.createFairTemplate(usableHalfWidth, usableHalfHeight, targetPerIsland);
    const tiles = this.createOceanMap();
    const startingPositions: MapData['startingPositions'] = [];
    let playerIndex = 0;

    for (let islandIndex = 0; islandIndex < islandCount; islandIndex++) {
      const cellX = islandIndex % columns;
      const cellY = Math.floor(islandIndex / columns);
      const centerX = Math.min(
        this.width - usableHalfWidth - 1,
        cellX * cellWidth + Math.floor(cellWidth / 2)
      );
      const centerY = Math.min(
        this.height - usableHalfHeight - 1,
        cellY * cellHeight + Math.floor(cellHeight / 2)
      );

      for (const entry of template) {
        const position = this.topology.normalize(centerX + entry.dx, centerY + entry.dy);
        if (!position) continue;
        const tile = tiles[position.x][position.y];
        tile.terrain = entry.terrain;
        tile.elevation = entry.elevation;
        tile.continentId = islandIndex + 1;
        tile.resource = entry.resource;
        tile.improvements = entry.hasHut ? ['hut'] : [];
        tile.riverMask = entry.hasRiver ? 1 : 0;
        setTerrainGameProperties(tile);
      }

      const startsForIsland = Math.min(playersPerIsland, playerIds.length - playerIndex);
      const startOffsets = this.getFairStartOffsets(startsForIsland);
      for (let startIndex = 0; startIndex < startsForIsland; startIndex++) {
        const offset = startOffsets[startIndex];
        const position = this.topology.normalize(centerX + offset.dx, centerY + offset.dy);
        if (!position) throw new Error('Fair start is outside the map');
        const tile = tiles[position.x][position.y];
        tile.terrain = 'grassland';
        tile.resource = undefined;
        tile.improvements = [];
        tile.continentId = islandIndex + 1;
        setTerrainGameProperties(tile);
        startingPositions.push({
          x: position.x,
          y: position.y,
          playerId: playerIds[playerIndex++],
        });
      }
    }

    this.classifyFairOceanTiles(tiles);
    this.connectFairRivers(tiles);

    return {
      width: this.width,
      height: this.height,
      tiles,
      startingPositions,
      seed: this.seed,
      generatedAt: new Date(),
      topologyId: this.topology.topologyId,
      wrapId: this.topology.wrapId,
    };
  }

  private createOceanMap(): MapTile[][] {
    return Array.from({ length: this.width }, (_, x) =>
      Array.from({ length: this.height }, (_, y) => {
        const tile = createBaseTile(x, y);
        tile.terrain = 'deep_ocean';
        tile.continentId = -1;
        tile.elevation = 0;
        setTerrainGameProperties(tile);
        return tile;
      })
    );
  }

  private getFairPlayersPerIsland(playerCount: number): number {
    switch (this.defaultStartPosMode) {
      case MapStartpos.ALL:
        return playerCount;
      case MapStartpos.TWO_ON_THREE:
        return playerCount % 3 === 0 ? 3 : 2;
      case MapStartpos.DEFAULT:
      case MapStartpos.SINGLE:
      case MapStartpos.VARIABLE:
      default:
        return 1;
    }
  }

  private createFairTemplate(
    halfWidth: number,
    halfHeight: number,
    targetSize: number
  ): Array<{
    dx: number;
    dy: number;
    terrain: TerrainType;
    elevation: number;
    resource?: ResourceType;
    hasHut: boolean;
    hasRiver: boolean;
  }> {
    const candidates: Array<{ dx: number; dy: number; score: number }> = [];
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      for (let dy = -halfHeight; dy <= halfHeight; dy++) {
        const radial =
          (dx * dx) / Math.max(1, halfWidth * halfWidth) +
          (dy * dy) / Math.max(1, halfHeight * halfHeight);
        candidates.push({ dx, dy, score: radial + this.random() * 0.3 });
      }
    }
    candidates.sort((left, right) => left.score - right.score);

    return candidates.slice(0, targetSize).map(({ dx, dy, score }, index) => {
      const climateRoll = this.random();
      const terrain: TerrainType =
        score > 0.78
          ? climateRoll < 0.5
            ? 'hills'
            : 'forest'
          : climateRoll < 0.12
            ? 'forest'
            : climateRoll < 0.2
              ? 'hills'
              : climateRoll < 0.25
                ? 'plains'
                : 'grassland';
      const richness = this.generationOptions.resourceRichness / 1000;
      const resource = this.random() < richness ? this.resourceForTerrain(terrain) : undefined;
      return {
        dx,
        dy,
        terrain,
        elevation: terrain === 'hills' ? 190 : 130,
        resource,
        hasHut: index > 2 && this.random() < this.generationOptions.hutDensity / 1000,
        hasRiver:
          this.generationOptions.riverDensity > 0 &&
          dx === 0 &&
          Math.abs(dy) <= Math.max(1, Math.floor(halfHeight / 2)),
      };
    });
  }

  private resourceForTerrain(terrain: TerrainType): ResourceType | undefined {
    const resources: Partial<Record<TerrainType, ResourceType[]>> = {
      grassland: ['resources'],
      plains: ['wheat', 'buffalo'],
      forest: ['pheasant', 'silk'],
      hills: ['coal', 'wine'],
    };
    const options = resources[terrain] ?? [];
    return options.length > 0 ? options[Math.floor(this.random() * options.length)] : undefined;
  }

  private getFairStartOffsets(count: number): Array<{ dx: number; dy: number }> {
    const offsets = [
      { dx: 0, dy: 0 },
      { dx: -1, dy: 1 },
      { dx: 1, dy: -1 },
      { dx: 1, dy: 1 },
      { dx: -1, dy: -1 },
    ];
    return offsets.slice(0, count);
  }

  private classifyFairOceanTiles(tiles: MapTile[][]): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (
          !isLandTile(tile.terrain) &&
          this.topology
            .getNeighbors(x, y)
            .some(position => isLandTile(tiles[position.x][position.y].terrain))
        ) {
          tile.terrain = 'coast';
          setTerrainGameProperties(tile);
        }
      }
    }
  }

  private connectFairRivers(tiles: MapTile[][]): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (tiles[x][y].riverMask === 0) continue;
        let mask = 0;
        for (const [index, direction] of this.topology.getCardinalDirections().entries()) {
          const position = this.topology.normalize(x + direction.dx, y + direction.dy);
          if (position && tiles[position.x][position.y].riverMask > 0) mask |= 1 << index;
        }
        tiles[x][y].riverMask = mask || 1;
      }
    }
  }

  /**
   * Validate fair islands feasibility before generation attempt
   * @reference freeciv/server/generator/mapgen.c:3395-3509 fair islands validation
   */
  private validateFairIslands(
    players: Map<string, PlayerState>,
    startPosMode: MapStartpos = MapStartpos.ALL
  ): boolean {
    const playerCount = players.size;

    // @reference freeciv/server/generator/mapgen.c:3395
    // int min_island_size = wld.map.server.tinyisles ? 1 : 2;
    const minIslandSize = this.generationOptions.tinyIsles ? 1 : 2;

    // @reference freeciv/server/generator/mapgen.c:3396-3397
    // int players_per_island = 1;
    let playersPerIsland = 1;

    // @reference freeciv/server/generator/mapgen.c:3398
    // int i, iter = CLIP(1, 100000 / map_num_tiles(), 10);
    const mapNumTiles = this.width * this.height;
    const maxIterations = Math.max(1, Math.min(Math.floor(100000 / mapNumTiles), 10));

    // @reference freeciv/server/generator/mapgen.c:3419-3444
    // Calculate players_per_island based on startpos mode (freeciv MAPSTARTPOS logic)
    switch (startPosMode) {
      case MapStartpos.TWO_ON_THREE: {
        // MAPSTARTPOS_2or3: Prefer 2-3 players per island
        const maybe2 = playerCount % 2 === 0;
        const maybe3 = playerCount % 3 === 0;
        if (maybe3) {
          playersPerIsland = 3;
        } else if (maybe2) {
          playersPerIsland = 2;
        }
        // else playersPerIsland remains 1
        break;
      }
      case MapStartpos.ALL:
        // MAPSTARTPOS_ALL: Flexible island distribution, prefer larger groups
        if (playerCount >= 6 && playerCount % 3 === 0) {
          playersPerIsland = 3;
        } else if (playerCount >= 4 && playerCount % 2 === 0) {
          playersPerIsland = 2;
        }
        // else playersPerIsland remains 1
        break;
      case MapStartpos.VARIABLE:
        // MAPSTARTPOS_VARIABLE: Variable island sizes, prefer single players with some larger islands
        playersPerIsland = 1; // Primarily single-player islands
        break;
      case MapStartpos.DEFAULT:
      case MapStartpos.SINGLE:
        // MAPSTARTPOS_DEFAULT/SINGLE: One player per island
        playersPerIsland = 1;
        break;
      default:
        playersPerIsland = 1;
    }

    // @reference freeciv/server/generator/mapgen.c:3492-3497
    // Calculate playermass using freeciv's exact formula
    const landPercent = this.generationOptions.landPercent;
    // Classic temperature 50 produces approximately two percent polar tiles
    // on larger maps before fair-island player mass is allocated.
    const polarTiles = Math.round(mapNumTiles * 0.02);
    const playermass = Math.floor((mapNumTiles * landPercent - polarTiles) / (playerCount * 100));

    // @reference freeciv/server/generator/mapgen.c:3498-3501
    // islandmass1 = (players_per_island * playermass * 7) / 10;
    // if (islandmass1 < min_island_size) { islandmass1 = min_island_size; }
    let islandmass1 = Math.floor((playersPerIsland * playermass * 7) / 10);
    if (islandmass1 < minIslandSize) {
      islandmass1 = minIslandSize;
    }

    // Enhanced feasibility checks with freeciv-compliant logic
    // @reference freeciv/server/generator/mapgen.c:3492-3509
    const islandmass2 = Math.floor((playermass * 2) / 10);
    const islandmass3 = Math.floor(playermass / 10);
    const finalIslandmass2 = islandmass2 < minIslandSize ? minIslandSize : islandmass2;
    const finalIslandmass3 = islandmass3 < minIslandSize ? minIslandSize : islandmass3;

    // Basic feasibility check - if we can't create minimum viable islands, fail
    if (playermass <= 0 || islandmass1 <= minIslandSize) {
      logger.warn('Fair islands validation failed: insufficient landmass', {
        playerCount,
        playermass,
        islandmass1,
        islandmass2: finalIslandmass2,
        islandmass3: finalIslandmass3,
        minIslandSize,
        mapNumTiles,
        landPercent,
        reference: 'freeciv/server/generator/mapgen.c:3492-3501',
      });
      return false;
    }

    // Enhanced validation: check if total required land mass is feasible
    const totalRequiredLand =
      islandmass1 * Math.ceil(playerCount / playersPerIsland) +
      finalIslandmass2 * 2 +
      finalIslandmass3 * 3;
    const totalAvailableLand = Math.floor((mapNumTiles * landPercent) / 100);

    if (totalRequiredLand > totalAvailableLand * 1.2) {
      // Allow 20% overhead for generation variance
      logger.warn('Fair islands validation failed: total required landmass exceeds available', {
        totalRequiredLand,
        totalAvailableLand,
        overhead: Math.round((totalRequiredLand / totalAvailableLand) * 100) + '%',
        playerCount,
        playersPerIsland,
        reference: 'Enhanced landmass feasibility check',
      });
      return false;
    }

    logger.debug('Fair islands pre-validation passed', {
      playerCount,
      playersPerIsland,
      playermass,
      islandmass1,
      islandmass2: finalIslandmass2,
      islandmass3: finalIslandmass3,
      totalRequiredLand,
      totalAvailableLand,
      mapNumTiles,
      maxIterations,
      reference: 'freeciv/server/generator/mapgen.c:3395-3509',
    });

    return true;
  }

  /**
   * Validate generated fair map quality
   * @reference freeciv/server/generator/mapgen.c post-generation validation
   */
  private validateGeneratedFairMap(players: Map<string, PlayerState>): boolean {
    if (!this.currentMapData) {
      logger.warn('No map data available for post-generation validation');
      return false;
    }

    const { tiles, startingPositions } = this.currentMapData;
    const playerCount = players.size;

    // Basic validation: ensure we have starting positions for all players
    if (!startingPositions || startingPositions.length < playerCount) {
      logger.warn('Insufficient starting positions for fair islands validation', {
        required: playerCount,
        generated: startingPositions?.length || 0,
        reference: 'Post-generation validation requirement',
      });
      return false;
    }

    // Enhanced validation: Island size distribution analysis
    const islandSizes = this.analyzeIslandSizes(tiles);
    const sortedIslandSizes = islandSizes.sort((a, b) => b - a);

    if (sortedIslandSizes.length === 0) {
      logger.warn('No islands found in generated map', {
        reference: 'Post-generation island analysis',
      });
      return false;
    }

    // Validate that we have sufficient major islands for players
    const majorIslands = sortedIslandSizes.filter(size => size >= 20); // Minimum viable island size
    const expectedMajorIslands = Math.ceil(playerCount / this.getPlayersPerIslandForValidation());

    if (majorIslands.length < expectedMajorIslands) {
      logger.warn('Insufficient major islands for fair distribution', {
        majorIslands: majorIslands.length,
        expectedMajorIslands,
        playerCount,
        reference: 'Post-generation major island count validation',
      });
      return false;
    }

    // Enhanced validation: Starting position distance validation
    const positionDistances = this.calculateStartingPositionDistances(startingPositions);
    if (positionDistances.length > 0) {
      const minDistance = Math.min(...positionDistances);
      const avgDistance = positionDistances.reduce((a, b) => a + b, 0) / positionDistances.length;

      // Minimum distance should be reasonable to prevent unfair clustering
      const minMapDimension = Math.min(this.width, this.height);
      const expectedMinDistance = minMapDimension / (playerCount * 0.8); // Allow some clustering

      if (minDistance < expectedMinDistance) {
        logger.warn('Starting positions too close together for fair play', {
          minDistance: Math.round(minDistance),
          expectedMinDistance: Math.round(expectedMinDistance),
          avgDistance: Math.round(avgDistance),
          reference: 'Post-generation starting position distance validation',
        });
        return false;
      }
    }

    // Enhanced validation: Resource balance verification
    const resourceBalance = this.validateResourceBalance(tiles, startingPositions);
    if (!resourceBalance.balanced) {
      logger.warn('Resource distribution imbalance detected', {
        issues: resourceBalance.issues,
        reference: 'Post-generation resource balance validation',
      });
      return false;
    }

    logger.debug('Enhanced fair islands post-generation validation passed', {
      playerCount,
      startingPositions: startingPositions.length,
      majorIslands: majorIslands.length,
      islandSizes: sortedIslandSizes.slice(0, 5), // Top 5 islands
      minDistance: positionDistances.length > 0 ? Math.round(Math.min(...positionDistances)) : 0,
      avgDistance:
        positionDistances.length > 0
          ? Math.round(positionDistances.reduce((a, b) => a + b, 0) / positionDistances.length)
          : 0,
      resourceBalance: resourceBalance.score,
      reference: 'Enhanced post-generation validation',
    });

    return true;
  }

  /**
   * Get players per island for validation calculations
   */
  private getPlayersPerIslandForValidation(): number {
    // Default to single player per island for validation
    // This can be enhanced based on startpos mode if needed
    return 1;
  }

  /**
   * Analyze island sizes in the generated map
   */
  private analyzeIslandSizes(tiles: MapTile[][]): number[] {
    const continentSizes = new Map<number, number>();

    // Count tiles per continent
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (tile.terrain !== 'ocean' && tile.continentId > 0) {
          const currentSize = continentSizes.get(tile.continentId) || 0;
          continentSizes.set(tile.continentId, currentSize + 1);
        }
      }
    }

    return Array.from(continentSizes.values());
  }

  /**
   * Calculate distances between all starting positions
   */
  private calculateStartingPositionDistances(positions: Position[]): number[] {
    const distances: number[] = [];

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const pos1 = positions[i];
        const pos2 = positions[j];
        const distance = this.topology.realDistance(pos1.x, pos1.y, pos2.x, pos2.y);
        distances.push(distance);
      }
    }

    return distances;
  }

  /**
   * Validate resource balance across starting positions
   */
  private validateResourceBalance(
    tiles: MapTile[][],
    startingPositions: Position[]
  ): ResourceBalanceResult {
    const result: ResourceBalanceResult = {
      balanced: true,
      score: 0,
      issues: [],
    };

    // Simple resource balance check - ensure each starting position has nearby resources
    const resourceCounts: number[] = [];

    for (const position of startingPositions) {
      const nearbyResources = this.countNearbyResources(tiles, position);
      resourceCounts.push(nearbyResources);
    }

    // Calculate balance metrics
    if (resourceCounts.length > 0) {
      const minResources = Math.min(...resourceCounts);
      const maxResources = Math.max(...resourceCounts);

      // Balance ratio - should be reasonably close
      const balanceRatio = minResources / Math.max(maxResources, 1);
      result.score = Math.round(balanceRatio * 100);

      // Consider balanced if min is at least 60% of max
      if (balanceRatio < 0.6) {
        result.balanced = false;
        result.issues.push(
          `Resource imbalance: min=${minResources}, max=${maxResources}, ratio=${Math.round(
            balanceRatio * 100
          )}%`
        );
      }

      // Check for positions with very few resources
      if (minResources < 2) {
        result.balanced = false;
        result.issues.push(
          `Some starting positions have insufficient resources: min=${minResources}`
        );
      }
    } else {
      result.balanced = false;
      result.issues.push('No starting positions to validate');
    }

    return result;
  }

  /**
   * Count nearby resources around a starting position
   */
  private countNearbyResources(tiles: MapTile[][], position: Position): number {
    let nearbyResources = 0;
    const searchRadius = 3;

    // Check tiles within search radius for resources
    for (const candidate of this.topology.getPositionsWithinRadius(
      position.x,
      position.y,
      searchRadius
    )) {
      if (tiles[candidate.x][candidate.y].resource) nearbyResources++;
    }

    return nearbyResources;
  }

  /**
   * Override to return current map tiles for land percentage calculation
   */
  protected getMapTiles(): MapTile[][] | null {
    return this.currentMapData?.tiles || null;
  }
}
