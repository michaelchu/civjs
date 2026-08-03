/**
 * @module client/components/Canvas2D/renderers/BorderRenderer
 * BorderRenderer - Renders national borders on the canvas
 * Ported from freeciv-web to modern TypeScript
 *
 * @reference freeciv-web/javascript/2dcanvas/mapview.js:705-820 - Border line rendering
 * @reference freeciv-web/javascript/2dcanvas/tilespec.js:1208-1226 - Border sprite generation
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { BaseRenderer } from './BaseRenderer';
import type { RenderState } from './BaseRenderer';
import type { Tile } from '../../../types';

// Direction constants from freeciv
// @reference freeciv-web/javascript/fc_types.js
enum Direction {
  DIR8_NORTH = 0,
  DIR8_NORTHEAST = 1,
  DIR8_EAST = 2,
  DIR8_SOUTHEAST = 3,
  DIR8_SOUTH = 4,
  DIR8_SOUTHWEST = 5,
  DIR8_WEST = 6,
  DIR8_NORTHWEST = 7,
}

// Cardinal directions only (used for borders)
const CARDINAL_DIRS = [
  Direction.DIR8_NORTH,
  Direction.DIR8_EAST,
  Direction.DIR8_SOUTH,
  Direction.DIR8_WEST,
];

interface BorderSprite {
  key: string;
  dir: Direction;
  color: string;
  color2: string;
  color3: string;
}

interface BorderRenderOptions {
  drawBorders: boolean;
  drawDashedBorders: boolean;
  drawTertiaryColors: boolean;
  drawThickBorders: boolean;
  drawMovingBorders: boolean;
  drawTerritoryFill: boolean;
  borderAnimDelay: number;
}

export class BorderRenderer extends BaseRenderer {
  private borderAnim: number = 0;
  private options: BorderRenderOptions;
  private playerColors: Map<string, { primary: string; secondary: string; tertiary: string }>;

  constructor(
    ctx: CanvasRenderingContext2D,
    tilesetLoader: any,
    tileWidth: number,
    tileHeight: number,
    options?: Partial<BorderRenderOptions>
  ) {
    super(ctx, tilesetLoader, tileWidth, tileHeight);

    this.options = {
      drawBorders: true,
      drawDashedBorders: false,
      drawTertiaryColors: false,
      drawThickBorders: false,
      drawMovingBorders: false,
      drawTerritoryFill: false,
      borderAnimDelay: 750,
      ...options,
    };

    this.playerColors = new Map();
    this.initializePlayerColors();
  }

  /**
   * Initialize player nation colors
   * In a real implementation, this would come from the nation data
   */
  private initializePlayerColors(): void {
    // Default colors for players - would be loaded from nation data
    const defaultColors = [
      { primary: '#FF0000', secondary: '#CC0000', tertiary: '#990000' }, // Red
      { primary: '#0000FF', secondary: '#0000CC', tertiary: '#000099' }, // Blue
      { primary: '#00FF00', secondary: '#00CC00', tertiary: '#009900' }, // Green
      { primary: '#FFFF00', secondary: '#CCCC00', tertiary: '#999900' }, // Yellow
      { primary: '#FF00FF', secondary: '#CC00CC', tertiary: '#990099' }, // Magenta
      { primary: '#00FFFF', secondary: '#00CCCC', tertiary: '#009999' }, // Cyan
    ];

    for (let i = 0; i < 6; i++) {
      this.playerColors.set(i.toString(), defaultColors[i]);
    }
  }

  /**
   * Get player colors by player ID from game state (like freeciv-web nations[players[owner]['nation']])
   * @reference freeciv-web uses pnation.color, pnation.color2, pnation.color3 from nation data
   */
  private getPlayerColors(
    playerId: string,
    players?: Record<string, { color: string; name: string; nation: string }>
  ): {
    primary: string;
    secondary: string;
    tertiary: string;
  } {
    // Try to get from cached colors first
    const cached = this.playerColors.get(playerId);
    if (cached) {
      return cached;
    }

    // Try to get from game state players (like freeciv-web nations[players[owner]['nation']])
    if (players && players[playerId]) {
      const playerColor = players[playerId].color;
      if (playerColor) {
        // Use player's nation color as primary, generate darker variations for secondary/tertiary
        const colors = {
          primary: playerColor,
          secondary: this.darkenColor(playerColor, 0.2),
          tertiary: this.darkenColor(playerColor, 0.4),
        };
        // Cache the colors for performance
        this.playerColors.set(playerId, colors);
        return colors;
      }
    }

    // Fallback to default colors if no player data available
    return {
      primary: '#808080',
      secondary: '#606060',
      tertiary: '#404040',
    };
  }

  /**
   * Darken a hex color by a percentage (for secondary/tertiary border colors)
   */
  private darkenColor(hex: string, factor: number): string {
    // Remove # if present
    const color = hex.replace('#', '');

    // Convert to RGB
    const r = parseInt(color.substr(0, 2), 16);
    const g = parseInt(color.substr(2, 2), 16);
    const b = parseInt(color.substr(4, 2), 16);

    // Darken each component
    const darkR = Math.round(r * (1 - factor));
    const darkG = Math.round(g * (1 - factor));
    const darkB = Math.round(b * (1 - factor));

    // Convert back to hex
    return (
      '#' +
      darkR.toString(16).padStart(2, '0') +
      darkG.toString(16).padStart(2, '0') +
      darkB.toString(16).padStart(2, '0')
    );
  }

  /**
   * Get the neighbor tile in a given direction
   * @reference freeciv-web/javascript/mapctrl.js - mapstep function
   */
  private getNeighborTile(tile: Tile, dir: Direction, map: any): Tile | null {
    const { x, y } = tile;
    let newX = x;
    let newY = y;

    switch (dir) {
      case Direction.DIR8_NORTH:
        newY--;
        break;
      case Direction.DIR8_EAST:
        newX++;
        break;
      case Direction.DIR8_SOUTH:
        newY++;
        break;
      case Direction.DIR8_WEST:
        newX--;
        break;
      default:
        return null;
    }

    const mapWidth = map.xsize ?? map.width;
    const mapHeight = map.ysize ?? map.height;
    const wrapId = map.wrap_id ?? 0;

    // CivJS wraps the authoritative rectangular map coordinates directly.
    if ((wrapId & 1) !== 0) newX = ((newX % mapWidth) + mapWidth) % mapWidth;
    if ((wrapId & 2) !== 0) newY = ((newY % mapHeight) + mapHeight) % mapHeight;
    if (newX < 0 || newX >= mapWidth || newY < 0 || newY >= mapHeight) return null;

    return map.tiles[`${newX},${newY}`] || null;
  }

  /**
   * Generate border sprites for a tile - EXACTLY matches freeciv-web logic
   * @reference freeciv-web/javascript/2dcanvas/tilespec.js:1208-1226 get_border_line_sprites
   */
  private getBorderLineSprites(
    tile: Tile,
    map: any,
    players?: Record<string, { color: string; name: string; nation: string }>
  ): BorderSprite[] {
    const result: BorderSprite[] = [];

    // Generate border sprites following our working logic for map edges and unowned neighbors
    for (const dir of CARDINAL_DIRS) {
      const neighbor = this.getNeighborTile(tile, dir, map);

      // Logic compliance: tile must have an owner to generate borders
      if (!tile.owner) {
        continue;
      }

      // Generate border in these cases:
      // 1. Neighbor exists and has different owner (including null owner)
      // 2. No neighbor (map edge)
      const shouldDrawBorder =
        !neighbor || // No neighbor (map edge)
        (neighbor && tile.owner !== neighbor.owner); // Different owner (including unowned neighbor)

      if (shouldDrawBorder) {
        // Get nation colors - in freeciv-web this comes from nations[players[owner]['nation']]
        const colors = this.getPlayerColors(tile.owner, players);
        result.push({
          key: 'border',
          dir,
          color: colors.primary,
          color2: colors.secondary,
          color3: colors.tertiary,
        });
      }
    }

    return result;
  }

  /**
   * Draw a border line on the canvas
   * @reference freeciv-web/javascript/2dcanvas/mapview.js:705-820 mapview_put_border_line
   */
  private drawBorderLine(
    dir: Direction,
    color: string,
    color2: string,
    color3: string,
    canvasX: number,
    canvasY: number
  ): void {
    const ctx = this.ctx;
    const { drawDashedBorders, drawTertiaryColors, drawThickBorders, drawMovingBorders } =
      this.options;

    // Save canvas state before modifying any properties
    ctx.save();

    // Use exact freeciv-web coordinates (canvas_x + 47, canvas_y + 3)
    // @reference freeciv-web/javascript/2dcanvas/mapview.js:707-708
    const x = canvasX + 47; // Fixed offset matching freeciv-web
    const y = canvasY + 3;

    const lineWidth = drawThickBorders ? 3.5 : 2.5;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'butt';

    // Handle animated borders
    if (drawMovingBorders) {
      this.borderAnim++;
      ctx.lineDashOffset = Math.trunc(this.borderAnim / this.options.borderAnimDelay);
      if (this.borderAnim > 24 * this.options.borderAnimDelay) {
        this.borderAnim = 0;
      }
    }

    // Set up line style
    if (drawDashedBorders) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = color;
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = drawTertiaryColors ? color3 : color;
    }

    ctx.beginPath();

    // Draw the border line based on direction using exact freeciv-web coordinates
    // @reference freeciv-web/javascript/2dcanvas/mapview.js:738-820
    switch (dir) {
      case Direction.DIR8_NORTH:
        // @reference freeciv-web line 741-742: exact coordinates
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x + this.tileWidth / 2, y + this.tileHeight / 2 - 2);
        break;

      case Direction.DIR8_EAST:
        // @reference freeciv-web line 761-762: exact coordinates
        ctx.moveTo(x - 3, y + this.tileHeight - 3);
        ctx.lineTo(x + this.tileWidth / 2 - 3, y + this.tileHeight / 2 - 3);
        break;

      case Direction.DIR8_SOUTH:
        // @reference freeciv-web line 781-782: CORRECTED coordinates
        ctx.moveTo(x - this.tileWidth / 2 + 3, y + this.tileHeight / 2 - 3);
        ctx.lineTo(x + 3, y + this.tileHeight - 3);
        break;

      case Direction.DIR8_WEST:
        // @reference freeciv-web line 801-802: CORRECTED coordinates
        ctx.moveTo(x - this.tileWidth / 2 + 3, y + this.tileHeight / 2 - 3);
        ctx.lineTo(x + 3, y - 3);
        break;
    }

    // Add a modest dark contrast edge so low-contrast nation colors remain
    // readable over both bright terrain and dark terrain.
    ctx.lineWidth = lineWidth + 2;
    ctx.strokeStyle = 'rgba(8, 15, 28, 0.72)';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.stroke();

    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = drawTertiaryColors ? color3 : color;
    ctx.stroke();

    // Draw secondary and tertiary colors following freeciv-web pattern
    if (!drawDashedBorders) {
      // Secondary color layer
      ctx.strokeStyle = color2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();

      // Redraw the same path for secondary color
      switch (dir) {
        case Direction.DIR8_NORTH:
          ctx.moveTo(x, y - 2);
          ctx.lineTo(x + this.tileWidth / 2, y + this.tileHeight / 2 - 2);
          break;
        case Direction.DIR8_EAST:
          ctx.moveTo(x - 3, y + this.tileHeight - 3);
          ctx.lineTo(x + this.tileWidth / 2 - 3, y + this.tileHeight / 2 - 3);
          break;
        case Direction.DIR8_SOUTH:
          ctx.moveTo(x - this.tileWidth / 2 + 3, y + this.tileHeight / 2 - 3);
          ctx.lineTo(x + 3, y + this.tileHeight - 3);
          break;
        case Direction.DIR8_WEST:
          ctx.moveTo(x - this.tileWidth / 2 + 3, y + this.tileHeight / 2 - 3);
          ctx.lineTo(x + 3, y - 3);
          break;
      }
      ctx.stroke();

      // Tertiary color layer if enabled
      if (drawTertiaryColors) {
        ctx.strokeStyle = color;
        ctx.setLineDash([6, 18]);
        ctx.beginPath();

        // Redraw the same path for tertiary color
        switch (dir) {
          case Direction.DIR8_NORTH:
            ctx.moveTo(x, y - 2);
            ctx.lineTo(x + this.tileWidth / 2, y + this.tileHeight / 2 - 2);
            break;
          case Direction.DIR8_EAST:
            ctx.moveTo(x - 3, y + this.tileHeight - 3);
            ctx.lineTo(x + this.tileWidth / 2 - 3, y + this.tileHeight / 2 - 3);
            break;
          case Direction.DIR8_SOUTH:
            ctx.moveTo(x - this.tileWidth / 2 + 3, y + this.tileHeight / 2 - 3);
            ctx.lineTo(x + 3, y + this.tileHeight - 3);
            break;
          case Direction.DIR8_WEST:
            ctx.moveTo(x - this.tileWidth / 2 + 3, y + this.tileHeight / 2 - 3);
            ctx.lineTo(x + 3, y - 3);
            break;
        }
        ctx.stroke();
      }
    }

    // Restore canvas state to avoid affecting subsequent renders
    ctx.restore();
  }

  /**
   * Fill territory with nation color - EXACT freeciv-web coordinates
   * @reference freeciv-web/javascript/2dcanvas/mapview.js:825-840 mapview_territory_fill
   */
  private drawTerritoryFill(color: string, canvasX: number, canvasY: number): void {
    const ctx = this.ctx;

    // Save canvas state
    ctx.save();
    // Use exact freeciv-web coordinates (canvas_x + 47, canvas_y + 25)
    const x = canvasX + 47;
    const y = canvasY + 25;

    ctx.beginPath();

    ctx.fillStyle = color + '20'; // Add transparency (not in original but useful)

    // EXACT freeciv-web diamond coordinates (lines 832-836)
    ctx.moveTo(x, y + this.tileHeight / 2);
    ctx.lineTo(x - this.tileWidth / 2, y);
    ctx.lineTo(x, y - this.tileHeight / 2);
    ctx.lineTo(x + this.tileWidth / 2, y);
    ctx.lineTo(x, y + this.tileHeight / 2); // explicit close line like freeciv-web

    ctx.closePath();
    ctx.fill();

    // Restore canvas state
    ctx.restore();
  }

  /**
   * Main render method for borders - follows freeciv-web mapview pattern
   * @reference freeciv-web/javascript/2dcanvas/mapview.js calling pattern
   */
  public render(state: RenderState): void {
    if (!this.options.drawBorders) {
      return;
    }

    const { viewport, map, players } = state;

    // Iterate through visible tiles following freeciv-web pattern
    for (const tileKey in (map as any).tiles) {
      const tile = (map as any).tiles[tileKey] as Tile;

      // Freeciv's put_one_tile skips every normal map layer for TILE_UNKNOWN.
      // Do not leak ownership through fog by drawing a border from a tile the
      // current player has never explored.
      if (!tile.known) {
        continue;
      }

      // Skip if not in viewport
      if (!this.isInViewport(tile.x, tile.y, viewport)) {
        continue;
      }

      // Calculate screen position
      const screenPos = this.mapToScreen(tile.x, tile.y, viewport);

      // Draw territory fill if enabled (matches freeciv-web mapview_territory_fill)
      if (this.options.drawTerritoryFill && tile.owner) {
        const colors = this.getPlayerColors(tile.owner, players);
        this.drawTerritoryFill(colors.primary, screenPos.x, screenPos.y);
      }

      // Get and draw border sprites - uses real player colors from game state
      const borderSprites = this.getBorderLineSprites(tile, map, players);
      for (const sprite of borderSprites) {
        this.drawBorderLine(
          sprite.dir,
          sprite.color,
          sprite.color2,
          sprite.color3,
          screenPos.x,
          screenPos.y
        );
      }
    }
  }

  /**
   * Update render options
   */
  public setOptions(options: Partial<BorderRenderOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Moving borders use the same redraw-driven dash phase as the reference
   * renderer. MapRenderer uses this to keep the animation loop alive only
   * when the option is enabled.
   */
  public hasActiveAnimation(reducedMotion = false): boolean {
    return this.options.drawMovingBorders && !reducedMotion;
  }

  /**
   * Update player colors from nation data
   */
  public updatePlayerColors(
    playerId: string,
    colors: { primary: string; secondary: string; tertiary: string }
  ): void {
    this.playerColors.set(playerId, colors);
  }
}
