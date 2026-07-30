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

import { logger } from '@utils/logger';
import { MapTile, TerrainType, TemperatureType, MapStartpos } from './MapTypes';
import { PlayerState } from '@game/managers/GameManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { MapTopology, type MapTopologyOptions } from './MapTopology';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';

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
  private topology: MapTopology;

  constructor(
    width: number,
    height: number,
    topologyOptions: MapTopologyOptions = {},
    private readonly rulesetName: string = DEFAULT_RULESET
  ) {
    this.width = width;
    this.height = height;
    this.topology = new MapTopology(width, height, topologyOptions);
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
   * Ruleset-backed city output calculation used by Freeciv start scoring
   */
  private getCityTileOutput(tile: MapTile, outputType: 'food' | 'production' | 'trade'): number {
    const terrain = rulesetLoader.getTerrain(tile.terrain, this.rulesetName);
    const field = outputType === 'production' ? 'shields' : outputType;
    let output = terrain[field] ?? 0;

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
    try {
      const definition = rulesetLoader.getResource(resource, this.rulesetName);
      const field = outputType === 'production' ? 'shield' : outputType;
      const value = definition[field];
      return typeof value === 'number' ? value : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Calculate potential irrigation bonus
   */
  private getIrrigationBonus(tile: MapTile): number {
    return rulesetLoader.getTerrain(tile.terrain, this.rulesetName).irrigationFoodIncr ?? 0;
  }

  /**
   * Calculate potential mining bonus
   */
  private getMiningBonus(tile: MapTile): number {
    return rulesetLoader.getTerrain(tile.terrain, this.rulesetName).miningShieldIncr ?? 0;
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
    if (!tile.continentId || tile.continentId <= 0) return false; // Tile must have a valid continent ID
    const contSize = this.getContinentSize(tiles, tile.continentId);
    const island = this.islands.find(candidate => candidate?.id === tile.continentId);
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
    const flags = rulesetLoader.getTerrain(terrain, this.rulesetName).flags;
    return (Array.isArray(flags) ? flags : [flags]).includes('Starter');
  }

  /**
   * Check if terrain has TER_NO_CITIES flag equivalent
   */
  private isNoCitiesTerrain(terrain: TerrainType): boolean {
    const flags = rulesetLoader.getTerrain(terrain, this.rulesetName).flags;
    return (Array.isArray(flags) ? flags : [flags]).includes('NoCities');
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
        const counts = this.calculateTileValueCounts(x, y, thisTileValue, tileValueAux, cityRadius);
        lcount = counts.lcount;
        bcount = counts.bcount;

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
      logger.debug('Not enough continents; falling back to startpos=VARIABLE');
      mode = MapStartpos.VARIABLE;
    }

    if (mode === MapStartpos.ALL && this.islands.length > 1) {
      const totalGoodies = this.islands.slice(1).reduce((sum, island) => sum + island.goodies, 0);
      const efactor = playerCount / (this.width * this.height) / 4;
      const bestIsland = this.islands[1];
      if (
        bestIsland.goodies < playerCount * 1500 ||
        bestIsland.goodies < (totalGoodies * (0.5 + 0.8 * efactor)) / (1 + efactor)
      ) {
        logger.debug('No good enough island; falling back to startpos=VARIABLE');
        mode = MapStartpos.VARIABLE;
      }
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
      this.islands[i].total = 0;
    }

    switch (mode) {
      case MapStartpos.SINGLE:
        // One player per island
        for (let i = 1; i <= Math.min(playerCount, this.islands.length - 1); i++) {
          this.islands[i].starters = 1;
          this.islands[i].total = 1;
        }
        break;

      case MapStartpos.TWO_ON_THREE: {
        // 2-3 players per island
        let playersLeft = playerCount;
        for (let i = 1; i < this.islands.length && playersLeft > 0; i++) {
          const playersForIsland = Math.min(playersLeft, playersLeft <= 3 ? playersLeft : 2);
          this.islands[i].starters = playersForIsland;
          this.islands[i].total = playersForIsland;
          playersLeft -= playersForIsland;
        }
        break;
      }

      case MapStartpos.ALL:
        // All players on best island
        if (this.islands.length > 1) {
          this.islands[1].starters = playerCount;
          this.islands[1].total = playerCount;
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
        this.islands[i].total = this.islands[i].starters;
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
      this.islands[i].total = this.islands[i].starters;
      playersAssigned += this.islands[i].starters;
    }

    // Assign remaining players to best islands
    while (playersAssigned < playerCount) {
      for (let i = 1; i < this.islands.length && playersAssigned < playerCount; i++) {
        this.islands[i].starters++;
        this.islands[i].total++;
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
        let position = this.findBestPositionOnIsland(tiles, filterData, positions, island.id);

        if (!position) {
          // Freeciv progressively relaxes its value/distance filter while
          // retaining the selected island. Preserve that mode contract when
          // the strict pass cannot place every player.
          position = this.findFallbackPosition(tiles, positions, island.id);
          logger.warn('Used relaxed start-position filter for player', playerIds[playerIndex]);
        }

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
    existingPositions: Array<{ x: number; y: number }>,
    preferredContinentId?: number
  ): { x: number; y: number } {
    const candidates: Array<{ x: number; y: number; starter: boolean; score: number }> = [];
    const occupied = new Set(existingPositions.map(position => `${position.x},${position.y}`));
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (
          occupied.has(`${x},${y}`) ||
          this.isNoCitiesTerrain(tile.terrain) ||
          (preferredContinentId !== undefined && tile.continentId !== preferredContinentId)
        ) {
          continue;
        }
        const spacing =
          existingPositions.length === 0
            ? Math.max(this.width, this.height)
            : Math.min(
                ...existingPositions.map(position =>
                  this.realMapDistance(x, y, position.x, position.y)
                )
              );
        candidates.push({
          x,
          y,
          starter: this.isStarterTerrain(tile.terrain),
          score: spacing * 100 + this.getTileValue(tile),
        });
      }
    }

    candidates.sort((left, right) => {
      if (left.starter !== right.starter) return left.starter ? -1 : 1;
      return right.score - left.score;
    });
    const selected = candidates[0];
    if (!selected) throw new Error('Generated map has no city-capable starting tile');
    return { x: selected.x, y: selected.y };
  }

  /**
   * Calculate topology-aware real map distance
   */
  private realMapDistance(x1: number, y1: number, x2: number, y2: number): number {
    return this.topology.realDistance(x1, y1, x2, y2);
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
   * Calculate tile value counts within city radius
   */
  private calculateTileValueCounts(
    x: number,
    y: number,
    thisTileValue: number,
    tileValueAux: number[],
    cityRadius: number
  ): { lcount: number; bcount: number } {
    let lcount = 0;
    let bcount = 0;

    for (let nx = 0; nx < this.width; nx++) {
      for (let ny = 0; ny < this.height; ny++) {
        if (this.topology.squaredDistance(x, y, nx, ny) <= cityRadius * cityRadius) {
          const counts = this.compareTileValues(thisTileValue, tileValueAux, nx, ny);
          lcount += counts.lcount;
          bcount += counts.bcount;
        }
      }
    }

    return { lcount, bcount };
  }

  /**
   * Compare tile values and return count increments
   */
  private compareTileValues(
    thisTileValue: number,
    tileValueAux: number[],
    nx: number,
    ny: number
  ): { lcount: number; bcount: number } {
    const nIndex = ny * this.width + nx;

    if (thisTileValue > tileValueAux[nIndex]) {
      return { lcount: 1, bcount: 0 };
    } else if (thisTileValue < tileValueAux[nIndex]) {
      return { lcount: 0, bcount: 1 };
    }

    return { lcount: 0, bcount: 0 };
  }
}
