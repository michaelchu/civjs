/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GameState, MapViewport, Tile, Unit, City } from '../../types';
import type { GotoPath } from '../../services/PathfindingService';
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
  selectedUnitId?: string | null;
  gotoPath?: GotoPath | null;
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private tileWidth = 96;
  private tileHeight = 48;

  // Tileset loader for sprite management
  private tilesetLoader: TilesetLoader;
  private isInitialized = false;

  // Sprite scaling factors for visual size control
  private resourceScale = 0.7; // Make resources 30% smaller
  private cityScale = 0.8; // Make cities 20% smaller

  // Animation state for unit selection
  private selectionAnimationStartTime: number | null = null;
  private lastSelectedUnitId: string | null = null;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.tilesetLoader = new TilesetLoader();
    this.setupCanvas();
  }

  async initialize(): Promise<void> {
    try {
      await this.tilesetLoader.loadTileset();

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

    // Render selection outline after terrain but before units
    if (state.selectedUnitId) {
      const selectedUnit = state.units[state.selectedUnitId];
      if (selectedUnit && this.isInViewport(selectedUnit.x, selectedUnit.y, state.viewport)) {
        this.renderUnitSelection(selectedUnit, state.viewport);
      }
    } else {
      // Reset animation state when no unit is selected
      this.resetSelectionAnimation();
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

    // Render goto path if available (similar to freeciv-web's path rendering)
    if (state.gotoPath && state.gotoPath.tiles.length > 1) {
      if (import.meta.env.DEV) {
        console.log('Rendering goto path:', state.gotoPath);
      }
      this.renderGotoPath(state.gotoPath, state.viewport);
    } else if (import.meta.env.DEV && state.gotoPath) {
      console.log('Goto path available but not rendered:', state.gotoPath);
    }

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
        const sprite = this.tilesetLoader.getSprite(spriteInfo.key);
        if (sprite) {
          const offsetX = spriteInfo.offset_x || 0;
          const offsetY = spriteInfo.offset_y || 0;

          // Copy freeciv-web logic exactly: pcanvas.drawImage(sprites[tag], canvas_x, canvas_y);
          this.ctx.drawImage(sprite, screenPos.x + offsetX, screenPos.y + offsetY);
        } else {
          // Try fallback sprites for water terrains
          if (tile.terrain === 'ocean' || tile.terrain === 'coast') {
            const mappedTerrain = this.mapTerrainName(tile.terrain);
            // Try the simplest CELL_CORNER sprite for water
            const fallbackKey = `t.l${layer}.${mappedTerrain}_cell_u_w_w_w`;
            const fallbackSprite = this.tilesetLoader.getSprite(fallbackKey);
            if (fallbackSprite) {
              this.ctx.drawImage(fallbackSprite, screenPos.x, screenPos.y);
              hasAnySprites = true;
            }
          }
        }
      }
    }

    // ADD: River rendering layer (matches freeciv-web LAYER_SPECIAL1)
    const riverSprite = this.getTileRiverSprite(tile);
    if (riverSprite) {
      const sprite = this.tilesetLoader.getSprite(riverSprite.key);
      if (sprite) {
        this.ctx.drawImage(sprite, screenPos.x, screenPos.y);
        hasAnySprites = true;
        if (import.meta.env.DEV) {
          console.debug(
            `River sprite rendered: ${riverSprite.key} at (${screenPos.x},${screenPos.y})`
          );
        }
      } else {
        if (import.meta.env.DEV) {
          console.warn(`River sprite not found: ${riverSprite.key}`);
        }
      }
    }

    // ADD: Resource rendering layer (matches freeciv-web LAYER_SPECIAL2)
    const resourceSprite = this.getTileResourceSprite(tile);
    if (resourceSprite) {
      const sprite = this.tilesetLoader.getSprite(resourceSprite.key);
      if (sprite) {
        // Apply resource scaling and center the scaled sprite on the tile
        const scaledWidth = sprite.width * this.resourceScale;
        const scaledHeight = sprite.height * this.resourceScale;
        const offsetX = (sprite.width - scaledWidth) / 2;
        const offsetY = (sprite.height - scaledHeight) / 2;

        this.ctx.drawImage(
          sprite,
          screenPos.x + offsetX,
          screenPos.y + offsetY,
          scaledWidth,
          scaledHeight
        );
        hasAnySprites = true;
        if (import.meta.env.DEV) {
          console.debug(
            `Resource sprite rendered: ${resourceSprite.key} at (${screenPos.x},${screenPos.y}) scale=${this.resourceScale}`
          );
        }
      } else {
        if (import.meta.env.DEV) {
          console.warn(`Resource sprite not found: ${resourceSprite.key}`);
        }
      }
    }

    // Fallback: if no sprites rendered, show solid color
    if (!hasAnySprites) {
      const color = this.getTerrainColor(tile.terrain);
      this.ctx.fillStyle = color;
      this.ctx.fillRect(screenPos.x, screenPos.y, this.tileWidth, this.tileHeight);
    }
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

  /**
   * Calculate river sprite for a tile based on its riverMask connections.
   * Port of freeciv-web's get_tile_river_sprite() function.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:get_tile_river_sprite()
   * @param tile - The tile to calculate river sprite for
   * @returns Sprite info with key for river rendering, or null if no river
   */
  private getTileRiverSprite(tile: Tile): { key: string } | null {
    if (!tile.riverMask) return null;

    // Convert riverMask bitfield to directional string like freeciv-web
    // Our bitfield: N=1, E=2, S=4, W=8
    // freeciv-web format: "n1e0s1w0" etc.
    let riverStr = '';
    riverStr += tile.riverMask & 1 ? 'n1' : 'n0'; // North
    riverStr += tile.riverMask & 2 ? 'e1' : 'e0'; // East
    riverStr += tile.riverMask & 4 ? 's1' : 's0'; // South
    riverStr += tile.riverMask & 8 ? 'w1' : 'w0'; // West

    const spriteKey = `road.river_s_${riverStr}:0`;

    // Debug logging for river sprite generation
    if (import.meta.env.DEV) {
      console.debug(
        `River sprite requested: tile(${tile.x},${tile.y}) mask=${tile.riverMask} -> ${spriteKey}`
      );
    }

    // Return sprite key following freeciv-web's road.river_s_XXXX:0 pattern
    return { key: spriteKey };
  }

  /**
   * Calculate resource sprite for a tile based on its resource type.
   * Port of freeciv-web's resource rendering functionality.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js (resource handling)
   * @param tile - The tile to calculate resource sprite for
   * @returns Sprite info with key for resource rendering, or null if no resource
   */
  private getTileResourceSprite(tile: Tile): { key: string } | null {
    if (!tile.resource) return null;

    // Map resource types to sprite keys following freeciv tileset patterns
    const resourceSpriteMap: Record<string, string> = {
      // Food resources
      wheat: 'ts.wheat:0',
      buffalo: 'ts.buffalo:0',
      cattle: 'ts.buffalo:0', // Map cattle to buffalo sprite
      fish: 'ts.fish:0',
      fruit: 'ts.fruit:0',
      horses: 'ts.horses:0',
      pheasant: 'ts.pheasant:0',

      // Luxury resources
      gold: 'ts.gold:0',
      gems: 'ts.gems:0',
      silk: 'ts.silk:0',
      spice: 'ts.spice:0',
      spices: 'ts.spice:0', // Alternative spelling
      wine: 'ts.wine:0',
      furs: 'ts.furs:0',

      // Strategic resources
      iron: 'ts.iron:0',
      coal: 'ts.coal:0',
      oil: 'ts.oil:0',
      // Note: copper and uranium sprites not available in tileset, will be skipped

      // Desert resources
      oasis: 'ts.oasis:0',

      // Arctic resources
      seals: 'ts.seals:0',
      whales: 'ts.whales:0',
      arctic_ivory: 'ts.arctic_ivory:0',
      arctic_oil: 'ts.arctic_oil:0',

      // Tundra resources
      tundra_game: 'ts.tundra_game:0',
      peat: 'ts.peat:0',

      // River/grassland resources
      grassland_resources: 'ts.grassland_resources:0',
      river_resources: 'ts.river_resources:0',
    };

    const spriteKey = resourceSpriteMap[tile.resource];

    if (!spriteKey) {
      // Skip rendering resources without sprite mappings (copper, uranium, etc.)
      if (import.meta.env.DEV) {
        console.debug(
          `Skipping rendering for unmapped resource '${tile.resource}' at (${tile.x},${tile.y})`
        );
      }
      return null;
    }

    // Debug logging for resource sprite generation
    if (import.meta.env.DEV) {
      console.debug(
        `Resource sprite requested: tile(${tile.x},${tile.y}) resource=${tile.resource} -> ${spriteKey}`
      );
    }

    // Return sprite key following freeciv-web's s.RESOURCE:0 pattern
    return { key: spriteKey };
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
      arctic: 'arctic',
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

    // Get unit animation offset for smooth movement
    // @reference freeciv-web/.../unit.js:get_unit_anim_offset()
    const animOffset = this.getUnitAnimOffset();

    // Apply freeciv-web's unit positioning offsets to properly center units on tiles
    // @reference freeciv-web/tileset_config_amplio2.js: unit_offset_x = 19, unit_offset_y = 14
    // @reference freeciv-web/tilespec.js fill_unit_sprite_array(): "offset_y" : unit_offset['y'] - unit_offset_y
    const UNIT_OFFSET_X = 19;
    const UNIT_OFFSET_Y = 14;
    const unitX = screenPos.x + animOffset.x + UNIT_OFFSET_X;
    const unitY = screenPos.y + animOffset.y - UNIT_OFFSET_Y; // Note: negative Y offset like freeciv-web

    // Render unit sprites using freeciv-web approach
    // @reference freeciv-web/.../tilespec.js:fill_unit_sprite_array()
    const unitSprites = this.fillUnitSpriteArray(unit);

    for (const spriteInfo of unitSprites) {
      if (spriteInfo.key) {
        const sprite = this.tilesetLoader.getSprite(spriteInfo.key);
        if (sprite) {
          const offsetX = spriteInfo.offset_x || 0;
          const offsetY = spriteInfo.offset_y || 0;

          this.ctx.drawImage(sprite, unitX + offsetX, unitY + offsetY);
        } else {
          // Fallback to unit type specific sprite key
          const fallbackKey = this.getUnitTypeGraphicTag(unit.unitTypeId);
          const fallbackSprite = this.tilesetLoader.getSprite(fallbackKey);
          if (fallbackSprite) {
            this.ctx.drawImage(fallbackSprite, unitX, unitY);
          } else {
            // Final fallback: render placeholder with unit type indication
            this.renderUnitPlaceholder(unit, unitX, unitY);
          }
        }
      }
    }

    // Render health bar if unit is damaged
    if (unit.hp < 100) {
      this.renderUnitHealthBar(unit, unitX, unitY);
    }

    // Render unit status indicators (fortified, etc.)
    this.renderUnitStatusIndicators();
  }

  /**
   * Get unit animation offset for smooth movement
   * @reference freeciv-web/.../unit.js:get_unit_anim_offset()
   */
  private getUnitAnimOffset(): { x: number; y: number } {
    // For now, return no offset (static units)
    // TODO: Implement smooth movement animation system
    return { x: 0, y: 0 };
  }

  /**
   * Fill unit sprite array based on freeciv-web implementation
   * @reference freeciv-web/.../tilespec.js:fill_unit_sprite_array()
   */
  private fillUnitSpriteArray(
    unit: Unit
  ): Array<{ key: string; offset_x?: number; offset_y?: number }> {
    const sprites: Array<{ key: string; offset_x?: number; offset_y?: number }> = [];

    // Get nation flag sprite
    // @reference freeciv-web: get_unit_nation_flag_sprite(punit)
    const flagSprite = this.getUnitNationFlagSprite();
    if (flagSprite) {
      sprites.push(flagSprite);
    }

    // Get main unit graphic
    // @reference freeciv-web: tileset_unit_graphic_tag(punit)
    const unitGraphic = this.getUnitTypeGraphicTag(unit.unitTypeId);
    sprites.push({
      key: unitGraphic,
      offset_x: 0,
      offset_y: 0,
    });

    // Get activity sprite if unit has activity
    // @reference freeciv-web: get_unit_activity_sprite(punit)
    const activitySprite = this.getUnitActivitySprite();
    if (activitySprite) {
      sprites.push(activitySprite);
    }

    return sprites;
  }

  /**
   * Get unit nation flag sprite
   * @reference freeciv-web: get_unit_nation_flag_sprite()
   */
  private getUnitNationFlagSprite(): { key: string; offset_x?: number; offset_y?: number } | null {
    // For now, return null (no flag rendering)
    // TODO: Implement nation flag sprites based on player nation
    return null;
  }

  /**
   * Get unit type graphic tag
   * @reference freeciv-web: tileset_unit_graphic_tag()
   */
  private getUnitTypeGraphicTag(unitType: string): string {
    // Map unit types to sprite keys based on freeciv tileset naming
    // @reference freeciv/data/amplio2/units.spec - unit sprite definitions
    const unitSpriteMap: Record<string, string> = {
      warrior: 'u.warriors_Idle:0',
      settler: 'u.settlers_Idle:0',
      scout: 'u.explorers_Idle:0',
      worker: 'u.workers_Idle:0',
      archer: 'u.archers_Idle:0',
      spearman: 'u.phalanx_Idle:0',
      // Additional common units
      horseman: 'u.horsemen_Idle:0',
      knight: 'u.knights_Idle:0',
      legion: 'u.legion_Idle:0',
      pikeman: 'u.pikemen_Idle:0',
      musketeers: 'u.musketeers_Idle:0',
      riflemen: 'u.riflemen_Idle:0',
      cavalry: 'u.cavalry_Idle:0',
      cannon: 'u.cannon_Idle:0',
      catapult: 'u.catapult_Idle:0',
      trireme: 'u.trireme_Idle:0',
      caravel: 'u.caravel_Idle:0',
      frigate: 'u.frigate_Idle:0',
      ironclad: 'u.ironclad_Idle:0',
      destroyer: 'u.destroyer_Idle:0',
      cruiser: 'u.cruiser_Idle:0',
      battleship: 'u.battleship_Idle:0',
      submarine: 'u.submarine_Idle:0',
      carrier: 'u.carrier_Idle:0',
    };

    return unitSpriteMap[unitType] || `u.${unitType}_Idle:0`;
  }

  /**
   * Get unit activity sprite
   * @reference freeciv-web: get_unit_activity_sprite()
   */
  private getUnitActivitySprite(): { key: string; offset_x?: number; offset_y?: number } | null {
    // TODO: Implement activity sprites (fortified, sentry, etc.)
    return null;
  }

  /**
   * Render unit placeholder when sprites are not available
   */
  private renderUnitPlaceholder(unit: Unit, x: number, y: number): void {
    // Position placeholder at the corrected unit position (already offset)
    this.ctx.fillStyle = this.getPlayerColor(unit.playerId);
    this.ctx.beginPath();
    this.ctx.arc(x + this.tileWidth / 2, y + this.tileHeight / 2, 8, 0, 2 * Math.PI);
    this.ctx.fill();

    this.ctx.fillStyle = 'white';
    this.ctx.font = '12px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      unit.unitTypeId.charAt(0).toUpperCase(),
      x + this.tileWidth / 2,
      y + this.tileHeight / 2 + 4
    );
  }

  /**
   * Render unit health bar
   * @reference freeciv-web health bar rendering
   */
  private renderUnitHealthBar(unit: Unit, x: number, y: number): void {
    const barWidth = 24;
    const barHeight = 4;
    const healthPercent = unit.hp / 100;

    // Position health bar relative to the corrected unit position
    const barX = x + this.tileWidth / 2 - barWidth / 2;
    const barY = y + this.tileHeight - 8;

    // Background (red)
    this.ctx.fillStyle = '#ff0000';
    this.ctx.fillRect(barX, barY, barWidth, barHeight);

    // Health (green)
    this.ctx.fillStyle = '#00ff00';
    this.ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);

    // Border
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(barX, barY, barWidth, barHeight);
  }

  /**
   * Render unit status indicators (fortified, activity, etc.)
   * @reference freeciv-web status indicator rendering
   */
  private renderUnitStatusIndicators(): void {
    // TODO: Implement status indicators
    // - Fortified indicator
    // - Sentry indicator
    // - Goto indicator
    // - Activity indicators
  }

  /**
   * Reset the selection animation state
   */
  private resetSelectionAnimation(): void {
    this.selectionAnimationStartTime = null;
    this.lastSelectedUnitId = null;
  }

  /**
   * Render pulsating diamond selection outline for selected unit
   * Renders on main canvas between terrain and units for proper layering
   */
  private renderUnitSelection(unit: Unit, viewport: MapViewport): void {
    const screenPos = this.mapToScreen(unit.x, unit.y, viewport);

    // Reset animation when unit selection changes
    if (this.lastSelectedUnitId !== unit.id) {
      this.selectionAnimationStartTime = Date.now();
      this.lastSelectedUnitId = unit.id;
      if (import.meta.env.DEV) {
        console.log(
          `Animation reset for unit ${unit.id} at time ${this.selectionAnimationStartTime}`
        );
      }
    }

    // Create pulsating effect using time-based animation that starts at brightest level
    const currentTime = Date.now();
    const elapsedTime = this.selectionAnimationStartTime
      ? currentTime - this.selectionAnimationStartTime
      : 0;
    const time = elapsedTime / 500; // Same speed as original (500ms cycle time)

    // Use cosine for natural start at maximum - but adjust frequency to match original
    // Original: sin(time) where time = Date.now() / 500
    // New: cos(time) where time = elapsedTime / 500 to maintain same period
    const pulse = (Math.cos(time) + 1) / 2; // 0 to 1, starts at 1 (brightest), same speed as original
    const opacity = 0.4 + pulse * 0.6; // 0.4 to 1.0, starts at 1.0
    const lineWidth = 1 + pulse * 2; // 1 to 3, starts at 3

    if (import.meta.env.DEV && elapsedTime < 100) {
      console.log(
        `Unit ${unit.id}: elapsed=${elapsedTime}ms, pulse=${pulse.toFixed(3)}, opacity=${opacity.toFixed(3)}`
      );
    }

    const centerX = screenPos.x + this.tileWidth / 2;
    const centerY = screenPos.y + this.tileHeight / 2;
    const halfWidth = this.tileWidth / 2;
    const halfHeight = this.tileHeight / 2;

    // Draw the diamond outline with pulsating yellow stroke
    this.ctx.strokeStyle = `rgba(255, 255, 0, ${opacity})`;
    this.ctx.lineWidth = lineWidth;
    this.ctx.beginPath();
    this.ctx.moveTo(centerX, centerY - halfHeight); // Top
    this.ctx.lineTo(centerX + halfWidth, centerY); // Right
    this.ctx.lineTo(centerX, centerY + halfHeight); // Bottom
    this.ctx.lineTo(centerX - halfWidth, centerY); // Left
    this.ctx.closePath();
    this.ctx.stroke();

    // Add a subtle pulsating fill
    this.ctx.fillStyle = `rgba(255, 255, 0, ${opacity * 0.1})`;
    this.ctx.fill();

    // Add inner diamond for enhanced visibility
    this.ctx.strokeStyle = `rgba(255, 255, 0, ${opacity * 0.7})`;
    this.ctx.lineWidth = 1;
    const innerScale = 0.85;
    const innerHalfWidth = halfWidth * innerScale;
    const innerHalfHeight = halfHeight * innerScale;

    this.ctx.beginPath();
    this.ctx.moveTo(centerX, centerY - innerHalfHeight); // Top
    this.ctx.lineTo(centerX + innerHalfWidth, centerY); // Right
    this.ctx.lineTo(centerX, centerY + innerHalfHeight); // Bottom
    this.ctx.lineTo(centerX - innerHalfWidth, centerY); // Left
    this.ctx.closePath();
    this.ctx.stroke();
  }

  private renderCity(city: City, viewport: MapViewport) {
    const screenPos = this.mapToScreen(city.x, city.y, viewport);

    // Apply city scaling for smaller visual representation
    const scaledWidth = (this.tileWidth - 10) * this.cityScale;
    const scaledHeight = (this.tileHeight - 10) * this.cityScale;
    const offsetX = (this.tileWidth - 10 - scaledWidth) / 2;
    const offsetY = (this.tileHeight - 10 - scaledHeight) / 2;

    this.ctx.fillStyle = this.getPlayerColor(city.playerId);
    this.ctx.fillRect(
      screenPos.x + 5 + offsetX,
      screenPos.y + 5 + offsetY,
      scaledWidth,
      scaledHeight
    );

    this.ctx.fillStyle = 'white';
    this.ctx.font = `${Math.floor(10 * this.cityScale)}px Arial`; // Scale font size too
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
      const padding = Math.max(viewportWidth * 2, viewportHeight * 2, 2000); // Much more generous padding

      const minX = -(mapWidthGui + padding);
      const maxX = padding;
      const minY = -(mapHeightGui + padding);
      const maxY = padding;

      const constrainedX = Math.max(minX, Math.min(maxX, guiX0));
      const constrainedY = Math.max(minY, Math.min(maxY, guiY0));

      // Only apply constraints if we're really far out of bounds
      // This prevents snap-back when dragging near edges
      const tolerance = 100; // pixels of tolerance before snapping
      if (
        Math.abs(constrainedX - guiX0) < tolerance &&
        Math.abs(constrainedY - guiY0) < tolerance
      ) {
        return { x: guiX0, y: guiY0 }; // Keep original position if close to bounds
      }

      return { x: constrainedX, y: constrainedY };
    }

    // For wrapping maps, use the full normalize_gui_pos logic
    const normalized = this.normalizeGuiPos(guiX0, guiY0);
    return { x: normalized.guiX, y: normalized.guiY };
  }

  /**
   * Render goto path exactly like freeciv-web: individual directional segments from each tile
   * Each tile draws one line segment in the direction of the next tile
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:382-397
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:3276 - ptile['goto_dir'] = dir
   */
  private renderGotoPath(gotoPath: GotoPath, viewport: MapViewport) {
    if (!gotoPath.tiles || gotoPath.tiles.length < 2) return;

    // Set consistent style for all path segments (matching freeciv-web)
    this.ctx.strokeStyle = gotoPath.valid ? 'rgba(0,168,255,0.9)' : 'rgba(255,68,68,0.9)';
    this.ctx.lineWidth = 10; // Exact freeciv-web line width
    this.ctx.lineCap = 'round';

    // Draw individual directional segments connecting each tile to the next
    for (let i = 0; i < gotoPath.tiles.length - 1; i++) {
      const fromTile = gotoPath.tiles[i];
      const toTile = gotoPath.tiles[i + 1];

      // Skip segments not in viewport
      if (!this.isInViewport(fromTile.x, fromTile.y, viewport)) {
        continue;
      }

      // Get screen positions for both tiles
      const fromPos = this.mapToScreen(fromTile.x, fromTile.y, viewport);
      const toPos = this.mapToScreen(toTile.x, toTile.y, viewport);

      // Render segment connecting tile centers (like freeciv-web but with accurate positions)
      this.renderGotoLineSegment(fromPos.x, fromPos.y, toPos.x, toPos.y);
    }

    // Draw turn indicators at waypoints for multi-turn paths
    if (gotoPath.estimatedTurns > 1) {
      this.renderTurnIndicators(gotoPath, viewport);
    }
  }

  /**
   * Render a goto line segment between two tile positions
   * This ensures perfect alignment by connecting actual tile centers
   */
  private renderGotoLineSegment(fromX: number, fromY: number, toX: number, toY: number) {
    // Calculate tile centers
    const x0 = fromX + this.tileWidth / 2;
    const y0 = fromY + this.tileHeight / 2;
    const x1 = toX + this.tileWidth / 2;
    const y1 = toY + this.tileHeight / 2;

    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
  }

  /**
   * Render turn indicators on long paths
   */
  private renderTurnIndicators(gotoPath: GotoPath, viewport: MapViewport) {
    // Find approximate points where turns end based on movement cost
    // This is a simplified version - a full implementation would track actual movement points
    const movementPerTurn = 3; // Assume 3 movement points per turn for most units
    let accumulatedCost = 0;
    let turnNumber = 1;

    for (const tile of gotoPath.tiles) {
      accumulatedCost += tile.moveCost;

      if (
        accumulatedCost >= movementPerTurn * turnNumber &&
        this.isInViewport(tile.x, tile.y, viewport)
      ) {
        const screenPos = this.mapToGuiVector(tile.x, tile.y);
        const canvasX = screenPos.guiDx - viewport.x + this.tileWidth / 2;
        const canvasY = screenPos.guiDy - viewport.y + this.tileHeight / 2;

        // Draw turn number circle
        this.ctx.fillStyle = 'rgba(255,255,255,0.8)';
        this.ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        this.ctx.lineWidth = 2;

        this.ctx.beginPath();
        this.ctx.arc(canvasX, canvasY, 12, 0, 2 * Math.PI);
        this.ctx.fill();
        this.ctx.stroke();

        // Draw turn number
        this.ctx.fillStyle = 'black';
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(turnNumber.toString(), canvasX, canvasY);

        turnNumber++;
      }
    }
  }

  /**
   * Set the scaling factors for different sprite types
   * @param resourceScale - Scale factor for resource sprites (0.1 to 2.0)
   * @param cityScale - Scale factor for city sprites (0.1 to 2.0)
   */
  setSpriteScales(resourceScale?: number, cityScale?: number) {
    if (resourceScale !== undefined && resourceScale >= 0.1 && resourceScale <= 2.0) {
      this.resourceScale = resourceScale;
    }
    if (cityScale !== undefined && cityScale >= 0.1 && cityScale <= 2.0) {
      this.cityScale = cityScale;
    }
  }

  /**
   * Get current sprite scaling factors
   */
  getSpriteScales() {
    return {
      resourceScale: this.resourceScale,
      cityScale: this.cityScale,
    };
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
          riverMask: tile.riverMask || tile.river_mask || 0, // Support both naming conventions
        });
      }
    }

    return tiles;
  }
}
