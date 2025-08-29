/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GameState, MapViewport, Tile, Unit, City } from '../../types';
import { TilesetLoader } from './TilesetLoader';
import {
  MATCH_NONE,
  MATCH_SAME,
  MATCH_PAIR,
  MATCH_FULL,
  CELL_WHOLE,
  CELL_CORNER,
  DIR4_TO_DIR8,
  CARDINAL_TILESET_DIRS,
} from '../../constants/freeciv';

declare global {
  interface Window {
    spritesLogged?: boolean;
  }
}

interface RenderState {
  viewport: MapViewport;
  map: GameState['map'];
  units: GameState['units'];
  cities: GameState['cities'];
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private tileWidth = 96;
  private tileHeight = 48;

  // Tileset loader for sprite management
  private tilesetLoader: TilesetLoader;
  private isInitialized = false;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.tilesetLoader = new TilesetLoader();
    this.setupCanvas();
  }

  async initialize(serverUrl: string): Promise<void> {
    try {
      await this.tilesetLoader.loadTileset(serverUrl);

      const tileSize = this.tilesetLoader.getTileSize();
      this.tileWidth = tileSize.width;
      this.tileHeight = tileSize.height;

      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize MapRenderer:', error);
      throw error;
    }
  }

  private setupCanvas() {
    // Disable image smoothing for pixel-perfect sprite rendering
    this.ctx.imageSmoothingEnabled = false;
    // Also disable webkitImageSmoothingEnabled for older browsers
    (this.ctx as any).webkitImageSmoothingEnabled = false;
    (this.ctx as any).mozImageSmoothingEnabled = false;
    (this.ctx as any).msImageSmoothingEnabled = false;

    this.ctx.font = '14px Arial, sans-serif';
  }

  render(state: RenderState) {
    // Reset tile map cache if tiles data has changed
    const currentGlobalTiles = (window as any).tiles;
    if (currentGlobalTiles && currentGlobalTiles !== this.lastGlobalTiles) {
      this.tileMapBuilt = false;
      this.lastGlobalTiles = currentGlobalTiles;
    }

    if (!this.isInitialized) {
      this.clearCanvas();
      this.renderLoadingMessage();
      return;
    }

    // Check for freeciv-web global tiles array instead of state.map.tiles
    const globalTiles = (window as any).tiles;
    const globalMap = (window as any).map;

    if (!globalTiles || !globalMap || !Array.isArray(globalTiles) || globalTiles.length === 0) {
      this.clearCanvas();
      this.renderEmptyMap();
      return;
    }

    /**
     * Implement freeciv-web's map boundary handling to fix diamond-shaped map edges.
     *
     * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:282-291
     *   The original boundary detection and background filling logic that prevents
     *   diamond-shaped map edges by filling out-of-bounds areas with background color.
     */
    const viewportExceedsMapBounds = this.checkViewportBounds(state.viewport);

    if (viewportExceedsMapBounds) {
      // Clear canvas without background fill (freeciv-web uses rgb(0,0,0) black)
      // We improve on this by rendering actual ocean tiles instead of solid color
      this.clearCanvas(false);

      // Render ocean tiles in out-of-bounds areas (enhancement over freeciv-web's black fill)
      // This creates a more seamless infinite world appearance
      this.renderOceanPadding(state.viewport, globalMap);
    } else {
      // Normal ocean background when viewport is entirely within map bounds
      this.clearCanvas(true, '#4682B4');
    }

    const visibleTiles = this.getVisibleTilesFromGlobal(state.viewport, globalMap, globalTiles);

    for (const tile of visibleTiles) {
      this.renderTile(tile, state.viewport);
    }

    Object.values(state.units).forEach(unit => {
      if (this.isInViewport(unit.x, unit.y, state.viewport)) {
        this.renderUnit(unit, state.viewport);
      }
    });

    Object.values(state.cities).forEach(city => {
      if (this.isInViewport(city.x, city.y, state.viewport)) {
        this.renderCity(city, state.viewport);
      }
    });

    if (import.meta.env.DEV && this.isInitialized) {
      // Uncomment to see the diamond grid overlay
      // this.debugRenderGrid(state.viewport, true);
    }
  }

  private clearCanvas(fillBackground = true, backgroundColor = '#4682B4') {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

    if (fillBackground) {
      this.ctx.fillStyle = backgroundColor;
      this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    }
  }

  private renderEmptyMap() {
    this.ctx.strokeStyle = '#336699';
    this.ctx.lineWidth = 1;

    const gridSize = 50;
    for (let x = 0; x < this.ctx.canvas.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.ctx.canvas.height);
      this.ctx.stroke();
    }

    for (let y = 0; y < this.ctx.canvas.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.ctx.canvas.width, y);
      this.ctx.stroke();
    }

    this.ctx.fillStyle = 'white';
    this.ctx.font = '24px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      'No Map Data - Connect to Server',
      this.ctx.canvas.width / 2,
      this.ctx.canvas.height / 2
    );
  }

  private renderLoadingMessage() {
    this.ctx.fillStyle = 'white';
    this.ctx.font = '20px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Loading Tileset...', this.ctx.canvas.width / 2, this.ctx.canvas.height / 2);
  }

  private renderTile(tile: Tile, viewport: MapViewport) {
    const screenPos = this.mapToScreen(tile.x, tile.y, viewport);

    // Render multi-layer terrain like freeciv-web does
    this.renderTerrainLayers(tile, screenPos);
  }

  private renderTerrainLayers(tile: Tile, screenPos: { x: number; y: number }) {
    let hasAnySprites = false;

    // Render all layers (0, 1, 2) like freeciv-web does
    for (let layer = 0; layer <= 2; layer++) {
      const sprites = this.fillTerrainSpriteArraySimple(layer, tile);

      if (sprites.length > 0) {
        hasAnySprites = true;
      }

      for (const spriteInfo of sprites) {
        let sprite = this.tilesetLoader.getSprite(spriteInfo.key);

        // Enhanced fallback system: try comprehensive fallbacks before giving up
        if (!sprite) {
          sprite = this.tilesetLoader.getSpriteWithFallback(spriteInfo.key);
        }

        // Additional terrain-specific fallbacks
        if (!sprite) {
          sprite = this.tryTerrainSpriteFallbacks(tile, layer);
        }

        if (sprite) {
          const offsetX = spriteInfo.offset_x || 0;
          const offsetY = spriteInfo.offset_y || 0;

          // Copy freeciv-web logic exactly: pcanvas.drawImage(sprites[tag], canvas_x, canvas_y);
          this.ctx.drawImage(sprite, screenPos.x + offsetX, screenPos.y + offsetY);
          hasAnySprites = true;
        } else if (import.meta.env.DEV) {
          // Log missing sprites in development for debugging
          console.warn(`No sprite or fallback found for: ${spriteInfo.key}`);
        }
      }
    }

    // Render river overlay after terrain layers (like freeciv-web LAYER_SPECIAL1)
    if (tile.riverMask && tile.riverMask > 0) {
      const riverSprite = this.getRiverSprite(tile);
      if (riverSprite) {
        let sprite = this.tilesetLoader.getSprite(riverSprite.key);

        // Enhanced fallback system for rivers
        if (!sprite) {
          sprite = this.tilesetLoader.getSpriteWithFallback(riverSprite.key);
        }

        // Try additional river-specific fallbacks
        if (!sprite) {
          sprite = this.tryRiverSpriteFallbacks(tile.riverMask);
        }

        if (sprite) {
          const offsetX = riverSprite.offset_x || 0;
          const offsetY = riverSprite.offset_y || 0;
          this.ctx.drawImage(sprite, screenPos.x + offsetX, screenPos.y + offsetY);
          hasAnySprites = true;
        } else if (import.meta.env.DEV) {
          // In development, render a simple blue line to indicate river presence
          this.renderRiverFallback(tile, screenPos);
        }
      }
    }

    // Last resort: if no sprites rendered, show solid color (but this should be rare now)
    if (!hasAnySprites) {
      const color = this.getTerrainColor(tile.terrain);
      this.ctx.fillStyle = color;
      this.ctx.fillRect(screenPos.x, screenPos.y, this.tileWidth, this.tileHeight);

      // Log this as a potential issue in development
      if (import.meta.env.DEV) {
        console.warn(
          `Fell back to solid color for terrain: ${tile.terrain} at (${tile.x}, ${tile.y})`
        );
      }
    }
  }

  /**
   * Get river sprite based on riverMask connections (freeciv-web implementation port)
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1208-1243 get_tile_river_sprite()
   */
  private getRiverSprite(tile: Tile): { key: string; offset_x?: number; offset_y?: number } | null {
    if (!tile.riverMask || tile.riverMask === 0) {
      return null;
    }

    // Direction mapping for riverMask bits: N=1, E=2, S=4, W=8
    // Freeciv-web uses cardinal_tileset_dirs = [DIR8_NORTH, DIR8_EAST, DIR8_SOUTH, DIR8_WEST]
    const directions = ['n', 'e', 's', 'w'];
    let riverStr = '';

    // Build river direction string based on riverMask bits
    for (let i = 0; i < 4; i++) {
      const hasConnection = (tile.riverMask & (1 << i)) !== 0;
      riverStr += directions[i] + (hasConnection ? '1' : '0');
    }

    // Generate river sprite key following freeciv-web pattern
    const spriteKey = `road.river_s_${riverStr}`;

    return { key: spriteKey };
  }

  // TODO: Implement checkForRiverOutlet for coastal tiles with river outlets
  // @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1230-1238

  /**
   * Enhanced terrain sprite fallback system
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:120-126 graphic_alt fallback pattern
   */
  private tryTerrainSpriteFallbacks(tile: Tile, layer: number): HTMLCanvasElement | null {
    const mappedTerrain = this.mapTerrainName(tile.terrain);

    // Try basic terrain sprite without match patterns
    const basicSprite = this.tilesetLoader.getSprite(`t.l${layer}.${mappedTerrain}1`);
    if (basicSprite) {
      return basicSprite;
    }

    // Try simple match patterns
    const simpleFallbacks = [
      `t.l${layer}.${mappedTerrain}_n0e0s0w0`,
      `t.l${layer}.${mappedTerrain}_cell_u_u_u_u`,
    ];

    for (const fallbackKey of simpleFallbacks) {
      const sprite = this.tilesetLoader.getSprite(fallbackKey);
      if (sprite) {
        return sprite;
      }
    }

    // Try alternative terrain graphics for similar terrains
    const terrainAlternatives: Record<string, string[]> = {
      coast: ['floor', 'lake'],
      floor: ['coast'],
      lake: ['coast', 'floor'],
      arctic: ['tundra', 'plains'],
      jungle: ['forest'],
      swamp: ['grassland'],
    };

    if (terrainAlternatives[mappedTerrain]) {
      for (const altTerrain of terrainAlternatives[mappedTerrain]) {
        const altSprite = this.tilesetLoader.getSprite(`t.l${layer}.${altTerrain}1`);
        if (altSprite) {
          return altSprite;
        }
      }
    }

    return null;
  }

  /**
   * Enhanced river sprite fallback system
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas.js:100-150 fallback sprite handling
   */
  private tryRiverSpriteFallbacks(riverMask: number): HTMLCanvasElement | null {
    // Try to find a simpler river sprite that matches some of the connections
    const directions = ['n', 'e', 's', 'w'];

    // First try: match individual connections
    for (let i = 0; i < 4; i++) {
      if (riverMask & (1 << i)) {
        // Try single direction river
        let singleDirStr = '';
        for (let j = 0; j < 4; j++) {
          singleDirStr += directions[j] + (j === i ? '1' : '0');
        }
        const singleSprite = this.tilesetLoader.getSprite(`road.river_s_${singleDirStr}`);
        if (singleSprite) {
          return singleSprite;
        }
      }
    }

    // Fallback to simplest patterns
    const fallbackPatterns = [
      'road.river_s_n0e0s0w0', // No connections (isolated river)
      'road.river_s_n1e0s0w0', // North only
      'road.river_s_n0e1s0w0', // East only
      'road.river_s_n0e0s1w0', // South only
      'road.river_s_n0e0s0w1', // West only
      'road.river_s_n1e0s1w0', // North-South
      'road.river_s_n0e1s0w1', // East-West
    ];

    for (const pattern of fallbackPatterns) {
      const sprite = this.tilesetLoader.getSprite(pattern);
      if (sprite) {
        return sprite;
      }
    }

    return null;
  }

  /**
   * Render a simple fallback river visualization when sprites are missing
   */
  private renderRiverFallback(tile: Tile, screenPos: { x: number; y: number }): void {
    if (!tile.riverMask || tile.riverMask === 0) return;

    this.ctx.save();
    this.ctx.strokeStyle = '#4169E1'; // Royal blue for rivers
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = 'round';

    const centerX = screenPos.x + this.tileWidth / 2;
    const centerY = screenPos.y + this.tileHeight / 2;

    // Draw river connections based on riverMask bits
    if (tile.riverMask & 1) {
      // North
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY);
      this.ctx.lineTo(centerX, screenPos.y);
      this.ctx.stroke();
    }
    if (tile.riverMask & 2) {
      // East
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY);
      this.ctx.lineTo(screenPos.x + this.tileWidth, centerY);
      this.ctx.stroke();
    }
    if (tile.riverMask & 4) {
      // South
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY);
      this.ctx.lineTo(centerX, screenPos.y + this.tileHeight);
      this.ctx.stroke();
    }
    if (tile.riverMask & 8) {
      // West
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY);
      this.ctx.lineTo(screenPos.x, centerY);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  // Helper function to generate directional strings like "n0e0s0w0"
  private cardinalIndexStr(idx: number): string {
    const dirNames = ['n', 'e', 's', 'w']; // north, east, south, west
    let result = '';

    for (let i = 0; i < 4; i++) {
      const value = (idx >> i) & 1;
      result += dirNames[i] + value;
    }

    return result;
  }

  // Direct port of freeciv-web's fill_terrain_sprite_array function
  private fillTerrainSpriteArray(
    l: number,
    _ptile: any,
    pterrain: any,
    tterrain_near: any
  ): Array<{ key: string; offset_x?: number; offset_y?: number }> {
    // Get globals from window - these are loaded by the tileset scripts
    const tile_types_setup = (window as any).tile_types_setup || {};
    const tileset = (window as any).tileset || {};
    const ts_tiles = (window as any).ts_tiles || {};
    const cellgroup_map = (window as any).cellgroup_map || {};

    // Constants imported from freeciv constants module
    const num_cardinal_tileset_dirs = 4;
    const NUM_CORNER_DIRS = 4;
    const cardinal_tileset_dirs = CARDINAL_TILESET_DIRS;
    const dither_offset_x = [48, 0, 48, 0]; // Dither offsets for N, E, S, W (half tile width for N/S)
    const dither_offset_y = [0, 24, 24, 0]; // Dither offsets for N, E, S, W (half tile height for E/S)
    const tileset_tile_height = this.tileHeight;

    if (!tile_types_setup['l' + l + '.' + pterrain['graphic_str']]) {
      return [];
    }

    const dlp = tile_types_setup['l' + l + '.' + pterrain['graphic_str']];

    switch (dlp['sprite_type']) {
      case CELL_WHOLE:
        {
          switch (dlp['match_style']) {
            case MATCH_NONE: {
              const result_sprites: Array<{
                key: string;
                offset_x?: number;
                offset_y?: number;
              }> = [];
              if (dlp['dither'] == true) {
                for (let i = 0; i < num_cardinal_tileset_dirs; i++) {
                  if (
                    !tterrain_near ||
                    !tterrain_near[cardinal_tileset_dirs[i]] ||
                    !ts_tiles[tterrain_near[cardinal_tileset_dirs[i]]['graphic_str']]
                  )
                    continue;
                  const near_dlp =
                    tile_types_setup[
                      'l' + l + '.' + tterrain_near[cardinal_tileset_dirs[i]]['graphic_str']
                    ];
                  const terrain_near =
                    near_dlp && near_dlp['dither'] == true
                      ? tterrain_near[cardinal_tileset_dirs[i]]['graphic_str']
                      : pterrain['graphic_str'];
                  const dither_tile = i + pterrain['graphic_str'] + '_' + terrain_near;
                  const x = dither_offset_x[i];
                  const y = dither_offset_y[i];
                  result_sprites.push({
                    key: dither_tile,
                    offset_x: x,
                    offset_y: y,
                  });
                }
                return result_sprites;
              } else {
                return [{ key: 't.l' + l + '.' + pterrain['graphic_str'] + '1' }];
              }
            }

            case MATCH_SAME: {
              let tileno = 0;
              const this_match_type =
                ts_tiles[pterrain['graphic_str']] &&
                ts_tiles[pterrain['graphic_str']]['layer' + l + '_match_type'];

              if (this_match_type && tterrain_near) {
                for (let i = 0; i < num_cardinal_tileset_dirs; i++) {
                  const dir = cardinal_tileset_dirs[i];
                  if (!ts_tiles[tterrain_near[dir]['graphic_str']]) continue;
                  const that =
                    ts_tiles[tterrain_near[dir]['graphic_str']]['layer' + l + '_match_type'];
                  if (that == this_match_type) {
                    tileno |= 1 << i;
                  }
                }
              }

              const gfx_key =
                't.l' + l + '.' + pterrain['graphic_str'] + '_' + this.cardinalIndexStr(tileno);
              const y = tileset[gfx_key] ? tileset_tile_height - tileset[gfx_key][3] : 0;

              return [{ key: gfx_key, offset_x: 0, offset_y: y }];
            }
          }
        }
        break;

      case CELL_CORNER: {
        // Full CELL_CORNER implementation copied from freeciv-web
        const W = this.tileWidth;
        const H = this.tileHeight;
        const iso_offsets = [
          [W / 4, 0],
          [W / 4, H / 2],
          [W / 2, H / 4],
          [0, H / 4],
        ];

        // Get this terrain's match_index[0] from tile_types_setup
        const this_match_index = tile_types_setup['l' + l + '.' + pterrain['graphic_str']]
          ? tile_types_setup['l' + l + '.' + pterrain['graphic_str']]['match_index'][0]
          : -1;

        const result_sprites: Array<{
          key: string;
          offset_x?: number;
          offset_y?: number;
        }> = [];

        // Direction helper functions from freeciv-web
        const dir_cw = (dir: number): number => {
          switch (dir) {
            case 0:
              return 1; // NORTH to NORTHEAST
            case 1:
              return 2; // NORTHEAST to EAST
            case 2:
              return 3; // EAST to SOUTHEAST
            case 3:
              return 4; // SOUTHEAST to SOUTH
            case 4:
              return 5; // SOUTH to SOUTHWEST
            case 5:
              return 6; // SOUTHWEST to WEST
            case 6:
              return 7; // WEST to NORTHWEST
            case 7:
              return 0; // NORTHWEST to NORTH
          }
          return -1;
        };

        const dir_ccw = (dir: number): number => {
          switch (dir) {
            case 0:
              return 7; // NORTH to NORTHWEST
            case 1:
              return 0; // NORTHEAST to NORTH
            case 2:
              return 1; // EAST to NORTHEAST
            case 3:
              return 2; // SOUTHEAST to EAST
            case 4:
              return 3; // SOUTH to SOUTHEAST
            case 5:
              return 4; // SOUTHWEST to SOUTH
            case 6:
              return 5; // WEST to SOUTHWEST
            case 7:
              return 6; // NORTHWEST to WEST
          }
          return -1;
        };

        // Put corner cells - complete implementation from freeciv-web
        for (let i = 0; i < NUM_CORNER_DIRS; i++) {
          const count = dlp['match_indices'] || 1;
          let array_index = 0;
          const dir = dir_ccw(DIR4_TO_DIR8[i]);
          const x = iso_offsets[i][0];
          const y = iso_offsets[i][1];

          // Get match_index[0] for the three neighboring terrain tiles for this corner
          // This matches the original freeciv-web implementation exactly
          const m = [
            // Counter-clockwise neighbor
            tile_types_setup['l' + l + '.' + tterrain_near[dir_ccw(dir)]['graphic_str']]
              ? tile_types_setup['l' + l + '.' + tterrain_near[dir_ccw(dir)]['graphic_str']][
                  'match_index'
                ][0]
              : -1,
            // Direct neighbor
            tile_types_setup['l' + l + '.' + tterrain_near[dir]['graphic_str']]
              ? tile_types_setup['l' + l + '.' + tterrain_near[dir]['graphic_str']][
                  'match_index'
                ][0]
              : -1,
            // Clockwise neighbor
            tile_types_setup['l' + l + '.' + tterrain_near[dir_cw(dir)]['graphic_str']]
              ? tile_types_setup['l' + l + '.' + tterrain_near[dir_cw(dir)]['graphic_str']][
                  'match_index'
                ][0]
              : -1,
          ];

          // Calculate array_index based on match style
          switch (dlp['match_style']) {
            case MATCH_NONE:
              // No matching needed
              break;
            case MATCH_SAME: {
              // Binary encoding based on whether neighbors match this terrain's match_index
              const b1 = m[2] != this_match_index ? 1 : 0;
              const b2 = m[1] != this_match_index ? 1 : 0;
              const b3 = m[0] != this_match_index ? 1 : 0;
              array_index = array_index * 2 + b1;
              array_index = array_index * 2 + b2;
              array_index = array_index * 2 + b3;
              break;
            }
            case MATCH_PAIR: {
              // MATCH_PAIR doesn't work in freeciv-web either (returns empty array)
              // Skip this corner entirely
              continue;
            }
            case MATCH_FULL: {
              // Full match implementation
              const n = [];
              for (let j = 0; j < 3; j++) {
                n[j] = count - 1; // default to last entry
                for (let k = 0; k < count; k++) {
                  if (m[j] == dlp['match_index'][k]) {
                    n[j] = k;
                    break;
                  }
                }
              }
              array_index = array_index * count + n[2];
              array_index = array_index * count + n[1];
              array_index = array_index * count + n[0];
              break;
            }
          }

          array_index = array_index * NUM_CORNER_DIRS + i;
          const sprite_key = cellgroup_map[pterrain['graphic_str'] + '.' + array_index];

          if (sprite_key) {
            result_sprites.push({
              key: sprite_key + '.' + i,
              offset_x: x,
              offset_y: y,
            });
          }
        }

        return result_sprites;
      }
    }

    return [];
  }

  // Cached tile lookup for performance
  private tileMap: Map<string, any> = new Map();
  private tileMapBuilt = false;
  private lastGlobalTiles: any = null;

  private buildTileMap() {
    if (this.tileMapBuilt) return;

    const globalTiles = (window as any).tiles;
    if (!globalTiles) return;

    this.tileMap.clear();
    for (const tile of globalTiles) {
      if (tile) {
        const key = `${tile.x},${tile.y}`;
        this.tileMap.set(key, tile);
      }
    }
    this.tileMapBuilt = true;
  }

  // Get neighboring tiles from global tiles array
  // Returns 8 neighbors in DIR8 order: N, NE, E, SE, S, SW, W, NW
  private getNeighboringTerrains(tile: Tile): any[] {
    this.buildTileMap();

    const neighbors = [];
    // 8-directional neighbors: N, NE, E, SE, S, SW, W, NW (DIR8 order)
    const directions = [
      { dx: 0, dy: -1 }, // 0: North
      { dx: 1, dy: -1 }, // 1: Northeast
      { dx: 1, dy: 0 }, // 2: East
      { dx: 1, dy: 1 }, // 3: Southeast
      { dx: 0, dy: 1 }, // 4: South
      { dx: -1, dy: 1 }, // 5: Southwest
      { dx: -1, dy: 0 }, // 6: West
      { dx: -1, dy: -1 }, // 7: Northwest
    ];

    for (const dir of directions) {
      const nx = tile.x + dir.dx;
      const ny = tile.y + dir.dy;
      const key = `${nx},${ny}`;

      // Fast O(1) lookup instead of O(n) search
      const neighborTile = this.tileMap.get(key);
      let neighborTerrain = null;

      if (neighborTile && neighborTile.terrain) {
        neighborTerrain = {
          graphic_str: this.mapTerrainName(neighborTile.terrain),
        };
      } else {
        // If no neighbor found, assume same terrain as current tile
        neighborTerrain = { graphic_str: this.mapTerrainName(tile.terrain) };
      }

      neighbors.push(neighborTerrain);
    }

    return neighbors;
  }

  // Map terrain names to freeciv graphics names (from terrain.ruleset)
  private mapTerrainName(terrain: string): string {
    const terrainMap: Record<string, string> = {
      // Water terrains
      ocean: 'coast', // shallow ocean uses "coast" graphic
      deep_ocean: 'floor', // deep ocean uses "floor" graphic
      coast: 'coast', // coastal areas use "coast" graphic
      lake: 'lake', // lakes use "lake" graphic

      // Land terrains - these match their graphic names
      grassland: 'grassland',
      plains: 'plains',
      desert: 'desert',
      forest: 'forest',
      hills: 'hills',
      mountains: 'mountains',
      tundra: 'tundra',
      swamp: 'swamp',
      jungle: 'jungle',

      // Special terrains
      snow: 'arctic', // snow terrain uses "arctic" graphic
      arctic: 'arctic',
      glacier: 'arctic', // glacier also uses "arctic" graphic
      inaccessible: 'inaccessible',
    };

    return terrainMap[terrain] || terrain;
  }

  // Simplified wrapper that calls the original logic
  private fillTerrainSpriteArraySimple(
    layer: number,
    tile: Tile
  ): Array<{ key: string; offset_x?: number; offset_y?: number }> {
    if (!tile || !tile.terrain) {
      return [];
    }

    const mappedTerrain = this.mapTerrainName(tile.terrain);
    const pterrain = { graphic_str: mappedTerrain };
    const ptile = tile;
    const tterrain_near = this.getNeighboringTerrains(tile);

    try {
      return this.fillTerrainSpriteArray(layer, ptile, pterrain, tterrain_near);
    } catch (error) {
      console.warn(`Error in fillTerrainSpriteArray for ${tile.terrain} layer ${layer}:`, error);
      return [];
    }
  }

  private renderUnit(unit: Unit, viewport: MapViewport) {
    const screenPos = this.mapToScreen(unit.x, unit.y, viewport);

    this.ctx.fillStyle = this.getPlayerColor(unit.playerId);
    this.ctx.beginPath();
    this.ctx.arc(
      screenPos.x + this.tileWidth / 2,
      screenPos.y + this.tileHeight / 2,
      8,
      0,
      2 * Math.PI
    );
    this.ctx.fill();

    this.ctx.fillStyle = 'white';
    this.ctx.font = '12px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      unit.type.charAt(0).toUpperCase(),
      screenPos.x + this.tileWidth / 2,
      screenPos.y + this.tileHeight / 2 + 4
    );
  }

  private renderCity(city: City, viewport: MapViewport) {
    const screenPos = this.mapToScreen(city.x, city.y, viewport);

    this.ctx.fillStyle = this.getPlayerColor(city.playerId);
    this.ctx.fillRect(screenPos.x + 5, screenPos.y + 5, this.tileWidth - 10, this.tileHeight - 10);

    this.ctx.fillStyle = 'white';
    this.ctx.font = '10px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(city.name, screenPos.x + this.tileWidth / 2, screenPos.y - 5);

    this.ctx.fillText(
      city.size.toString(),
      screenPos.x + this.tileWidth / 2,
      screenPos.y + this.tileHeight / 2
    );
  }

  /**
   * Convert map coordinates to GUI (isometric) coordinates.
   * This handles the coordinate transformation for isometric diamond-shaped tile layout.
   * @param mapDx - Map X coordinate difference
   * @param mapDy - Map Y coordinate difference
   * @returns GUI coordinates object with guiDx and guiDy
   */
  mapToGuiVector(mapDx: number, mapDy: number): { guiDx: number; guiDy: number } {
    const guiDx = ((mapDx - mapDy) * this.tileWidth) >> 1;
    const guiDy = ((mapDx + mapDy) * this.tileHeight) >> 1;
    return { guiDx, guiDy };
  }

  private guiToMapPos(guiX: number, guiY: number): { mapX: number; mapY: number } {
    const W = this.tileWidth;
    const H = this.tileHeight;

    guiX -= W >> 1;

    const numeratorX = guiX * H + guiY * W;
    const numeratorY = guiY * W - guiX * H;
    const denominator = W * H;

    const mapX = this.divide(numeratorX, denominator);
    const mapY = this.divide(numeratorY, denominator);

    return { mapX, mapY };
  }

  private divide(n: number, d: number): number {
    if (d === 0) return 0;

    const result = Math.floor(n / d);
    return result;
  }

  private mapToScreen(mapX: number, mapY: number, viewport: MapViewport) {
    const guiVector = this.mapToGuiVector(mapX, mapY);
    return {
      x: guiVector.guiDx - viewport.x,
      y: guiVector.guiDy - viewport.y,
    };
  }

  canvasToMap(canvasX: number, canvasY: number, viewport: MapViewport) {
    const guiX = canvasX + viewport.x;
    const guiY = canvasY + viewport.y;
    const result = this.guiToMapPos(guiX, guiY);
    return result;
  }

  /**
   * Check if viewport extends beyond map boundaries to determine if ocean padding is needed.
   *
   * This implements the boundary detection logic from freeciv-web to fix the diamond-shaped
   * map edges issue. When the viewport extends beyond map bounds, we need to render ocean
   * tiles in the out-of-bounds areas to create a rectangular world appearance.
   *
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:282-291
   *   Original logic that checks viewport corners against map bounds:
   *   ```javascript
   *   var r = base_canvas_to_map_pos(0, 0);
   *   var s = base_canvas_to_map_pos(mapview['width'], 0);
   *   var t = base_canvas_to_map_pos(0, mapview['height']);
   *   var u = base_canvas_to_map_pos(mapview['width'], mapview['height']);
   *   if (r['map_x'] < 0 || r['map_x'] > map['xsize'] || r['map_y'] < 0 || r['map_y'] > map['ysize']
   *    || s['map_x'] < 0 || s['map_x'] > map['xsize'] || s['map_y'] < 0 || s['map_y'] > map['ysize']
   *    || t['map_x'] < 0 || t['map_x'] > map['xsize'] || t['map_y'] < 0 || t['map_y'] > map['ysize']
   *    || u['map_x'] < 0 || u['map_x'] > map['xsize'] || u['map_y'] < 0 || u['map_y'] > map['ysize']) {
   *      canvas_put_rectangle(mapview_canvas_ctx, "rgb(0,0,0)", canvas_x, canvas_y, width, height);
   *   }
   *   ```
   *
   * @param viewport - The current viewport containing x, y, width, height
   * @returns true if any part of the viewport extends beyond map boundaries
   */
  private checkViewportBounds(viewport: MapViewport): boolean {
    const globalMap = (window as any).map;
    if (!globalMap || !globalMap.xsize || !globalMap.ysize) {
      return false; // No map data available
    }

    // Convert viewport corners to map coordinates using canvasToMap (equivalent to base_canvas_to_map_pos)
    const corners = [
      this.canvasToMap(0, 0, viewport), // Top-left corner (r in freeciv-web)
      this.canvasToMap(viewport.width, 0, viewport), // Top-right corner (s in freeciv-web)
      this.canvasToMap(0, viewport.height, viewport), // Bottom-left corner (t in freeciv-web)
      this.canvasToMap(viewport.width, viewport.height, viewport), // Bottom-right corner (u in freeciv-web)
    ];

    // Check if any corner is outside map bounds (same logic as freeciv-web conditional)
    return corners.some(
      corner =>
        corner.mapX < 0 ||
        corner.mapX > globalMap.xsize ||
        corner.mapY < 0 ||
        corner.mapY > globalMap.ysize
    );
  }

  /**
   * Render ocean tiles beyond map boundaries to create seamless infinite world appearance.
   *
   * This implements freeciv-web's terrain extension logic where areas beyond the actual
   * map bounds are filled with ocean tiles. This prevents the diamond-shaped map edges
   * from being visible and creates the illusion of a rectangular world that extends
   * infinitely in all directions.
   *
   * The logic is based on freeciv-web's approach of "pretending the same terrain continued
   * past the edge of the map" but simplified to always use ocean tiles for out-of-bounds areas.
   *
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/terrain.js:59-61
   *   Original terrain extension logic:
   *   ```javascript
   *   // At the edges of the (known) map, pretend the same terrain continued
   *   // past the edge of the map.
   *   tterrain_near[dir] = tile_terrain(ptile);
   *   ```
   *
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:347-349
   *   Out-of-bounds tile handling:
   *   ```javascript
   *   if (map['wrap_id'] == 0 && (ptile_si <= 0 || ((ptile_si / 4)) > map['xsize'])) {
   *     continue;  // Skip if flat earth without wrapping.
   *   }
   *   ```
   *
   * @param viewport - The current viewport for coordinate calculations
   * @param globalMap - The global map object containing xsize and ysize bounds
   */
  /**
   * Render ocean tiles beyond map boundaries using freeciv-web's gui_rect_iterate logic.
   *
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:305-380
   *   This implements the exact same viewport tile iteration logic as freeciv-web to ensure
   *   complete coverage of all visible areas, including corners and edges in isometric view.
   */
  private renderOceanPadding(viewport: MapViewport, globalMap: any) {
    // Copy freeciv-web's gui_rect_iterate logic exactly for proper viewport coverage
    const gui_x0 = viewport.x;
    const gui_y0 = viewport.y;
    const width = viewport.width;
    const height = viewport.height;

    // gui_rect_iterate begin - copied from freeciv-web
    let gui_x_0 = gui_x0;
    let gui_y_0 = gui_y0;
    let gui_x_w = width + (this.tileWidth >> 1);
    let gui_y_h = height + (this.tileHeight >> 1);

    if (gui_x_w < 0) {
      gui_x_0 += gui_x_w;
      gui_x_w = -gui_x_w;
    }

    if (gui_y_h < 0) {
      gui_y_0 += gui_y_h;
      gui_y_h = -gui_y_h;
    }

    if (gui_x_w > 0 && gui_y_h > 0) {
      const ptile_r1 = 2;
      const ptile_r2 = ptile_r1 * 2;
      const ptile_w = this.tileWidth;
      const ptile_h = this.tileHeight;

      const ptile_x0 = Math.floor(
        (gui_x_0 * ptile_r2) / ptile_w -
          (gui_x_0 * ptile_r2 < 0 && (gui_x_0 * ptile_r2) % ptile_w < 0 ? 1 : 0) -
          ptile_r1 / 2
      );
      const ptile_y0 = Math.floor(
        (gui_y_0 * ptile_r2) / ptile_h -
          (gui_y_0 * ptile_r2 < 0 && (gui_y_0 * ptile_r2) % ptile_h < 0 ? 1 : 0) -
          ptile_r1 / 2
      );
      const ptile_x1 = Math.floor(
        ((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1) / ptile_w -
          ((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1 < 0 &&
          ((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1) % ptile_w < 0
            ? 1
            : 0) +
          ptile_r1
      );
      const ptile_y1 = Math.floor(
        ((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1) / ptile_h -
          ((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1 < 0 &&
          ((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1) % ptile_h < 0
            ? 1
            : 0) +
          ptile_r1
      );
      const ptile_count = (ptile_x1 - ptile_x0) * (ptile_y1 - ptile_y0);

      for (let ptile_index = 0; ptile_index < ptile_count; ptile_index++) {
        const ptile_xi = ptile_x0 + (ptile_index % (ptile_x1 - ptile_x0));
        const ptile_yi = Math.floor(ptile_y0 + ptile_index / (ptile_x1 - ptile_x0));
        const ptile_si = ptile_xi + ptile_yi;
        const ptile_di = ptile_yi - ptile_xi;

        if ((ptile_xi + ptile_yi) % 2 != 0) {
          continue;
        }

        // Check if this is a tile position (not a corner)
        if (ptile_xi % 2 == 0 && ptile_yi % 2 == 0) {
          if ((ptile_xi + ptile_yi) % 4 == 0) {
            // Calculate map coordinates for this tile position
            const map_x = ptile_si / 4 - 1;
            const map_y = ptile_di / 4;

            // Only render ocean tiles for out-of-bounds positions
            if (map_x < 0 || map_x >= globalMap.xsize || map_y < 0 || map_y >= globalMap.ysize) {
              // Calculate screen position for this tile
              const gui_x = Math.floor((ptile_xi * ptile_w) / ptile_r2 - ptile_w / 2);
              const gui_y = Math.floor((ptile_yi * ptile_h) / ptile_r2 - ptile_h / 2);
              const cx = gui_x - gui_x0;
              const cy = gui_y - gui_y0;

              // Create synthetic deep ocean tile for out-of-bounds position
              const oceanTile: Tile = {
                x: map_x,
                y: map_y,
                terrain: 'deep_ocean',
                visible: true,
                known: true,
                units: [],
                city: undefined,
                elevation: 0,
                resource: undefined,
              };

              // Render the synthetic ocean tile at the calculated screen position
              const screenPos = { x: cx, y: cy };
              this.renderTerrainLayers(oceanTile, screenPos);
            }
          }
        }
      }
    }
  }

  private isInViewport(mapX: number, mapY: number, viewport: MapViewport): boolean {
    const screenPos = this.mapToScreen(mapX, mapY, viewport);
    return (
      screenPos.x + this.tileWidth >= 0 &&
      screenPos.x <= viewport.width &&
      screenPos.y + this.tileHeight >= 0 &&
      screenPos.y <= viewport.height
    );
  }

  private getTerrainColor(terrain: string): string {
    const colors: Record<string, string> = {
      grassland: '#90EE90',
      plains: '#DAA520',
      desert: '#F4A460',
      tundra: '#D3D3D3',
      forest: '#228B22',
      jungle: '#006400',
      hills: '#8B4513',
      mountains: '#696969',
      ocean: '#4682B4',
      swamp: '#556B2F',
    };

    return colors[terrain] || '#808080';
  }

  private getPlayerColor(playerId: string): string {
    const colors = ['#FF0000', '#0000FF', '#00FF00', '#FFFF00', '#FF00FF', '#00FFFF'];
    const index = parseInt(playerId, 36) % colors.length;
    return colors[index];
  }

  debugCoordinateAccuracy(): void {
    if (!this.isInitialized) return;
  }

  // Debug method to render diamond grid overlay
  debugRenderGrid(viewport: MapViewport, showTileNumbers = false): void {
    if (!this.isInitialized) return;

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    this.ctx.lineWidth = 1;
    this.ctx.font = '10px Arial';
    this.ctx.fillStyle = 'red';
    this.ctx.textAlign = 'center';

    // Draw diamond grid for first 20x20 tiles
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        const screenPos = this.mapToScreen(x, y, viewport);

        // Skip if outside viewport
        if (
          screenPos.x < -this.tileWidth ||
          screenPos.x > viewport.width + this.tileWidth ||
          screenPos.y < -this.tileHeight ||
          screenPos.y > viewport.height + this.tileHeight
        ) {
          continue;
        }

        // Draw diamond shape
        this.drawDiamond(
          screenPos.x + this.tileWidth / 2,
          screenPos.y + this.tileHeight / 2,
          this.tileWidth / 2,
          this.tileHeight / 2
        );

        // Optionally draw tile coordinates
        if (showTileNumbers) {
          this.ctx.fillText(
            `${x},${y}`,
            screenPos.x + this.tileWidth / 2,
            screenPos.y + this.tileHeight / 2
          );
        }
      }
    }

    this.ctx.restore();
  }

  private drawDiamond(
    centerX: number,
    centerY: number,
    halfWidth: number,
    halfHeight: number
  ): void {
    this.ctx.beginPath();
    this.ctx.moveTo(centerX, centerY - halfHeight); // Top
    this.ctx.lineTo(centerX + halfWidth, centerY); // Right
    this.ctx.lineTo(centerX, centerY + halfHeight); // Bottom
    this.ctx.lineTo(centerX - halfWidth, centerY); // Left
    this.ctx.closePath();
    this.ctx.stroke();
  }

  // Helper functions copied from freeciv-web for map wrapping and boundaries

  /**
   * Map wrapping flags from freeciv-web map.js
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:35-36
   */
  private static readonly WRAP_X = 1;
  private static readonly WRAP_Y = 2;

  /**
   * Check if the map has a specific wrapping flag enabled.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:77-80
   * @param flag - The wrapping flag to check (WRAP_X or WRAP_Y)
   * @returns true if the map has this wrapping enabled
   */
  private wrapHasFlag(flag: number): boolean {
    const globalMap = (window as any).map;
    return globalMap && (globalMap.wrap_id & flag) !== 0;
  }

  /**
   * Freeciv coordinate wrapping function for handling map boundaries.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/utility.js FC_WRAP function
   * @param value - The coordinate value to wrap
   * @param range - The range size (map dimension)
   * @returns The wrapped coordinate value
   */
  private fcWrap(value: number, range: number): number {
    return value < 0
      ? value % range !== 0
        ? (value % range) + range
        : 0
      : value >= range
        ? value % range
        : value;
  }

  /**
   * Convert map coordinates to native coordinates for wrapping calculations.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:243-248
   * @param mapX - Map X coordinate
   * @param mapY - Map Y coordinate
   * @returns Native coordinates object with natX and natY
   */
  private mapToNativePos(mapX: number, mapY: number): { natX: number; natY: number } {
    const globalMap = (window as any).map;
    const natY = Math.floor(mapX + mapY - globalMap.xsize);
    const natX = Math.floor((2 * mapX - natY - (natY & 1)) / 2);
    return { natX, natY };
  }

  /**
   * Convert native coordinates back to map coordinates after wrapping.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:233-238
   * @param natX - Native X coordinate
   * @param natY - Native Y coordinate
   * @returns Map coordinates object with mapX and mapY
   */
  private nativeToMapPos(natX: number, natY: number): { mapX: number; mapY: number } {
    const globalMap = (window as any).map;
    const mapX = Math.floor((natY + (natY & 1)) / 2 + natX);
    const mapY = Math.floor(natY - mapX + globalMap.xsize);
    return { mapX, mapY };
  }

  /**
   * Normalize (wrap) the GUI position for map boundary handling.
   * This is equivalent to map wrapping but in GUI coordinates to preserve pixel accuracy.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:136-183
   * @param guiX - GUI X coordinate to normalize
   * @param guiY - GUI Y coordinate to normalize
   * @returns Normalized GUI coordinates that respect map wrapping
   */
  private normalizeGuiPos(guiX: number, guiY: number): { guiX: number; guiY: number } {
    const globalMap = (window as any).map;
    if (!globalMap) return { guiX, guiY };

    // Convert the (gui_x, gui_y) into a (map_x, map_y) plus a GUI offset from this tile
    const mapPos = this.guiToMapPos(guiX, guiY);
    let { mapX, mapY } = mapPos;

    const guiPos = this.mapToGuiVector(mapX, mapY);
    const guiX0 = guiPos.guiDx;
    const guiY0 = guiPos.guiDy;

    const diffX = guiX - guiX0;
    const diffY = guiY - guiY0;

    // Perform wrapping without any realness check. It's important that
    // we wrap even if the map position is unreal, which normalize_map_pos doesn't necessarily do.
    const nativePos = this.mapToNativePos(mapX, mapY);
    let { natX, natY } = nativePos;

    if (this.wrapHasFlag(MapRenderer.WRAP_X)) {
      natX = this.fcWrap(natX, globalMap.xsize);
    }
    if (this.wrapHasFlag(MapRenderer.WRAP_Y)) {
      natY = this.fcWrap(natY, globalMap.ysize);
    }

    const wrappedMapPos = this.nativeToMapPos(natX, natY);
    mapX = wrappedMapPos.mapX;
    mapY = wrappedMapPos.mapY;

    // Now convert the wrapped map position back to a GUI position and add the offset back on
    const wrappedGuiPos = this.mapToGuiVector(mapX, mapY);
    const finalGuiX = wrappedGuiPos.guiDx + diffX;
    const finalGuiY = wrappedGuiPos.guiDy + diffY;

    return { guiX: finalGuiX, guiY: finalGuiY };
  }

  /**
   * Calculate the centered starting position for the viewport.
   * Centers the viewport on the middle tile of the map for optimal initial view.
   * @param viewportWidth - Width of the viewport in pixels
   * @param viewportHeight - Height of the viewport in pixels
   * @returns GUI coordinates for centering the viewport on the map
   */
  getCenteredViewportPosition(
    viewportWidth: number,
    viewportHeight: number
  ): { x: number; y: number } {
    const globalMap = (window as any).map;

    if (!globalMap || !globalMap.xsize || !globalMap.ysize) {
      return { x: 0, y: 0 };
    }

    // For isometric maps, we need to center based on the actual center tile of the map
    // Let's use freeciv-web's approach: center on the middle tile
    const centerTileX = Math.floor(globalMap.xsize / 2);
    const centerTileY = Math.floor(globalMap.ysize / 2);

    // Convert center tile to GUI coordinates
    const centerTileGui = this.mapToGuiVector(centerTileX, centerTileY);

    // Position viewport so center tile is in center of screen
    const centerX = centerTileGui.guiDx - viewportWidth / 2;
    const centerY = centerTileGui.guiDy - viewportHeight / 2;

    return { x: centerX, y: centerY };
  }

  /**
   * Change the mapview origin, clip it, and apply boundary constraints.
   * This is the main function for handling viewport movement and boundary enforcement.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:103-111
   * @param guiX0 - Proposed GUI X coordinate for viewport origin
   * @param guiY0 - Proposed GUI Y coordinate for viewport origin
   * @param viewportWidth - Width of the viewport in pixels (default: 800)
   * @param viewportHeight - Height of the viewport in pixels (default: 600)
   * @returns Constrained GUI coordinates that respect map boundaries
   */
  setMapviewOrigin(
    guiX0: number,
    guiY0: number,
    viewportWidth: number = 800,
    viewportHeight: number = 600
  ): { x: number; y: number } {
    const globalMap = (window as any).map;

    // If no map data, apply simple bounds instead of infinite panning
    if (!globalMap || !globalMap.xsize || !globalMap.ysize) {
      console.warn('No map data available, applying fallback bounds');
      // Apply simple rectangular bounds as fallback (prevent infinite panning)
      const maxX = 1000;
      const maxY = 1000;
      const minX = -500;
      const minY = -500;

      const constrainedX = Math.max(minX, Math.min(maxX, guiX0));
      const constrainedY = Math.max(minY, Math.min(maxY, guiY0));

      return { x: constrainedX, y: constrainedY };
    }

    // For non-wrapping maps, apply very generous boundary constraints
    // Allow panning to see the entire map with reasonable padding
    if (globalMap.wrap_id === 0) {
      const mapWidthGui = globalMap.xsize * this.tileWidth;
      const mapHeightGui = globalMap.ysize * this.tileHeight;

      // Very generous bounds - allow seeing entire map plus lots of padding
      // This matches freeciv-web's behavior which is quite permissive
      // Use consistent minimum padding to prevent snap-back on small screens
      const padding = Math.max(viewportWidth, viewportHeight, 1200); // Minimum 1200px padding

      const minX = -(mapWidthGui + padding);
      const maxX = padding;
      const minY = -(mapHeightGui + padding);
      const maxY = padding;

      const constrainedX = Math.max(minX, Math.min(maxX, guiX0));
      const constrainedY = Math.max(minY, Math.min(maxY, guiY0));

      return { x: constrainedX, y: constrainedY };
    }

    // For wrapping maps, use the full normalize_gui_pos logic
    const normalized = this.normalizeGuiPos(guiX0, guiY0);
    return { x: normalized.guiX, y: normalized.guiY };
  }

  cleanup() {
    this.tilesetLoader.cleanup();
    this.isInitialized = false;
  }

  private getVisibleTilesFromGlobal(
    // @ts-expect-error - TODO: implement viewport culling
    viewport: MapViewport,
    // @ts-expect-error - TODO: implement map bounds checking
    globalMap: any,
    globalTiles: any[]
  ): Tile[] {
    const tiles: Tile[] = [];

    // For now, let's do a simple approach - get all tiles that have data
    // Later we can add the complex isometric culling logic
    for (let i = 0; i < globalTiles.length; i++) {
      const tile = globalTiles[i];
      if (tile && tile.terrain && (tile.known > 0 || tile.seen > 0)) {
        // Convert to our expected format
        tiles.push({
          x: tile.x,
          y: tile.y,
          terrain: tile.terrain,
          visible: tile.known > 0,
          known: tile.seen > 0,
          units: [],
          city: undefined,
          elevation: tile.elevation || 0,
          resource: tile.resource || undefined,
          riverMask: tile.riverMask || 0, // Include riverMask for river rendering
        });
      }
    }

    return tiles;
  }
}
