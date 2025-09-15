// Reference: /root/repo/reference/freeciv-web/javascript/overview.js
import type { GameState, Tile } from '../types';

export type MinimapColorMode = 0 | 1 | 2 | 3;

// Color constants from freeciv-web
const COLOR_OVERVIEW_UNKNOWN = 0;
const COLOR_OVERVIEW_MY_CITY = 1;
const COLOR_OVERVIEW_ALLIED_CITY = 2;
const COLOR_OVERVIEW_ENEMY_CITY = 3;
const COLOR_OVERVIEW_MY_UNIT = 4;
const COLOR_OVERVIEW_ALLIED_UNIT = 5;
const COLOR_OVERVIEW_ENEMY_UNIT = 6;
const COLOR_OVERVIEW_VIEWRECT = 7;
const COLOR_OVERVIEW_GENERIC = 8;

export interface MinimapPalette {
  [key: number]: [number, number, number]; // RGB values
}

export interface MinimapRenderOptions {
  colorMode: MinimapColorMode;
  tileSize: number;
  showUnits: boolean;
  showCities: boolean;
}

export class MinimapRenderer {
  private paletteTerrainOffset = 0;
  private paletteColorOffset = 0;
  private lastHash = -1;

  /**
   * Generate color palette for minimap rendering
   * Reference: freeciv-web/javascript/overview.js:349-406
   */
  generatePalette(gameState: GameState, colorMode: MinimapColorMode): MinimapPalette {
    const palette: MinimapPalette = {};

    // Base colors
    palette[COLOR_OVERVIEW_UNKNOWN] = [0, 0, 0]; // Black
    palette[COLOR_OVERVIEW_MY_CITY] = [255, 255, 255]; // White
    palette[COLOR_OVERVIEW_ALLIED_CITY] = [0, 255, 255]; // Cyan
    palette[COLOR_OVERVIEW_ENEMY_CITY] = [0, 255, 255]; // Cyan
    palette[COLOR_OVERVIEW_MY_UNIT] = [255, 255, 0]; // Yellow
    palette[COLOR_OVERVIEW_ALLIED_UNIT] = [255, 0, 0]; // Red
    palette[COLOR_OVERVIEW_ENEMY_UNIT] = [255, 0, 0]; // Red
    palette[COLOR_OVERVIEW_VIEWRECT] = [200, 200, 255]; // Light blue
    palette[COLOR_OVERVIEW_GENERIC] = [71, 89, 57]; // Dull terrain color

    this.paletteTerrainOffset = Object.keys(palette).length;

    // Add terrain colors
    if (gameState.terrainTypes && Object.keys(gameState.terrainTypes).length > 0) {
      Object.values(gameState.terrainTypes).forEach((terrain, index) => {
        const terrainIndex = this.paletteTerrainOffset + index;
        // Use terrain colors if available, otherwise default colors
        palette[terrainIndex] = [
          terrain.colorRed || 100,
          terrain.colorGreen || 100,
          terrain.colorBlue || 100,
        ];
      });
    } else {
      // Fallback terrain colors when no terrain types available
      const defaultTerrains = [
        [34, 139, 34], // Forest green
        [160, 82, 45], // Saddle brown (mountains)
        [255, 215, 0], // Gold (desert)
        [50, 205, 50], // Lime green (grassland)
        [30, 144, 255], // Dodger blue (ocean)
        [139, 69, 19], // Saddle brown (hills)
      ];
      defaultTerrains.forEach((color, index) => {
        palette[this.paletteTerrainOffset + index] = color as [number, number, number];
      });
    }

    this.paletteColorOffset = Object.keys(palette).length;

    // Add player colors based on color mode
    if (gameState.players) {
      Object.values(gameState.players).forEach((player, index) => {
        const playerIndex = this.paletteColorOffset + index;

        if (player.nation === '-1') {
          palette[playerIndex] = [0, 0, 0]; // Dead/unknown player
        } else {
          let color: [number, number, number] = [138, 138, 142]; // Default gray

          switch (colorMode) {
            case 0: // Diplomatic relations mode
              if (!gameState.isObserver && gameState.currentPlayerId) {
                // const currentPlayer = gameState.players[gameState.currentPlayerId];
                if (!player.isAlive) {
                  color = [48, 32, 32]; // Dead - dark grey/red
                } else if (player.id === gameState.currentPlayerId) {
                  color = [55, 128, 255]; // Self - light blue
                } else {
                  // Use diplomatic state colors
                  const relation = gameState.diplomaticStates?.[player.id];
                  switch (relation) {
                    case 'WAR':
                      color = [192, 32, 32];
                      break; // Red
                    case 'ALLIANCE':
                      color = [0, 32, 240];
                      break; // Med blue
                    case 'PEACE':
                      color = [0, 202, 32];
                      break; // Green
                    case 'ARMISTICE':
                      color = [105, 197, 32];
                      break; // Olive green
                    case 'CEASEFIRE':
                      color = [160, 192, 32];
                      break; // Ochre
                    default:
                      color = [138, 138, 142]; // No contact - grey
                  }
                }
              }
              break;
            case 1: // Primary nation colors (default)
              if (player.nation && gameState.nations?.[player.nation]) {
                const nation = gameState.nations[player.nation];
                color = [nation.colorRed || 100, nation.colorGreen || 100, nation.colorBlue || 100];
              }
              break;
            case 2: // Secondary nation colors
              if (player.nation && gameState.nations?.[player.nation]) {
                const nation = gameState.nations[player.nation];
                color = [
                  nation.colorRed2 || 100,
                  nation.colorGreen2 || 100,
                  nation.colorBlue2 || 100,
                ];
              }
              break;
            case 3: // Tertiary nation colors
              if (player.nation && gameState.nations?.[player.nation]) {
                const nation = gameState.nations[player.nation];
                color = [
                  nation.colorRed3 || 100,
                  nation.colorGreen3 || 100,
                  nation.colorBlue3 || 100,
                ];
              }
              break;
          }

          palette[playerIndex] = color;
        }
      });
    }

    return palette;
  }

  /**
   * Get the color index for a specific tile
   * Reference: freeciv-web/javascript/overview.js:411-453
   */
  getTileColor(tile: Tile, gameState: GameState, colorMode: MinimapColorMode): number {
    // Check for city first
    if (tile.city) {
      if (!gameState.currentPlayerId) {
        return COLOR_OVERVIEW_ENEMY_CITY;
      } else if (tile.city.playerId === gameState.currentPlayerId) {
        return COLOR_OVERVIEW_MY_CITY;
      } else {
        return COLOR_OVERVIEW_ENEMY_CITY;
      }
    }

    // Check for units
    if (tile.units && tile.units.length > 0) {
      const unit = tile.units[0]; // Show top unit
      if (!gameState.currentPlayerId) {
        return COLOR_OVERVIEW_ENEMY_UNIT;
      } else if (unit.playerId === gameState.currentPlayerId) {
        return COLOR_OVERVIEW_MY_UNIT;
      } else {
        return this.paletteColorOffset + parseInt(unit.playerId);
      }
    }

    // Show terrain or player ownership
    if (tile.known && tile.visible) {
      if (tile.owner && tile.owner !== '255') {
        return this.paletteColorOffset + parseInt(tile.owner);
      } else {
        // Show terrain color, but in diplomatic mode show generic color for non-ocean
        if (colorMode === 0 && !this.isOceanTile(tile)) {
          return COLOR_OVERVIEW_GENERIC;
        }

        // Get terrain type index
        if (gameState.terrainTypes && tile.terrain) {
          const terrainIndex = Object.keys(gameState.terrainTypes).indexOf(tile.terrain);
          if (terrainIndex >= 0) {
            return this.paletteTerrainOffset + terrainIndex;
          }
        }
      }
    }

    return COLOR_OVERVIEW_UNKNOWN;
  }

  /**
   * Generate a grid of color indices for the minimap
   * Reference: freeciv-web/javascript/overview.js:176-197
   */
  generateOverviewGrid(gameState: GameState, options: MinimapRenderOptions): number[][] {
    const { map } = gameState;
    if (!map || !map.tiles) return [];

    let cols = map.xsize || map.width;
    let rows = map.ysize || map.height;

    // Bugfix from freeciv-web: overview map doesn't support odd map sizes
    if (cols & 1) cols -= 1;
    if (rows & 1) rows -= 1;

    const grid: number[][] = [];
    for (let row = 0; row < rows * options.tileSize; row++) {
      grid[row] = new Array(cols * options.tileSize);
    }

    for (let x = 0; x < rows; x++) {
      for (let y = 0; y < cols; y++) {
        const tile = this.getTileAt(gameState, y, x);
        if (tile) {
          const colorIndex = this.getTileColor(tile, gameState, options.colorMode);
          this.renderMultiPixel(grid, x, y, colorIndex, options.tileSize);
        }
      }
    }

    return grid;
  }

  /**
   * Render a tile as multiple pixels for larger tile sizes
   * Reference: freeciv-web/javascript/overview.js:335-344
   */
  private renderMultiPixel(
    grid: number[][],
    x: number,
    y: number,
    colorIndex: number,
    tileSize: number
  ): void {
    if (x >= 0 && y >= 0 && x < grid.length / tileSize && y < grid[0]?.length / tileSize) {
      for (let px = 0; px < tileSize; px++) {
        for (let py = 0; py < tileSize; py++) {
          const gridX = tileSize * x + px;
          const gridY = tileSize * y + py;
          if (grid[gridX] && gridX < grid.length) {
            grid[gridX][gridY] = colorIndex;
          }
        }
      }
    }
  }

  /**
   * Generate hash for change detection
   * Reference: freeciv-web/javascript/overview.js:202-228
   */
  generateHash(gameState: GameState, viewportX?: number, viewportY?: number): number {
    let hash = 0;
    const { map } = gameState;

    if (map && map.tiles) {
      // Hash tile colors
      const mapHeight = map.ysize || map.height;
      const mapWidth = map.xsize || map.width;
      for (let x = 0; x < mapHeight; x++) {
        for (let y = 0; y < mapWidth; y++) {
          const tile = this.getTileAt(gameState, y, x);
          if (tile) {
            hash += this.getTileColor(tile, gameState, 1); // Use default color mode for hashing
          }
        }
      }

      // Include viewport position in hash
      if (viewportX !== undefined && viewportY !== undefined) {
        hash += viewportX;
        hash += viewportY;
      }
    }

    return hash;
  }

  /**
   * Helper to get tile at specific coordinates
   */
  private getTileAt(gameState: GameState, x: number, y: number): Tile | null {
    if (!gameState.map?.tiles) return null;
    return gameState.map.tiles[`${x},${y}`] || null;
  }

  /**
   * Helper to check if tile is ocean
   */
  private isOceanTile(tile: Tile): boolean {
    return tile.terrain === 'ocean' || tile.terrain === 'deep_ocean' || tile.terrain === 'lake';
  }

  /**
   * Render the grid to a canvas using the palette
   * Reference: freeciv-web bmp_lib functionality, adapted for canvas
   */
  renderToCanvas(
    canvas: HTMLCanvasElement,
    grid: number[][],
    palette: MinimapPalette,
    width: number,
    height: number
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx || grid.length === 0) return;

    canvas.width = width;
    canvas.height = height;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height && y < grid.length; y++) {
      for (let x = 0; x < width && x < grid[y].length; x++) {
        const colorIndex = grid[y][x];
        const color = palette[colorIndex] || [0, 0, 0];
        const pixelIndex = (y * width + x) * 4;

        data[pixelIndex] = color[0]; // Red
        data[pixelIndex + 1] = color[1]; // Green
        data[pixelIndex + 2] = color[2]; // Blue
        data[pixelIndex + 3] = 255; // Alpha
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  hasChanged(newHash: number): boolean {
    if (newHash !== this.lastHash) {
      this.lastHash = newHash;
      return true;
    }
    return false;
  }
}
