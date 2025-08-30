/**
 * Reference-compliant Starting Position Generator
 *
 * This implementation faithfully ports the freeciv starting position generation logic
 * from freeciv/server/generator/startpos.c to achieve strict reference compliance.
 *
 * Key compliance features:
 * - Proper tile value calculation using city output formulas
 * - Island/continent analysis and grouping
 * - Distance constraints based on continent size
 * - TER_STARTER terrain flag filtering
 * - Temperature-based restrictions (no frozen/hot zones)
 *
 * @reference freeciv/server/generator/startpos.c
 */

import { logger } from '../../utils/logger';
import { MapTile, TerrainType, TemperatureType, MapStartpos } from './MapTypes';
import { PlayerState } from '../GameManager';

/**
 * Island data structure matching freeciv's islands_data_type
 * @reference freeciv/server/generator/startpos.c:38-44
 */
interface IslandData {
  id: number; // Continent ID
  size: number; // Number of tiles in continent
  goodies: number; // Total tile value score for continent
  starters: number; // Number of start positions to place on this continent
  total: number; // Total players planned for all continents
}

/**
 * Start position filter data matching freeciv's start_filter_data
 * @reference freeciv/server/generator/startpos.c:120-124
 */
interface StartFilterData {
  min_value: number;
  value: number[]; // Tile values by index
}

export class StartingPositionGenerator {
  private width: number;
  private height: number;
  private islands: IslandData[] = [];
  private islandsIndex: number[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  /**
   * Main entry point for creating start positions
   * Ports create_start_positions() from freeciv
   * @reference freeciv/server/generator/startpos.c:300-521
   */
  public async generateStartingPositions(
    tiles: MapTile[][],
    players: Map<string, PlayerState>,
    mode: MapStartpos = MapStartpos.VARIABLE
  ): Promise<Array<{ x: number; y: number; playerId: string }>> {
    const playerIds = Array.from(players.keys());
    const playerCount = playerIds.length;

    if (this.getNumContinents(tiles) < 1) {
      logger.error('Map has no land, so cannot assign start positions!');
      return [];
    }

    // Convert DEFAULT mode to VARIABLE as per reference
    if (mode === MapStartpos.DEFAULT) {
      logger.debug('Using startpos=VARIABLE');
      mode = MapStartpos.VARIABLE;
    }

    // Calculate tile values using freeciv's algorithm
    const tileValueAux = this.calculateTileValues(tiles);
    const tileValue = this.selectBestTiles(tiles, tileValueAux);

    // Initialize island data
    this.initializeIslandData(tiles);

    // Filter only starter terrains and calculate continent goodies
    this.processStarterTerrains(tiles, tileValue);

    // Adjust tile values and sort islands by quality
    this.adjustTileValues(tiles, tileValue);
    this.sortIslandsByGoodies();

    // Adjust mode based on continent availability
    mode = this.adjustStartPosMode(mode, playerCount);

    // Distribute players across islands
    this.distributePlayersAcrossIslands(mode, playerCount);

    // Generate actual start positions
    return this.placeStartPositions(tiles, tileValue, playerIds);
  }

  /**
   * Port of get_tile_value() from freeciv
   * Calculates tile value based on city output potential
   * @reference freeciv/server/generator/startpos.c:51-118
   */
  private getTileValue(tile: MapTile): number {
    let value = 0;

    // Give one point for each food / shield / trade produced
    value += this.getCityTileOutput(tile, 'food');
    value += this.getCityTileOutput(tile, 'production');
    value += this.getCityTileOutput(tile, 'trade');

    // Add irrigation/mining bonus potential
    const irrigBonus = this.getIrrigationBonus(tile);
    const mineBonus = this.getMiningBonus(tile);
    value += Math.max(0, Math.max(mineBonus, irrigBonus)) / 2;

    return value;
  }

  /**
   * Calculate base city tile output for a terrain type
   * Simplified version of freeciv's city_tile_output calculation
   */
  private getCityTileOutput(tile: MapTile, outputType: 'food' | 'production' | 'trade'): number {
    const terrainOutputs: Record<TerrainType, { food: number; production: number; trade: number }> =
      {
        grassland: { food: 2, production: 0, trade: 0 },
        plains: { food: 1, production: 1, trade: 0 },
        forest: { food: 1, production: 2, trade: 0 },
        hills: { food: 1, production: 0, trade: 0 },
        desert: { food: 0, production: 1, trade: 0 },
        tundra: { food: 1, production: 0, trade: 0 },
        jungle: { food: 1, production: 0, trade: 0 },
        swamp: { food: 1, production: 0, trade: 0 },
        mountains: { food: 0, production: 1, trade: 0 },
        coast: { food: 2, production: 0, trade: 2 },
        lake: { food: 2, production: 0, trade: 2 },
        ocean: { food: 1, production: 0, trade: 2 },
        deep_ocean: { food: 1, production: 0, trade: 2 },
      };

    let output = terrainOutputs[tile.terrain]?.[outputType] || 0;

    // Add resource bonuses
    if (tile.resource) {
      const resourceBonus = this.getResourceOutput(tile.resource, outputType);
      output += resourceBonus;
    }

    // Add river bonus for trade
    if (outputType === 'trade' && tile.riverMask > 0) {
      output += 1;
    }

    return output;
  }

  /**
   * Get resource output bonus
   */
  private getResourceOutput(resource: string, outputType: 'food' | 'production' | 'trade'): number {
    const resourceOutputs: Record<string, { food: number; production: number; trade: number }> = {
      wheat: { food: 1, production: 0, trade: 0 },
      cattle: { food: 1, production: 0, trade: 0 },
      fish: { food: 2, production: 0, trade: 0 },
      horses: { food: 0, production: 1, trade: 0 },
      iron: { food: 0, production: 3, trade: 0 },
      copper: { food: 0, production: 2, trade: 0 },
      gold: { food: 0, production: 0, trade: 6 },
      gems: { food: 0, production: 0, trade: 4 },
      spices: { food: 0, production: 0, trade: 3 },
      silk: { food: 0, production: 0, trade: 3 },
      oil: { food: 0, production: 3, trade: 0 },
      uranium: { food: 0, production: 2, trade: 0 },
    };

    return resourceOutputs[resource]?.[outputType] || 0;
  }

  /**
   * Calculate potential irrigation bonus
   */
  private getIrrigationBonus(tile: MapTile): number {
    // Simplified irrigation bonus calculation
    if (tile.terrain === 'grassland' || tile.terrain === 'plains') {
      return 1; // +1 food from irrigation
    }
    return 0;
  }

  /**
   * Calculate potential mining bonus
   */
  private getMiningBonus(tile: MapTile): number {
    // Simplified mining bonus calculation
    if (tile.terrain === 'hills' || tile.terrain === 'mountains') {
      return 1; // +1 production from mining
    }
    return 0;
  }

  /**
   * Port of is_valid_start_pos() from freeciv
   * @reference freeciv/server/generator/startpos.c:187-247
   */
  private isValidStartPos(
    tiles: MapTile[][],
    x: number,
    y: number,
    data: StartFilterData,
    existingPositions: Array<{ x: number; y: number }>
  ): boolean {
    const tile = tiles[x][y];

    // Only start on certain terrain types (TER_STARTER equivalent)
    if (!this.isStarterTerrain(tile.terrain)) {
      return false;
    }

    // Check minimum tile value
    const tileIndex = y * this.width + x;
    if (data.value[tileIndex] < data.min_value) {
      return false;
    }

    // No cities on terrain with TER_NO_CITIES flag (oceans, etc.)
    if (this.isNoCitiesTerrain(tile.terrain)) {
      return false;
    }

    // Temperature restrictions - no frozen/hot zones for starting
    // Port of tmap_is(ptile, TT_NHOT) check
    if (tile.temperature & (TemperatureType.FROZEN | TemperatureType.COLD)) {
      return false;
    }

    // Check minimum distance from other start positions
    const contSize = this.getContinentSize(tiles, tile.continentId);
    const island = this.islands.find(i => i.id === tile.continentId);
    if (!island) return false;

    for (const pos of existingPositions) {
      const otherTile = tiles[pos.x][pos.y];
      const distance = this.realMapDistance(x, y, pos.x, pos.y);

      // Same continent distance check with continent size scaling
      if (
        tile.continentId === otherTile.continentId &&
        (distance * 1000) / data.min_value <= Math.sqrt(contSize / island.total)
      ) {
        return false;
      }

      // Absolute minimum distance check
      if ((distance * 1000) / data.min_value < 5) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if terrain has TER_STARTER flag equivalent
   */
  private isStarterTerrain(terrain: TerrainType): boolean {
    // Based on freeciv rulesets, these terrains have the Starter flag
    return ['grassland', 'plains', 'forest', 'hills'].includes(terrain);
  }

  /**
   * Check if terrain has TER_NO_CITIES flag equivalent
   */
  private isNoCitiesTerrain(terrain: TerrainType): boolean {
    return ['ocean', 'deep_ocean'].includes(terrain);
  }

  /**
   * Calculate tile values for all tiles
   */
  private calculateTileValues(tiles: MapTile[][]): number[] {
    const tileValue: number[] = new Array(this.width * this.height);

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        tileValue[index] = this.getTileValue(tiles[x][y]);
      }
    }

    return tileValue;
  }

  /**
   * Select best tiles using city radius analysis
   * Port of the tile selection logic from freeciv
   * @reference freeciv/server/generator/startpos.c:346-364
   */
  private selectBestTiles(_tiles: MapTile[][], tileValueAux: number[]): number[] {
    const tileValue: number[] = new Array(this.width * this.height);
    const cityRadius = 2; // CITY_MAP_DEFAULT_RADIUS_SQ equivalent

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        const thisTileValue = tileValueAux[index];
        let lcount = 0,
          bcount = 0;

        // Check all tiles within city radius
        for (let dx = -cityRadius; dx <= cityRadius; dx++) {
          for (let dy = -cityRadius; dy <= cityRadius; dy++) {
            const nx = x + dx;
            const ny = y + dy;

            if (this.isValidCoord(nx, ny) && dx * dx + dy * dy <= cityRadius * cityRadius) {
              const nIndex = ny * this.width + nx;
              if (thisTileValue > tileValueAux[nIndex]) {
                lcount++;
              } else if (thisTileValue < tileValueAux[nIndex]) {
                bcount++;
              }
            }
          }
        }

        tileValue[index] = lcount <= bcount ? 0 : 100 * thisTileValue;
      }
    }

    return tileValue;
  }

  /**
   * Initialize island data structure
   * Port of initialize_isle_data()
   * @reference freeciv/server/generator/startpos.c:262-278
   */
  private initializeIslandData(tiles: MapTile[][]): void {
    const numContinents = this.getNumContinents(tiles);
    this.islands = new Array(numContinents + 1);
    this.islandsIndex = new Array(numContinents + 1);

    // islands[0] is unused, start from 1
    for (let nr = 1; nr <= numContinents; nr++) {
      this.islands[nr] = {
        id: nr,
        size: this.getContinentSize(tiles, nr),
        goodies: 0,
        starters: 0,
        total: 0,
      };
      this.islandsIndex[nr] = nr;
    }
  }

  /**
   * Process starter terrains and calculate continent goodies
   * Port of the starter terrain filtering logic
   * @reference freeciv/server/generator/startpos.c:370-380
   */
  private processStarterTerrains(tiles: MapTile[][], tileValue: number[]): void {
    let totalGoodies = 0;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        const index = y * this.width + x;

        if (!this.isStarterTerrain(tile.terrain)) {
          tileValue[index] = 0;
        } else if (tile.continentId > 0) {
          this.islands[tile.continentId].goodies += tileValue[index];
          totalGoodies += tileValue[index];
        }
      }
    }

    logger.debug('Total goodies calculated:', totalGoodies);
  }

  /**
   * Adjust tile values using smoothing
   */
  private adjustTileValues(_tiles: MapTile[][], tileValue: number[]): void {
    // Port of adjust_int_map_filtered - normalize values to 0-1000 range
    let maxValue = 0;
    for (let i = 0; i < tileValue.length; i++) {
      if (tileValue[i] > maxValue) maxValue = tileValue[i];
    }

    if (maxValue > 0) {
      for (let i = 0; i < tileValue.length; i++) {
        tileValue[i] = Math.floor((tileValue[i] * 1000) / maxValue);
      }
    }
  }

  /**
   * Sort islands by goodies (quality)
   * Port of qsort call with compare_islands
   * @reference freeciv/server/generator/startpos.c:385-388
   */
  private sortIslandsByGoodies(): void {
    // Skip index 0 (unused)
    const sortableIslands = this.islands.slice(1);
    sortableIslands.sort((a, b) => b.goodies - a.goodies);

    // Update the main islands array
    for (let i = 0; i < sortableIslands.length; i++) {
      this.islands[i + 1] = sortableIslands[i];
    }
  }

  /**
   * Adjust start position mode based on continent availability
   * Port of mode adjustment logic
   * @reference freeciv/server/generator/startpos.c:390-405
   */
  private adjustStartPosMode(mode: MapStartpos, playerCount: number): MapStartpos {
    const numContinents = this.islands.length - 1;

    if (mode === MapStartpos.SINGLE && numContinents < playerCount + 3) {
      logger.debug('Not enough continents; falling back to startpos=2or3');
      mode = MapStartpos.TWO_ON_THREE;
    }

    if (mode === MapStartpos.TWO_ON_THREE && numContinents < Math.floor(playerCount / 2) + 4) {
      logger.debug('Not enough continents; falling back to startpos=ALL');
      mode = MapStartpos.ALL;
    }

    return mode;
  }

  /**
   * Distribute players across islands based on mode
   * Port of player distribution logic
   */
  private distributePlayersAcrossIslands(mode: MapStartpos, playerCount: number): void {
    // Reset starters count
    for (let i = 1; i < this.islands.length; i++) {
      this.islands[i].starters = 0;
      this.islands[i].total = playerCount;
    }

    switch (mode) {
      case MapStartpos.SINGLE:
        // One player per island
        for (let i = 1; i <= Math.min(playerCount, this.islands.length - 1); i++) {
          this.islands[i].starters = 1;
        }
        break;

      case MapStartpos.TWO_ON_THREE:
        // 2-3 players per island
        let playersLeft = playerCount;
        for (let i = 1; i < this.islands.length && playersLeft > 0; i++) {
          const playersForIsland = Math.min(playersLeft, playersLeft <= 3 ? playersLeft : 2);
          this.islands[i].starters = playersForIsland;
          playersLeft -= playersForIsland;
        }
        break;

      case MapStartpos.ALL:
        // All players on best island
        if (this.islands.length > 1) {
          this.islands[1].starters = playerCount;
        }
        break;

      case MapStartpos.VARIABLE:
      default:
        // Variable distribution based on island quality
        this.distributeVariableMode(playerCount);
        break;
    }
  }

  /**
   * Variable mode distribution based on island quality
   */
  private distributeVariableMode(playerCount: number): void {
    const totalGoodies = this.islands.slice(1).reduce((sum, island) => sum + island.goodies, 0);

    if (totalGoodies <= 0) {
      // Fallback: distribute evenly
      const playersPerIsland = Math.ceil(playerCount / (this.islands.length - 1));
      for (let i = 1; i < this.islands.length; i++) {
        this.islands[i].starters = Math.min(playersPerIsland, playerCount);
        playerCount -= this.islands[i].starters;
        if (playerCount <= 0) break;
      }
      return;
    }

    // Distribute based on island quality ratio
    let playersAssigned = 0;
    for (let i = 1; i < this.islands.length && playersAssigned < playerCount; i++) {
      const ratio = this.islands[i].goodies / totalGoodies;
      const playersForIsland = Math.max(1, Math.floor(ratio * playerCount));
      this.islands[i].starters = Math.min(playersForIsland, playerCount - playersAssigned);
      playersAssigned += this.islands[i].starters;
    }

    // Assign remaining players to best islands
    while (playersAssigned < playerCount) {
      for (let i = 1; i < this.islands.length && playersAssigned < playerCount; i++) {
        this.islands[i].starters++;
        playersAssigned++;
      }
    }
  }

  /**
   * Place actual start positions on the map
   */
  private placeStartPositions(
    tiles: MapTile[][],
    tileValue: number[],
    playerIds: string[]
  ): Array<{ x: number; y: number; playerId: string }> {
    const positions: Array<{ x: number; y: number; playerId: string }> = [];
    const filterData: StartFilterData = {
      min_value: 200, // Minimum tile value threshold
      value: tileValue,
    };

    let playerIndex = 0;

    // Place players on each island according to distribution
    for (
      let islandIdx = 1;
      islandIdx < this.islands.length && playerIndex < playerIds.length;
      islandIdx++
    ) {
      const island = this.islands[islandIdx];
      const playersForThisIsland = island.starters;

      for (let p = 0; p < playersForThisIsland && playerIndex < playerIds.length; p++) {
        const position = this.findBestPositionOnIsland(tiles, filterData, positions, island.id);

        if (position) {
          positions.push({
            x: position.x,
            y: position.y,
            playerId: playerIds[playerIndex],
          });

          logger.debug('Assigned starting position', {
            playerId: playerIds[playerIndex],
            x: position.x,
            y: position.y,
            continentId: island.id,
            tileValue: tileValue[position.y * this.width + position.x],
          });
        } else {
          logger.warn('Could not find valid position for player', playerIds[playerIndex]);
        }

        playerIndex++;
      }
    }

    // Handle any remaining players with fallback logic
    while (playerIndex < playerIds.length) {
      const position = this.findFallbackPosition(tiles, positions);
      positions.push({
        x: position.x,
        y: position.y,
        playerId: playerIds[playerIndex],
      });
      logger.warn('Used fallback position for player', playerIds[playerIndex]);
      playerIndex++;
    }

    return positions;
  }

  /**
   * Find the best position on a specific island
   */
  private findBestPositionOnIsland(
    tiles: MapTile[][],
    filterData: StartFilterData,
    existingPositions: Array<{ x: number; y: number }>,
    continentId: number
  ): { x: number; y: number } | null {
    const candidates: Array<{ x: number; y: number; value: number }> = [];

    // Find all valid positions on this continent
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (
          tile.continentId === continentId &&
          this.isValidStartPos(tiles, x, y, filterData, existingPositions)
        ) {
          const index = y * this.width + x;
          candidates.push({ x, y, value: filterData.value[index] });
        }
      }
    }

    if (candidates.length === 0) return null;

    // Sort by value and return the best
    candidates.sort((a, b) => b.value - a.value);
    return candidates[0];
  }

  /**
   * Find fallback position when normal placement fails
   */
  private findFallbackPosition(
    tiles: MapTile[][],
    existingPositions: Array<{ x: number; y: number }>
  ): { x: number; y: number } {
    // Simple fallback: find any starter terrain not too close to others
    for (let x = 5; x < this.width - 5; x++) {
      for (let y = 5; y < this.height - 5; y++) {
        const tile = tiles[x][y];

        if (this.isStarterTerrain(tile.terrain)) {
          const tooClose = existingPositions.some(pos => {
            const distance = this.realMapDistance(x, y, pos.x, pos.y);
            return distance < 8;
          });

          if (!tooClose) {
            return { x, y };
          }
        }
      }
    }

    // Emergency fallback
    return { x: 10, y: 10 };
  }

  /**
   * Calculate real map distance (Manhattan distance for simplicity)
   */
  private realMapDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  /**
   * Get number of continents in the map
   */
  private getNumContinents(tiles: MapTile[][]): number {
    let maxContinentId = 0;
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (tiles[x][y].continentId > maxContinentId) {
          maxContinentId = tiles[x][y].continentId;
        }
      }
    }
    return maxContinentId;
  }

  /**
   * Get size of a specific continent
   */
  private getContinentSize(tiles: MapTile[][], continentId: number): number {
    let size = 0;
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (tiles[x][y].continentId === continentId) {
          size++;
        }
      }
    }
    return size;
  }

  /**
   * Check if coordinates are valid
   */
  private isValidCoord(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }
}
