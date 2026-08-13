/**
 * @module client/components/Canvas2D/renderers/TerrainRenderer
 * Implements the Terrain Renderer canvas rendering stage.
 */
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
} from '../../../constants/freeciv';
import { BaseRenderer, type RenderState } from './BaseRenderer';
import { isIsometricTopology, stepNativeMapPosition } from '../mapTopologyGeometry';

export interface TerrainRenderEntry {
  state: RenderState;
  tile: Tile;
}

export class TerrainRenderer extends BaseRenderer {
  private extraGraphics: Record<string, { graphic?: string; graphic_alt?: string }> = {};
  // Cached tile lookup for performance
  private tileMap: Map<string, any> = new Map();
  private tileMapBuilt = false;
  private sourceTiles: Record<string, Tile> = {};
  private lastTiles: Record<string, Tile> | null = null;
  private mapWidth = 0;
  private mapHeight = 0;
  private topologyId = 0;
  private wrapId = 0;

  /**
   * Render terrain for all visible tiles in the viewport.
   * Covers LAYER_TERRAIN1 through LAYER_ROADS in freeciv-web layer order.
   */
  renderTerrain(state: RenderState, visibleTiles: Tile[]): void {
    this.renderTerrainEntries(visibleTiles.map(tile => ({ state, tile })));
  }

  /** Paint one global Freeciv terrain walk, including translated wrap copies. */
  renderTerrainEntries(entries: TerrainRenderEntry[]): void {
    const first = entries[0];
    if (!first) return;
    this.setMapTopology(first.state);
    this.invalidateTileCache(first.state.map.tiles);

    const prepared = entries.map(({ state: entryState, tile }) => ({
      tile,
      screenPos: this.mapToScreen(tile.x, tile.y, entryState.viewport),
      layers: [0, 1, 2].map(layer => this.fillTerrainSpriteArraySimple(layer, tile)),
    }));

    // Freeciv's painter order is layer-first: every visible tile in terrain
    // layer 1, then every tile in terrain layer 2, and so on. Rendering all
    // layers tile-by-tile lets a later base tile cover an earlier overlay.
    for (const entry of prepared) {
      if (entry.layers.every(sprites => sprites.length === 0)) {
        this.drawTerrainFallback(entry.tile, entry.screenPos);
      }
    }
    for (let layer = 0; layer <= 2; layer++) {
      for (const entry of prepared) {
        this.drawSprites(entry.layers[layer], entry.screenPos);
      }
    }

    // Irrigation belongs to TERRAIN3, followed by the road/rail/maglev layer.
    for (const entry of prepared) {
      this.drawInfrastructure(entry.tile, entry.screenPos, 'terrain');
    }
    for (const entry of prepared) {
      this.drawInfrastructure(entry.tile, entry.screenPos, 'roads');
    }
  }

  /** Draw LAYER_SPECIAL1, except borders which MapRenderer appends to this layer. */
  renderSpecials(state: RenderState, visibleTiles: Tile[]): void {
    this.setMapTopology(state);
    this.invalidateTileCache(state.map.tiles);
    for (const tile of visibleTiles) {
      const screenPos = this.mapToScreen(tile.x, tile.y, state.viewport);
      this.drawRiver(tile, screenPos);
      this.drawResource(tile, screenPos);
      this.drawInfrastructure(tile, screenPos, 'special1');
    }
  }

  /** Draw LAYER_SPECIAL2 base graphics between cities and units. */
  renderSpecial2(state: RenderState, visibleTiles: Tile[]): void {
    this.setMapTopology(state);
    this.invalidateTileCache(state.map.tiles);
    for (const tile of visibleTiles) {
      const screenPos = this.mapToScreen(tile.x, tile.y, state.viewport);
      this.drawInfrastructure(tile, screenPos, 'special2');
    }
  }

  /** Draw LAYER_SPECIAL3 base foregrounds after fog. */
  renderSpecial3(state: RenderState, visibleTiles: Tile[]): void {
    this.setMapTopology(state);
    this.invalidateTileCache(state.map.tiles);
    for (const tile of visibleTiles) {
      const screenPos = this.mapToScreen(tile.x, tile.y, state.viewport);
      this.drawInfrastructure(tile, screenPos, 'special3');
    }
  }

  /** Draw Freeciv's TILELABEL layer between foreground extras and city bars. */
  renderTileLabels(state: RenderState, visibleTiles: Tile[]): void {
    this.ctx.font = '16px Georgia, serif';
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    for (const tile of visibleTiles) {
      if (!tile.label) continue;
      const screenPos = this.mapToScreen(tile.x, tile.y, state.viewport);
      const textWidth = this.ctx.measureText(tile.label).width;
      this.ctx.fillText(
        tile.label,
        screenPos.x + this.tileWidth / 2 - Math.floor(textWidth / 2),
        screenPos.y + 14
      );
    }
  }

  private drawRiver(tile: Tile, screenPos: { x: number; y: number }): boolean {
    const riverSprite = this.getTileRiverSprite(tile);
    if (riverSprite) {
      const sprite = this.tilesetLoader.getSprite(riverSprite.key);
      if (sprite) {
        this.ctx.drawImage(sprite, screenPos.x, screenPos.y);
        return true;
      }
    }
    return false;
  }

  private drawInfrastructure(
    tile: Tile,
    screenPos: { x: number; y: number },
    layer: 'terrain' | 'roads' | 'special1' | 'special2' | 'special3'
  ): boolean {
    let rendered = false;
    for (const spriteInfo of this.getInfrastructureSprites(tile, layer)) {
      const sprite = this.tilesetLoader.getSprite(spriteInfo.key);
      if (sprite) {
        this.ctx.drawImage(
          sprite,
          screenPos.x + (spriteInfo.offset_x ?? 0),
          screenPos.y + (spriteInfo.offset_y ?? 0)
        );
        rendered = true;
      }
    }
    return rendered;
  }

  private drawResource(tile: Tile, screenPos: { x: number; y: number }): boolean {
    const resourceSprite = this.getTileResourceSprite(tile);
    if (resourceSprite) {
      const sprite = this.tilesetLoader.getSprite(resourceSprite.key);
      if (sprite) {
        // mapview_put_tile() draws generated resource sprites without an
        // additional presentation transform.
        this.ctx.drawImage(sprite, screenPos.x, screenPos.y);
        return true;
      }
    }
    return false;
  }

  private drawSprites(
    sprites: Array<{ key: string; offset_x?: number; offset_y?: number }>,
    screenPos: { x: number; y: number }
  ): boolean {
    let rendered = false;
    for (const spriteInfo of sprites) {
      const sprite = this.tilesetLoader.getSprite(spriteInfo.key);
      if (sprite) {
        this.ctx.drawImage(
          sprite,
          screenPos.x + (spriteInfo.offset_x || 0),
          screenPos.y + (spriteInfo.offset_y || 0)
        );
        rendered = true;
      }
    }
    return rendered;
  }

  private drawTerrainFallback(tile: Tile, screenPos: { x: number; y: number }): void {
    this.ctx.fillStyle = this.getTerrainColor(tile.terrain);
    this.ctx.fillRect(screenPos.x, screenPos.y, this.tileWidth, this.tileHeight);
  }

  private getInfrastructureSprites(
    tile: Tile,
    layer: 'terrain' | 'roads' | 'special1' | 'special2' | 'special3'
  ): Array<{ key: string; offset_x?: number; offset_y?: number }> {
    this.buildTileMap();
    const directions = [
      { dx: -1, dy: -1, name: 'nw' },
      { dx: 0, dy: -1, name: 'n' },
      { dx: 1, dy: -1, name: 'ne' },
      { dx: -1, dy: 0, name: 'w' },
      { dx: 1, dy: 0, name: 'e' },
      { dx: -1, dy: 1, name: 'sw' },
      { dx: 0, dy: 1, name: 's' },
      { dx: 1, dy: 1, name: 'se' },
    ];
    const sprites: Array<{ key: string; offset_x?: number; offset_y?: number }> = [];

    if (layer === 'roads') {
      return this.getPathSprites(tile, directions).map(key => ({ key }));
    }

    const extras = this.getNormalizedImprovements(tile);
    const pushExtra = (name: string, fallback?: string, offsetY?: number) => {
      if (!extras.has(name)) return;
      const graphic = this.extraGraphic(name, fallback);
      if (graphic) sprites.push({ key: graphic, offset_y: offsetY });
    };

    if (layer === 'terrain') {
      if (tile.cityId) return sprites;
      if (extras.has('farmland')) pushExtra('farmland');
      else pushExtra('irrigation');
      return sprites;
    }

    if (layer === 'special1') {
      pushExtra('mine');
      pushExtra('oil_well');
      if (!tile.cityId && extras.has('fortress')) {
        sprites.push({ key: 'base.fortress_bg', offset_y: -this.tileHeight / 2 });
      }
      pushExtra('hut');
      pushExtra('pollution');
      pushExtra('fallout');
      return sprites;
    }

    if (layer === 'special2' && !tile.cityId) {
      if (extras.has('airbase')) {
        sprites.push({ key: 'base.airbase_mg', offset_y: -this.tileHeight / 2 });
      }
      if (extras.has('buoy')) {
        sprites.push({ key: 'base.buoy_mg', offset_y: -this.tileHeight / 2 });
      }
      if (extras.has('ruins')) {
        sprites.push({ key: 'extra.ruins_mg', offset_y: -this.tileHeight / 2 });
      }
      return sprites;
    }

    if (layer === 'special3' && !tile.cityId && extras.has('fortress')) {
      sprites.push({ key: 'base.fortress_fg', offset_y: -this.tileHeight / 2 });
    }
    return sprites;
  }

  /** Port of freeciv-web fill_path_sprite_array(), including hidden_by rules. */
  private getPathSprites(
    tile: Tile,
    directions: Array<{ dx: number; dy: number; name: string }>
  ): string[] {
    const hasExtra = (candidate: Tile, name: 'road' | 'railroad' | 'maglev'): boolean => {
      const extras = this.getNormalizedImprovements(candidate);
      if (name === 'road') return Boolean(candidate.hasRoad || extras.has('road'));
      if (name === 'railroad') return Boolean(candidate.hasRailroad || extras.has('railroad'));
      return extras.has('maglev');
    };

    const road = hasExtra(tile, 'road');
    const rail = hasExtra(tile, 'railroad');
    const maglev = hasExtra(tile, 'maglev');
    let drawSingleRoad = tile.cityId ? false : road && !rail;
    let drawSingleRail = tile.cityId || maglev ? false : rail;
    let drawSingleMaglev = tile.cityId ? false : maglev;
    const roadConnections: string[] = [];
    const railConnections: string[] = [];
    const maglevConnections: string[] = [];

    for (const { dx, dy, name } of directions) {
      const neighbor = this.getDirectionalNeighborTile(tile, dx, dy);
      const known =
        neighbor?.known === true || (typeof neighbor?.known === 'number' && neighbor.known > 0);
      if (!neighbor || !known) continue;

      const drawMaglev = maglev && hasExtra(neighbor, 'maglev');
      const drawRail = rail && hasExtra(neighbor, 'railroad') && !drawMaglev;
      const drawRoad = road && hasExtra(neighbor, 'road') && !drawRail && !drawMaglev;
      if (drawRoad) roadConnections.push(name);
      if (drawRail) railConnections.push(name);
      if (drawMaglev) maglevConnections.push(name);

      if (drawMaglev) {
        drawSingleRoad = false;
        drawSingleRail = false;
        drawSingleMaglev = false;
      } else {
        drawSingleRail &&= !drawRail;
        drawSingleRoad &&= !drawRail && !drawRoad;
      }
    }

    const roadPrefix = this.extraGraphic('road', 'road.road');
    const railPrefix = this.extraGraphic('railroad', 'road.rail');
    const maglevPrefix = this.extraGraphic('maglev', 'road.maglev');
    const sprites = [
      ...roadConnections.map(name => `${roadPrefix}_${name}`),
      ...railConnections.map(name => `${railPrefix}_${name}`),
      ...maglevConnections.map(name => `${maglevPrefix}_${name}`),
    ];
    if (drawSingleMaglev) sprites.push(`${maglevPrefix}_isolated`);
    else if (drawSingleRail) sprites.push(`${railPrefix}_isolated`);
    else if (drawSingleRoad) sprites.push(`${roadPrefix}_isolated`);
    return sprites;
  }

  private getNormalizedImprovements(tile: Tile): Set<string> {
    return new Set(
      (tile.improvements ?? []).map(improvement =>
        improvement.toLowerCase().replaceAll(' ', '_').replaceAll('-', '_')
      )
    );
  }

  private extraGraphic(name: string, fallback?: string): string {
    const aliases: Record<string, string> = {
      icy_ivory: 'ivory',
      arctic_ivory: 'ivory',
      tundra_game: 'game',
      grassland_resources: 'bonus',
    };
    const id = `extra_${aliases[name] ?? name}`;
    const definition = this.extraGraphics[id];
    return (
      [definition?.graphic, definition?.graphic_alt].find(
        candidate => candidate && candidate !== '-'
      ) ??
      fallback ??
      ''
    );
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
    const dither_dirs = DIR4_TO_DIR8;
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
                    !tterrain_near[dither_dirs[i]] ||
                    !ts_tiles[tterrain_near[dither_dirs[i]]['graphic_str']]
                  )
                    continue;
                  const near_dlp =
                    tile_types_setup['l' + l + '.' + tterrain_near[dither_dirs[i]]['graphic_str']];
                  const terrain_near =
                    near_dlp && near_dlp['dither'] == true
                      ? tterrain_near[dither_dirs[i]]['graphic_str']
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
                  // Freeciv-web's MATCH_SAME branch indexes the first four
                  // entries of the DIR8 neighbor array directly. This is
                  // intentionally different from the cardinal direction
                  // list used by dither and CELL_CORNER matching.
                  const dir = i;
                  if (!tterrain_near[dir] || !ts_tiles[tterrain_near[dir]['graphic_str']]) continue;
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
            case 1:
              return 2; // NORTH to NORTHEAST
            case 2:
              return 4; // NORTHEAST to EAST
            case 4:
              return 7; // EAST to SOUTHEAST
            case 7:
              return 6; // SOUTHEAST to SOUTH
            case 6:
              return 5; // SOUTH to SOUTHWEST
            case 5:
              return 3; // SOUTHWEST to WEST
            case 3:
              return 0; // WEST to NORTHWEST
            case 0:
              return 1; // NORTHWEST to NORTH
          }
          return -1;
        };

        const dir_ccw = (dir: number): number => {
          switch (dir) {
            case 1:
              return 0; // NORTH to NORTHWEST
            case 2:
              return 1; // NORTHEAST to NORTH
            case 4:
              return 2; // EAST to NORTHEAST
            case 7:
              return 4; // SOUTHEAST to EAST
            case 6:
              return 7; // SOUTH to SOUTHEAST
            case 5:
              return 6; // SOUTHWEST to SOUTH
            case 3:
              return 5; // WEST to SOUTHWEST
            case 0:
              return 3; // NORTHWEST to WEST
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
              // MATCH_PAIR encodes whether each adjacent tile has the
              // secondary match index, then uses the corresponding generated
              // cell sprite (for example lake_cell_u_s_l_s).
              const thatMatchIndex = dlp['match_index'][1];
              const b1 = m[2] == thatMatchIndex ? 1 : 0;
              const b2 = m[1] == thatMatchIndex ? 1 : 0;
              const b3 = m[0] == thatMatchIndex ? 1 : 0;
              array_index = array_index * 2 + b1;
              array_index = array_index * 2 + b2;
              array_index = array_index * 2 + b3;

              const matchTypes = (window as any).ts_layer?.[l]?.match_types || [];
              const thisMatchLetter = matchTypes[dlp['match_index'][0]]?.[0] || '';
              const thatMatchLetter = matchTypes[thatMatchIndex]?.[0] || '';
              const matchTypeLetter = (matchIndex: number): string =>
                matchIndex == thatMatchIndex ? thatMatchLetter : thisMatchLetter;
              // Sprite names are preloaded in m[0], m[1], m[2] order. The
              // draw-time bit packing above is intentionally reversed.
              const matchLetters = [m[0], m[1], m[2]].map(matchTypeLetter).join('_');
              const directionLetters = ['u', 'd', 'r', 'l'];
              result_sprites.push({
                key: `t.l${l}.${pterrain['graphic_str']}_cell_${directionLetters[i]}_${matchLetters}`,
                offset_x: x,
                offset_y: y,
              });
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

    const tiles = Object.values(this.sourceTiles);
    if (tiles.length === 0) {
      return;
    }

    this.tileMap.clear();

    for (const tile of tiles) {
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

  // Get neighboring tiles from the authoritative game map.
  // Freeciv-web's DIR8 order is NW, N, NE, W, E, SW, S, SE.
  private getNeighboringTerrains(tile: Tile): any[] {
    this.buildTileMap();

    const neighbors = [];
    // @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:24-31,360-369
    const directions = [
      { dx: -1, dy: -1 }, // 0: Northwest
      { dx: 0, dy: -1 }, // 1: North
      { dx: 1, dy: -1 }, // 2: Northeast
      { dx: -1, dy: 0 }, // 3: West
      { dx: 1, dy: 0 }, // 4: East
      { dx: -1, dy: 1 }, // 5: Southwest
      { dx: 0, dy: 1 }, // 6: South
      { dx: 1, dy: 1 }, // 7: Southeast
    ];

    for (const dir of directions) {
      // Fast O(1) lookup instead of O(n) search
      const neighborTile = this.getDirectionalNeighborTile(tile, dir.dx, dir.dy);
      let neighborTerrain = null;

      const neighborIsKnown =
        neighborTile?.known === true ||
        (typeof neighborTile?.known === 'number' && neighborTile.known > 0);

      if (neighborTile?.terrain && neighborTile.terrain !== 'unknown' && neighborIsKnown) {
        neighborTerrain = {
          graphic_str: this.mapTerrainName(neighborTile.terrain),
        };
      } else {
        // Freeciv extends the current terrain into unknown/off-map neighbors.
        // Treating the "unknown" sentinel as a real terrain selects incomplete
        // corner cells and exposes the blue map background at the fog edge.
        // @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/terrain.js:46-63
        neighborTerrain = { graphic_str: this.mapTerrainName(tile.terrain) };
      }

      neighbors.push(neighborTerrain);
    }

    return neighbors;
  }

  private setMapTopology(state: RenderState): void {
    this.mapWidth = state.map.xsize ?? state.map.width;
    this.mapHeight = state.map.ysize ?? state.map.height;
    this.topologyId = state.map.topology_id ?? 0;
    this.wrapId = state.map.wrap_id ?? 0;
  }

  private getDirectionalNeighborTile(tile: Tile, dx: number, dy: number): Tile | undefined {
    if (!this.mapWidth || !this.mapHeight) {
      return this.tileMap.get(`${tile.x + dx},${tile.y + dy}`) as Tile | undefined;
    }

    // map_pos_to_tile() shifts the other browser-grid axis at a finite ISO
    // edge before resolving the flat packet index.
    const candidateX = tile.x + dx;
    let candidateY = tile.y + dy;
    if (
      isIsometricTopology(this.topologyId) &&
      this.wrapId === 0 &&
      (candidateX < 0 || candidateX >= this.mapWidth)
    ) {
      candidateY += candidateX < 0 ? 1 : -1;
      const flatIndex = candidateX + candidateY * this.mapWidth;
      if (flatIndex < 0 || flatIndex >= this.mapWidth * this.mapHeight) return undefined;
      const lookupX = ((flatIndex % this.mapWidth) + this.mapWidth) % this.mapWidth;
      const lookupY = Math.floor(flatIndex / this.mapWidth);
      return this.tileMap.get(`${lookupX},${lookupY}`) as Tile | undefined;
    }

    const position = stepNativeMapPosition(
      candidateX,
      candidateY,
      0,
      0,
      this.mapWidth,
      this.mapHeight,
      this.topologyId,
      this.wrapId
    );
    return position
      ? (this.tileMap.get(`${position.x},${position.y}`) as Tile | undefined)
      : undefined;
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
      lake: '#2E5B8C', // Darker blue for lakes (freshwater)
      coast: '#4682B4',
      deep_ocean: '#1e3a5f',
      swamp: '#556B2F',
    };

    return colors[terrain] || '#808080';
  }

  /**
   * Reset tile map cache if tiles data has changed.
   */
  invalidateTileCache(tiles: Record<string, Tile>): void {
    if (tiles === this.lastTiles) return;
    this.sourceTiles = tiles;
    this.lastTiles = tiles;
    this.tileMapBuilt = false;
  }

  /**
   * Calculate river sprite for a tile based on its riverMask connections.
   * Port of freeciv-web's get_tile_river_sprite() function.
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:get_tile_river_sprite()
   * @param tile - The tile to calculate river sprite for
   * @returns Sprite info with key for river rendering, or null if no river
   */
  private getTileRiverSprite(tile: Tile): { key: string } | null {
    if (tile.riverMask) {
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

    // Freeciv draws a river outlet on a coast tile when an adjacent tile owns
    // the river extra. The authoritative snapshot represents that extra as a
    // non-zero riverMask on the neighboring tile.
    if (this.mapTerrainName(tile.terrain) === 'coast') {
      const cardinalNeighbors = [
        { dx: 0, dy: -1, name: 'n' },
        { dx: 1, dy: 0, name: 'e' },
        { dx: 0, dy: 1, name: 's' },
        { dx: -1, dy: 0, name: 'w' },
      ];
      for (const { dx, dy, name } of cardinalNeighbors) {
        if (this.getDirectionalNeighborTile(tile, dx, dy)?.riverMask) {
          return { key: `road.river_outlet_${name}:0` };
        }
      }
    }

    return null;
  }

  /**
   * Calculate resource sprite for a tile based on its resource type.
   * Port of freeciv-web's resource rendering functionality.
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js (resource handling)
   * @param tile - The tile to calculate resource sprite for
   * @returns Sprite info with key for resource rendering, or null if no resource
   */
  private getTileResourceSprite(tile: Tile): { key: string } | null {
    if (!tile.resource) return null;
    const authoritativeGraphic = this.extraGraphic(tile.resource);
    if (authoritativeGraphic) return { key: `${authoritativeGraphic}:0` };

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

  setExtraGraphics(graphics: Record<string, { graphic?: string; graphic_alt?: string }>): void {
    this.extraGraphics = graphics;
  }
}
