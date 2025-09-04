/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Tile } from '../../../types';
import {
  MATCH_NONE,
  MATCH_SAME,
  MATCH_PAIR,
  MATCH_FULL,
  CELL_WHOLE,
  CELL_CORNER,
  DIR4_TO_DIR8,
  CARDINAL_TILESET_DIRS,
} from '../../../constants/freeciv';
import { BaseRenderer, type RenderState } from './BaseRenderer';

export class TerrainRenderer extends BaseRenderer {
  // Cached tile lookup for performance
  private tileMap: Map<string, any> = new Map();
  private tileMapBuilt = false;
  private lastGlobalTiles: any = null;

  /**
   * Render terrain for all visible tiles in the viewport.
   */
  renderTerrain(state: RenderState, visibleTiles: Tile[]): void {
    for (const tile of visibleTiles) {
      this.renderTile(tile, state.viewport);
    }
  }

  /**
   * Render ocean tiles beyond map boundaries to create seamless infinite world appearance.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:305-380
   */
  renderOceanPadding(state: RenderState): void {
    const globalMap = (window as any).map;
    if (!globalMap) return;

    const viewport = state.viewport;

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

        if ((ptile_xi + ptile_yi) % 2 != 0) {
          continue;
        }

        // Check if this is a tile position (not a corner)
        if (ptile_xi % 2 == 0 && ptile_yi % 2 == 0) {
          if ((ptile_xi + ptile_yi) % 4 == 0) {
            // Calculate map coordinates for this tile position
            const ptile_si = ptile_xi + ptile_yi;
            const ptile_di = ptile_yi - ptile_xi;
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

  private renderTile(tile: Tile, viewport: any): void {
    const screenPos = this.mapToScreen(tile.x, tile.y, viewport);
    // Render multi-layer terrain like freeciv-web does
    this.renderTerrainLayers(tile, screenPos);
  }

  private renderTerrainLayers(tile: Tile, screenPos: { x: number; y: number }): void {
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
        const resourceScale = 0.7; // Make resources 30% smaller (from original MapRenderer)
        const scaledWidth = sprite.width * resourceScale;
        const scaledHeight = sprite.height * resourceScale;
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
            `Resource sprite rendered: ${resourceSprite.key} at (${screenPos.x},${screenPos.y}) scale=${resourceScale}`
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

  private buildTileMap(): void {
    if (this.tileMapBuilt) return;

    const globalTiles = (window as any).tiles;
    if (!globalTiles || !Array.isArray(globalTiles)) {
      return;
    }

    // Validate that tiles array is populated before building cache
    if (globalTiles.length === 0) {
      return;
    }

    this.tileMap.clear();

    for (const tile of globalTiles) {
      if (
        tile &&
        Object.prototype.hasOwnProperty.call(tile, 'x') &&
        Object.prototype.hasOwnProperty.call(tile, 'y')
      ) {
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

  /**
   * Reset tile map cache if tiles data has changed.
   */
  invalidateTileCache(): void {
    // Reset tile map cache if tiles data has changed - with React Strict Mode resilience
    const currentGlobalTiles = (window as any).tiles;
    if (currentGlobalTiles && currentGlobalTiles !== this.lastGlobalTiles) {
      // Additional validation to avoid unnecessary cache invalidation
      const isValidNewArray = Array.isArray(currentGlobalTiles) && currentGlobalTiles.length > 0;
      const previousWasValid =
        Array.isArray(this.lastGlobalTiles) && this.lastGlobalTiles.length > 0;

      // Only invalidate if we have a legitimately new, populated tiles array
      if (
        isValidNewArray &&
        (!previousWasValid || currentGlobalTiles.length !== this.lastGlobalTiles.length)
      ) {
        console.log('TerrainRenderer: Invalidating tile cache due to new tiles array', {
          newLength: currentGlobalTiles.length,
          previousLength: this.lastGlobalTiles?.length || 0,
          strictModeResilient: true,
        });
        this.tileMapBuilt = false;
        this.lastGlobalTiles = currentGlobalTiles;
      } else if (isValidNewArray && previousWasValid) {
        // Same array size - likely React Strict Mode double render, update reference but keep cache
        console.log(
          'TerrainRenderer: Updating tiles array reference without cache invalidation (likely React Strict Mode)'
        );
        this.lastGlobalTiles = currentGlobalTiles;
      }
    }
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
}
