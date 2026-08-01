import { logger } from '@utils/logger';
import { PlayerState } from '@game/managers/GameManager';
import { MapData, MapTile, MapStartpos } from './MapTypes';
import { BaseMapGenerationService } from './BaseMapGenerationService';
import { IslandGeneratorState } from './IslandGenerator';
import { islandTerrainInit } from './TerrainUtils';

/**
 * Island-based map generation service for ISLAND generator
 * Handles island generation algorithms using freeciv generators 2/3/4
 * @reference freeciv/server/generator/mapgen.c mapGenerator2/3/4()
 * @reference freeciv/server/generator/mapgen.c:1320-1341 MAPSTARTPOS routing
 */
export class IslandMapService extends BaseMapGenerationService {
  public setTerrainPercentages(percentages: typeof this.terrainPercentages): void {
    this.terrainPercentages = { ...percentages };
  }

  /**
   * Generate map using island-based algorithms
   * Routes to specific island generation methods based on start position mode
   */
  public async generateMap(
    players: Map<string, PlayerState>,
    startPosMode: MapStartpos = MapStartpos.ALL
  ): Promise<MapData> {
    logger.info('Generating map with island system', {
      width: this.width,
      height: this.height,
      seed: this.seed,
      startPosMode,
    });

    const startTime = Date.now();

    // Initialize map structure
    const tiles = this.initializeTiles();

    // Generate elevation for height-based terrain selection
    this.heightGenerator.generateHeightMap(players.size, startPosMode);
    const heightMap = this.heightGenerator.getHeightMap();

    // Apply height data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        tiles[x][y].elevation = heightMap[index];
      }
    }

    // Initialize island terrain selection system (like freeciv island_terrain_init())
    islandTerrainInit();

    // Freeciv creates the preliminary latitude-based temperature map before
    // running generators 2/3/4 so island terrain selectors can use it.
    this.temperatureMap.createTemperatureMap(tiles, heightMap, false);
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].temperature = this.temperatureMap.getTemperature(x, y);
      }
    }

    // Initialize world for island generation
    const state = this.islandGenerator.initializeWorldForIslands(
      tiles,
      this.calculateTotalMass(startPosMode)
    );

    // Initialize bucket system (call with islandMass=0 for initialization)
    await this.islandGenerator.makeIsland(0, 0, state, tiles, this.terrainPercentages);

    logger.info(`Using startpos mode '${startPosMode}' for ${players.size} players`, {
      reference: 'freeciv/server/generator/mapgen.c:1320-1341',
    });

    try {
      // Generate islands using startpos-based routing (freeciv MAPSTARTPOS logic)
      await this.generateIslandsByStartPosMode(state, tiles, players.size, startPosMode);
    } finally {
      this.islandGenerator.cleanup();
    }

    // Apply island-specific terrain processing
    await this.applyIslandTerrainProcessing(tiles);

    // Complete map generation with post-processing
    return this.completeIslandMapGeneration(tiles, players, startTime);
  }

  /**
   * Route to specific island generator based on start position mode
   * @reference freeciv/server/generator/mapgen.c:1320-1341 MAPSTARTPOS logic
   */
  private async generateIslandsByStartPosMode(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number,
    startPosMode: MapStartpos
  ): Promise<void> {
    switch (startPosMode) {
      case MapStartpos.VARIABLE:
        // MAPSTARTPOS_VARIABLE uses mapgenerator2 (70% big / 20% medium / 10% small)
        await this.mapGenerator2(state, tiles, playerCount);
        break;
      case MapStartpos.DEFAULT:
      case MapStartpos.SINGLE:
        // MAPSTARTPOS_DEFAULT || MAPSTARTPOS_SINGLE uses mapgenerator3 (several large islands)
        await this.mapGenerator3(state, tiles, playerCount);
        break;
      case MapStartpos.TWO_ON_THREE:
      case MapStartpos.ALL:
      default:
        // MAPSTARTPOS_2or3 || MAPSTARTPOS_ALL uses mapgenerator4 (many fair islands)
        await this.mapGenerator4(state, tiles, playerCount);
        break;
    }
  }

  /**
   * Map generator 2 - Big continents, medium islands, small islands (70/20/10 split)
   * @reference freeciv/server/generator/mapgen.c mapGenerator2()
   */
  private async mapGenerator2(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): Promise<void> {
    // Landpercent validation fallback (freeciv mapgen.c mapgenerator2())
    if (this.generationOptions.landPercent > 85) {
      logger.warn('Landpercent too high for mapGenerator2, falling back to random generator', {
        landpercent: this.generationOptions.landPercent,
        maxLandpercent: 85,
        reference: 'freeciv/server/generator/mapgen.c:2218-2223',
      });
      throw new Error('FALLBACK_TO_RANDOM');
    }

    // Put 70% of land in big continents, 20% in medium, and 10% in small
    let bigfrac = 70;
    let midfrac = 20;
    let smallfrac = 10;
    const totalweight = 100 * playerCount;

    let done = false;
    while (!done && bigfrac > midfrac) {
      done = true;
      for (let i = 0; i < playerCount; i++) {
        const placed = await this.islandGenerator.makeIsland(
          Math.floor((bigfrac * state.totalMass) / totalweight),
          1,
          state,
          tiles,
          this.terrainPercentages,
          95
        );
        if (placed) continue;

        // Reference retries the complete world with all large islands 5%
        // smaller, moving the released mass into medium/small islands.
        midfrac = Math.trunc(midfrac + bigfrac * 0.01);
        smallfrac = Math.trunc(smallfrac + bigfrac * 0.04);
        bigfrac = Math.trunc(bigfrac * 0.95);
        await this.resetIslandWorld(state, tiles);
        done = false;
        break;
      }
    }
    if (bigfrac <= midfrac) throw new Error('FALLBACK_TO_RANDOM');
    const bigIslandMass = Math.floor((bigfrac * state.totalMass) / totalweight);

    // Create medium islands
    const mediumIslandMass = Math.floor((midfrac * state.totalMass) / totalweight);
    for (let i = 0; i < playerCount; i++) {
      await this.islandGenerator.makeIsland(
        mediumIslandMass,
        0,
        state,
        tiles,
        this.terrainPercentages
      );
    }

    // Create small islands for remaining players
    const smallIslandMass = Math.floor((smallfrac * state.totalMass) / totalweight);
    for (let i = 0; i < playerCount; i++) {
      await this.islandGenerator.makeIsland(
        smallIslandMass,
        0,
        state,
        tiles,
        this.terrainPercentages
      );
    }

    logger.debug('MapGenerator2 completed', {
      bigIslandMass,
      mediumIslandMass,
      smallIslandMass,
      playerCount,
      reference: 'freeciv/server/generator/mapgen.c mapGenerator2()',
    });
  }

  /**
   * Map generator 3 - Several large islands suitable for multiple players each
   * @reference freeciv/server/generator/mapgen.c mapGenerator3()
   */
  private async mapGenerator3(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): Promise<void> {
    // Landpercent validation fallback (freeciv mapgen.c:2252-2257)
    if (this.generationOptions.landPercent > 80) {
      logger.warn('Landpercent too high for mapGenerator3, falling back to fractal generator', {
        landpercent: this.generationOptions.landPercent,
        maxLandpercent: 80,
        reference: 'freeciv/server/generator/mapgen.c:2252-2257',
      });
      throw new Error('FALLBACK_TO_FRACTAL');
    }

    // Size validation fallback - minimum 40x40 for mapGenerator3
    if (this.width < 40 || this.height < 40) {
      logger.warn('Map too small for mapGenerator3, falling back to fractal generator', {
        width: this.width,
        height: this.height,
        minSize: 40,
        reference: 'freeciv/server/generator/mapgen.c size requirements',
      });
      throw new Error('FALLBACK_TO_FRACTAL');
    }

    // Create a few large islands suitable for multiple players each
    const maxMassDiv6 = 20;
    const bigIslands = Math.max(1, playerCount);
    let landmass = Math.floor(
      (this.width * (this.height - 6) * this.generationOptions.landPercent) / 100
    );
    if (landmass > 3 * this.height + playerCount * 3) landmass -= 3 * this.height;

    let islandmass = Math.floor(landmass / (3 * bigIslands));
    if (islandmass < 4 * maxMassDiv6) islandmass = Math.floor(landmass / (2 * bigIslands));
    if (islandmass < 3 * maxMassDiv6 && playerCount * 2 < landmass) {
      islandmass = Math.floor(landmass / bigIslands);
    }
    islandmass = Math.max(2, Math.min(maxMassDiv6 * 6, islandmass));

    let attempts = 0;
    while (
      state.isleIndex - 2 <= bigIslands &&
      this.getRemainingIslandMass(state, tiles) > islandmass &&
      ++attempts < 500
    ) {
      await this.islandGenerator.makeIsland(islandmass, 1, state, tiles, this.terrainPercentages);
    }

    // Add some smaller supplementary islands
    islandmass = Math.max(2, Math.floor((islandmass * 11) / 8));

    while (this.getRemainingIslandMass(state, tiles) > islandmass && ++attempts < 1500) {
      let size =
        attempts < 1000
          ? Math.floor(this.random() * (Math.floor((islandmass + 1) / 2) + 1)) +
            Math.floor(islandmass / 2)
          : Math.floor(this.random() * (Math.floor((islandmass + 1) / 2) + 1));
      size = Math.max(2, size);
      await this.islandGenerator.makeIsland(
        size,
        state.isleIndex - 2 <= playerCount ? 1 : 0,
        state,
        tiles,
        this.terrainPercentages
      );
    }

    logger.debug('MapGenerator3 completed', {
      bigIslands,
      islandmass,
      playerCount,
      reference: 'freeciv/server/generator/mapgen.c mapGenerator3()',
    });
  }

  /**
   * Map generator 4 - Many islands, fair distribution
   * @reference freeciv/server/generator/mapgen.c mapGenerator4()
   */
  private async mapGenerator4(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): Promise<void> {
    // Freeciv downgrades startpos to SINGLE here, which immediately routes
    // through mapgenerator3 in the same generation pass.
    if (playerCount < 2 || this.generationOptions.landPercent > 80) {
      logger.warn('MapGenerator4 is infeasible, retrying with MapGenerator3', {
        landpercent: this.generationOptions.landPercent,
        maxLandpercent: 80,
        reference: 'freeciv/server/generator/mapgen.c:2260-2265',
      });
      return this.mapGenerator3(state, tiles, playerCount);
    }

    // Size validation warning - minimum 20x20 recommended for mapGenerator4
    if (this.width < 20 || this.height < 20) {
      logger.warn('Map very small for mapGenerator4, island distribution may be limited', {
        width: this.width,
        height: this.height,
        recommendedMinSize: 20,
        reference: 'freeciv/server/generator/mapgen.c size recommendations',
      });
    }

    let bigweight = 70;

    // Adjust big island weight based on land percentage
    const landPercent = this.generationOptions.landPercent;
    if (landPercent > 60) {
      bigweight = 30;
    } else if (landPercent > 40) {
      bigweight = 50;
    }

    const totalweight = (30 + bigweight) * playerCount;
    let i = Math.floor(playerCount / 2);

    // Create some 3-player big islands
    if ((playerCount & 1) === 1) {
      await this.islandGenerator.makeIsland(
        Math.floor((bigweight * 3 * state.totalMass) / totalweight),
        3,
        state,
        tiles,
        this.terrainPercentages
      );
    } else {
      i++;
    }

    // Create 2-player big islands
    while (--i > 0) {
      await this.islandGenerator.makeIsland(
        Math.floor((bigweight * 2 * state.totalMass) / totalweight),
        2,
        state,
        tiles,
        this.terrainPercentages
      );
    }

    // Create 1-player islands for remaining players
    for (let i = 0; i < playerCount; i++) {
      await this.islandGenerator.makeIsland(
        Math.floor((20 * state.totalMass) / totalweight),
        0,
        state,
        tiles,
        this.terrainPercentages
      );
    }
    for (let i = 0; i < playerCount; i++) {
      await this.islandGenerator.makeIsland(
        Math.floor((10 * state.totalMass) / totalweight),
        0,
        state,
        tiles,
        this.terrainPercentages
      );
    }

    logger.debug('MapGenerator4 completed', {
      bigweight,
      totalweight,
      playerCount,
      reference: 'freeciv/server/generator/mapgen.c mapGenerator4()',
    });
  }

  /**
   * Apply island-specific terrain processing
   * @reference freeciv/server/generator/mapgen.c island terrain processing
   */
  private async applyIslandTerrainProcessing(tiles: MapTile[][]): Promise<void> {
    // Phase 1 & 2 fix: Island generation handles its own temperature map creation during island generation
    // No external temperature map creation needed - islands use different flow than height-based generators

    // Post-island-generation processing - only operations that must happen after islands are placed
    this.terrainGenerator.smoothWaterDepth(tiles);

    // Turn small oceans into lakes (like freeciv regenerate_lakes())
    // @reference freeciv/server/generator/mapgen.c:1381
    this.terrainGenerator.regenerateLakes(tiles);

    // Phase 2 fix: Temperature map already handled during island generation
    // Only convert to enum format for compatibility
    this.terrainGenerator.convertTemperatureToEnum(tiles);
    this.terrainGenerator.generateWetnessMap(tiles, this.generationOptions.wetness);

    // Fill remaining unplaced tiles with plains/grassland/tundra (like freeciv make_plains())
    this.terrainGenerator.makePlains(tiles);

    // Freeciv generators 2/3/4 stop after make_plains(); applying the generic
    // biome smoother here can turn ocean tiles into land and break landmass.
  }

  private calculateTotalMass(startPosMode: MapStartpos): number {
    const landPercent = this.generationOptions.landPercent;
    const usesGenerator4 =
      startPosMode === MapStartpos.TWO_ON_THREE || startPosMode === MapStartpos.ALL;
    const spares = usesGenerator4 ? Math.floor((landPercent - 5) / 30) : 1;
    return ((this.height - 6 - spares) * landPercent * (this.width - spares)) / 100;
  }

  private async resetIslandWorld(state: IslandGeneratorState, tiles: MapTile[][]): Promise<void> {
    const reset = this.islandGenerator.initializeWorldForIslands(tiles, state.totalMass);
    Object.assign(state, reset);
    await this.islandGenerator.makeIsland(0, 0, state, tiles, this.terrainPercentages);
  }

  private getRemainingIslandMass(state: IslandGeneratorState, tiles: MapTile[][]): number {
    const placedLand = tiles.flat().filter(tile => tile.continentId > 0).length;
    return Math.max(0, state.totalMass - placedLand);
  }

  /**
   * Complete island map generation with post-processing and validation
   */
  private async completeIslandMapGeneration(
    tiles: MapTile[][],
    players: Map<string, PlayerState>,
    startTime: number
  ): Promise<MapData> {
    // Post-process the map with resources and starting positions
    const mapData = await this.postProcessMap(tiles, players);

    // Generation time and type are already set in map data

    const generationTime = Date.now() - startTime;

    // Validate generated map for quality assurance
    const validationResult = this.validateMap(tiles, players, mapData.startingPositions);

    logger.info('Island-based map generation completed', {
      generationTime,
      validation: {
        passed: validationResult.passed,
        score: validationResult.score,
        issues: validationResult.issues.length,
      },
    });

    return mapData;
  }

  /**
   * Override to return current tiles for land percentage calculation
   */
  protected getMapTiles(): MapTile[][] | null {
    // This will be set by the concrete implementation
    return null;
  }
}
