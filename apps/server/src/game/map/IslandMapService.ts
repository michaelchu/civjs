import { logger } from '../../utils/logger';
import { PlayerState } from '../GameManager';
import { MapData, MapTile, MapStartpos } from './MapTypes';
import { BaseMapGenerationService } from './BaseMapGenerationService';
import { IslandGeneratorState } from './IslandGenerator';
import { islandTerrainInit, fillIslandTerrain } from './TerrainUtils';

/**
 * Island-based map generation service for ISLAND generator
 * Handles island generation algorithms using freeciv generators 2/3/4
 * @reference freeciv/server/generator/mapgen.c mapGenerator2/3/4()
 * @reference freeciv/server/generator/mapgen.c:1320-1341 MAPSTARTPOS routing
 */
export class IslandMapService extends BaseMapGenerationService {
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
    this.heightGenerator.generateHeightMap();
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

    // Initialize world for island generation
    const state = this.islandGenerator.initializeWorldForIslands(tiles);

    // Initialize bucket system (call with islandMass=0 for initialization)
    await this.islandGenerator.makeIsland(0, 0, state, tiles, this.terrainPercentages);

    logger.info(`Using startpos mode '${startPosMode}' for ${players.size} players`, {
      reference: 'freeciv/server/generator/mapgen.c:1320-1341',
    });

    // Generate islands using startpos-based routing (freeciv MAPSTARTPOS logic)
    await this.generateIslandsByStartPosMode(state, tiles, players.size, startPosMode);

    // Cleanup
    this.islandGenerator.cleanup();

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
    // Landpercent validation fallback (freeciv mapgen.c:2218-2223)
    if (this.getLandPercent(tiles) > 85) {
      logger.warn('Landpercent too high for mapGenerator2, falling back to random generator', {
        landpercent: this.getLandPercent(tiles),
        maxLandpercent: 85,
        reference: 'freeciv/server/generator/mapgen.c:2218-2223',
      });
      throw new Error('FALLBACK_TO_RANDOM');
    }

    // Size validation fallback - minimum 30x30 for mapGenerator2 (large continents)
    if (this.width < 30 || this.height < 30) {
      logger.warn('Map too small for mapGenerator2 large continents, using mapGenerator4', {
        width: this.width,
        height: this.height,
        minSize: 30,
        reference: 'freeciv/server/generator/mapgen.c size requirements for large continents',
      });
      return this.mapGenerator4(state, tiles, playerCount);
    }

    // Put 70% of land in big continents, 20% in medium, and 10% in small
    const bigfrac = 70,
      midfrac = 20,
      smallfrac = 10;
    const totalweight = playerCount + 2;

    // Create one large continent for most players
    const bigIslandMass = Math.floor((bigfrac * state.totalMass) / totalweight);
    await this.islandGenerator.makeIsland(
      bigIslandMass,
      1,
      state,
      tiles,
      this.terrainPercentages,
      95 // min 95% of requested size
    );

    // Create medium islands
    const mediumIslandMass = Math.floor((midfrac * state.totalMass) / totalweight);
    await this.islandGenerator.makeIsland(
      mediumIslandMass,
      0,
      state,
      tiles,
      this.terrainPercentages
    );

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
    if (this.getLandPercent(tiles) > 85) {
      logger.warn('Landpercent too high for mapGenerator3, falling back to random generator', {
        landpercent: this.getLandPercent(tiles),
        maxLandpercent: 85,
        reference: 'freeciv/server/generator/mapgen.c:2252-2257',
      });
      throw new Error('FALLBACK_TO_RANDOM');
    }

    // Size validation fallback - minimum 40x40 for mapGenerator3
    if (this.width < 40 || this.height < 40) {
      logger.warn('Map too small for mapGenerator3, using mapGenerator4', {
        width: this.width,
        height: this.height,
        minSize: 40,
        reference: 'freeciv/server/generator/mapgen.c size requirements',
      });
      return this.mapGenerator4(state, tiles, playerCount);
    }

    // Create a few large islands suitable for multiple players each
    const maxMassDiv6 = 20;
    const bigIslands = Math.floor(Math.sqrt(playerCount)) || 1;

    let landmass = state.totalMass;
    const islandmass = Math.floor(landmass / bigIslands);
    let size = islandmass;

    // Create big islands for players
    for (let j = 0; j < bigIslands && j < 500; j++) {
      await this.islandGenerator.makeIsland(size, 1, state, tiles, this.terrainPercentages);

      landmass -= size;
      if (landmass < islandmass / maxMassDiv6) break;
    }

    // Add some smaller supplementary islands
    size = Math.floor((islandmass * 11) / 8);
    if (size < 2) size = 2;

    for (let j = 0; j < playerCount && j < 1500; j++) {
      await this.islandGenerator.makeIsland(size, 0, state, tiles, this.terrainPercentages);

      landmass -= size;
      if (landmass <= 0) break;
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
    // Landpercent validation fallback (freeciv mapgen.c:2260-2265)
    if (this.getLandPercent(tiles) > 85) {
      logger.warn('Landpercent too high for mapGenerator4, falling back to random generator', {
        landpercent: this.getLandPercent(tiles),
        maxLandpercent: 85,
        reference: 'freeciv/server/generator/mapgen.c:2260-2265',
      });
      throw new Error('FALLBACK_TO_RANDOM');
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
    const landPercent = 30; // Our default 30% land coverage
    if (landPercent > 60) {
      bigweight = 30;
    } else if (landPercent > 40) {
      bigweight = 50;
    }

    const totalweight = bigweight + (100 - bigweight);
    let i = Math.floor(playerCount / 3);

    // Create some 3-player big islands
    if (i === 0 && playerCount > 2) {
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
    const remainingPlayers = playerCount - Math.floor(playerCount / 3) * 3;
    for (let i = 0; i < remainingPlayers; i++) {
      await this.islandGenerator.makeIsland(
        Math.floor(((100 - bigweight) * state.totalMass) / totalweight),
        1,
        state,
        tiles,
        this.terrainPercentages
      );
    }

    logger.debug('MapGenerator4 completed', {
      bigweight,
      totalweight,
      playerCount,
      remainingPlayers,
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
    this.terrainGenerator.generateWetnessMap(tiles);

    // Apply climate-based terrain variety to islands using freeciv's terrain selection system
    await this.applyIslandTerrainVariety(tiles);

    // Fill remaining unplaced tiles with plains/grassland/tundra (like freeciv make_plains())
    this.terrainGenerator.makePlains(tiles);

    // Apply final terrain improvements
    this.terrainGenerator.applyBiomeTransitions(tiles);
  }

  /**
   * Apply climate-based terrain variety to islands
   * @reference freeciv/server/generator/mapgen.c terrain variety application
   */
  private async applyIslandTerrainVariety(tiles: MapTile[][]): Promise<void> {
    logger.info('Applying climate-based terrain variety to islands');

    // Calculate terrain counts based on total landmass and terrain percentages
    let totalLandTiles = 0;
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (tile.terrain === 'grassland' || tile.terrain === 'plains') {
          totalLandTiles++;
        }
      }
    }

    const forestCount = Math.floor((totalLandTiles * this.terrainPercentages.forest) / 100);
    const desertCount = Math.floor((totalLandTiles * this.terrainPercentages.desert) / 100);
    const mountainCount = Math.floor((totalLandTiles * this.terrainPercentages.mountain) / 100);
    const swampCount = Math.floor((totalLandTiles * this.terrainPercentages.swamp) / 100);

    logger.debug('Terrain variety targets', {
      totalLandTiles,
      forestCount,
      desertCount,
      mountainCount,
      swampCount,
    });

    // Apply terrain types using freeciv's climate-based selection
    for (let continentId = 1; continentId <= 10; continentId++) {
      // Check if this continent exists
      const continentTiles = this.getContinentTiles(tiles, continentId);
      if (continentTiles.length === 0) continue;

      const continentLandRatio = continentTiles.length / totalLandTiles;

      // Apply terrain proportionally to continent size
      fillIslandTerrain(
        tiles,
        'forest',
        Math.floor(forestCount * continentLandRatio),
        continentId,
        this.random
      );

      fillIslandTerrain(
        tiles,
        'desert',
        Math.floor(desertCount * continentLandRatio),
        continentId,
        this.random
      );

      fillIslandTerrain(
        tiles,
        'mountain',
        Math.floor(mountainCount * continentLandRatio),
        continentId,
        this.random
      );

      fillIslandTerrain(
        tiles,
        'swamp',
        Math.floor(swampCount * continentLandRatio),
        continentId,
        this.random
      );
    }

    logger.info('Climate-based terrain variety applied successfully');
  }

  /**
   * Get all land tiles belonging to a specific continent
   */
  private getContinentTiles(tiles: MapTile[][], continentId: number): MapTile[] {
    const continentTiles: MapTile[] = [];

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (
          tile.continentId === continentId &&
          (tile.terrain === 'grassland' || tile.terrain === 'plains')
        ) {
          continentTiles.push(tile);
        }
      }
    }

    return continentTiles;
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
    const validationResult = this.validateMap(tiles, players);

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
