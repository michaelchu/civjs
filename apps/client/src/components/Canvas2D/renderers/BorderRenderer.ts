/**
 * BorderRenderer - Renders national borders on the map
 * Ported from reference/freeciv-web border rendering functionality
 */

import { BaseRenderer, type RenderState } from './BaseRenderer';
import type { Tile, Player } from '../../../types';
import {
  UNOWNED_TILE,
  CARDINAL_TILESET_DIRS,
  DIR8_NORTH,
  DIR8_EAST,
  DIR8_SOUTH,
  DIR8_WEST,
  BORDER_LINE_WIDTH,
  BORDER_ALPHA,
  DEFAULT_BORDER_COLOR,
} from '../../../constants/freeciv';

export interface BorderRenderOptions {
  showBorders: boolean;
  borderWidth: number;
  borderAlpha: number;
  borderStyle: 'solid' | 'dashed';
}

export class BorderRenderer extends BaseRenderer {
  private defaultOptions: BorderRenderOptions = {
    showBorders: true,
    borderWidth: BORDER_LINE_WIDTH,
    borderAlpha: BORDER_ALPHA,
    borderStyle: 'solid',
  };

  private playerColors = new Map<string, string>();

  /**
   * Initialize player colors for border rendering
   */
  setPlayerColors(players: Record<string, Player>): void {
    this.playerColors.clear();
    for (const player of Object.values(players)) {
      this.playerColors.set(player.id, player.color);
    }
  }

  /**
   * Render borders for all visible tiles
   * Ported from reference/freeciv-web border drawing logic
   */
  render(
    tiles: Record<string, Tile>,
    renderState: RenderState,
    options: Partial<BorderRenderOptions> = {}
  ): void {
    const opts = { ...this.defaultOptions, ...options };

    if (!opts.showBorders || !this.ctx) {
      return;
    }

    const players = renderState.players;
    if (!players || Object.keys(players).length === 0) {
      return; // No players data available
    }

    // Update player colors if players changed
    if (this.playerColors.size === 0 || Object.keys(players).length !== this.playerColors.size) {
      this.setPlayerColors(players);
    }

    // Render borders between tiles with different owners
    for (const tileKey in tiles) {
      const tile = tiles[tileKey];
      if (!tile.visible || !tile.owner) continue;

      const screenPos = this.mapToScreen(tile.x, tile.y, renderState.viewport);
      if (!this.isInViewport(tile.x, tile.y, renderState.viewport)) continue;

      this.renderTileBorders(tile, tiles, screenPos, renderState, opts);
    }
  }

  /**
   * Render border lines for a specific tile
   * Based on freeciv-web's border drawing approach
   */
  private renderTileBorders(
    tile: Tile,
    allTiles: Record<string, Tile>,
    screenPos: { x: number; y: number },
    renderState: RenderState,
    options: BorderRenderOptions
  ): void {
    const ctx = this.ctx;
    if (!ctx || !tile.owner) return;

    const players = renderState.players;

    const tileWidth = this.tileWidth;
    const tileHeight = this.tileHeight;

    // Get player color for this tile owner
    const playerColor = this.playerColors.get(tile.owner) || DEFAULT_BORDER_COLOR;

    // Set border style using nation colors
    ctx.strokeStyle = playerColor;
    ctx.lineWidth = options.borderWidth;
    ctx.globalAlpha = options.borderAlpha;

    if (options.borderStyle === 'dashed') {
      ctx.setLineDash([5, 3]);
    } else {
      ctx.setLineDash([]);
    }

    // Check all four cardinal neighbors for border lines - exactly like freeciv-web
    for (let i = 0; i < CARDINAL_TILESET_DIRS.length; i++) {
      const dir = CARDINAL_TILESET_DIRS[i];
      const neighborCoords = this.getNeighborCoords(tile.x, tile.y, dir);
      const neighborKey = `${neighborCoords.x},${neighborCoords.y}`;
      const neighborTile = allTiles[neighborKey];

      // Reference-compliant border detection logic from freeciv-web tilespec.js:877-881
      const shouldDrawBorder =
        neighborTile != null &&
        neighborTile.owner != null &&
        tile.owner != null &&
        tile.owner !== neighborTile.owner &&
        tile.owner !== UNOWNED_TILE.toString() && // Convert to string since our owner field is string
        players[tile.owner] != null;

      if (shouldDrawBorder) {
        const side = this.directionToSide(dir);
        this.drawBorderSide(ctx, screenPos, side, tileWidth, tileHeight);
      }
    }

    ctx.globalAlpha = 1.0;
    ctx.setLineDash([]);
  }

  /**
   * Draw a border line on one side of a tile
   * Based on freeciv-web's mapview_put_border_line function
   * Reference: freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:355-377
   */
  private drawBorderSide(
    ctx: CanvasRenderingContext2D,
    screenPos: { x: number; y: number },
    side: string,
    tileWidth: number,
    tileHeight: number
  ): void {
    // Match freeciv-web's coordinate system: canvas_x + 47, canvas_y + 3
    // These offsets center the border lines within the isometric tile shape
    const x = screenPos.x + tileWidth * 0.49; // 47/96 ≈ 0.49 for 96px tiles
    const y = screenPos.y + 3;

    ctx.beginPath();

    // Draw isometric border lines matching freeciv-web exactly
    // Reference coordinates from freeciv-web mapview_put_border_line
    switch (side) {
      case 'north':
        // North edge: diagonal line from center-left to center-right of top edge
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x + tileWidth / 2, y + tileHeight / 2 - 2);
        break;

      case 'east':
        // East edge: diagonal line from center-top to center-bottom of right edge
        ctx.moveTo(x - 3, y + tileHeight - 3);
        ctx.lineTo(x + tileWidth / 2 - 3, y + tileHeight / 2 - 3);
        break;

      case 'south':
        // South edge: diagonal line from center-left to center-right of bottom edge
        ctx.moveTo(x - tileWidth / 2 + 3, y + tileHeight / 2 - 3);
        ctx.lineTo(x + 3, y + tileHeight - 3);
        break;

      case 'west':
        // West edge: diagonal line from center-top to center-bottom of left edge
        ctx.moveTo(x - tileWidth / 2 + 3, y + tileHeight / 2 - 3);
        ctx.lineTo(x + 3, y - 3);
        break;
    }

    ctx.stroke();
  }

  /**
   * Get neighbor coordinates based on direction (freeciv-web mapstep equivalent)
   */
  private getNeighborCoords(x: number, y: number, dir: number): { x: number; y: number } {
    switch (dir) {
      case DIR8_NORTH:
        return { x, y: y - 1 };
      case DIR8_EAST:
        return { x: x + 1, y };
      case DIR8_SOUTH:
        return { x, y: y + 1 };
      case DIR8_WEST:
        return { x: x - 1, y };
      default:
        return { x, y }; // Unknown direction, return same position
    }
  }

  /**
   * Convert DIR8 direction to side string for drawing
   */
  private directionToSide(dir: number): string {
    switch (dir) {
      case DIR8_NORTH:
        return 'north';
      case DIR8_EAST:
        return 'east';
      case DIR8_SOUTH:
        return 'south';
      case DIR8_WEST:
        return 'west';
      default:
        return 'north'; // Default fallback
    }
  }

  /**
   * Render national territory highlights (optional overlay)
   */
  renderTerritoryOverlay(
    tiles: Record<string, Tile>,
    _players: Record<string, Player>,
    renderState: RenderState,
    selectedPlayer?: string,
    alpha: number = 0.2
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;

    for (const tileKey in tiles) {
      const tile = tiles[tileKey];
      if (!tile.visible || !tile.owner) continue;

      // Only highlight selected player's territory if specified
      if (selectedPlayer && tile.owner !== selectedPlayer) continue;

      const screenPos = this.mapToScreen(tile.x, tile.y, renderState.viewport);
      if (!this.isInViewport(tile.x, tile.y, renderState.viewport)) continue;

      const playerColor = this.playerColors.get(tile.owner) || '#FFFFFF';
      this.fillTileDiamond(ctx, screenPos, renderState, playerColor, alpha);
    }
  }

  /**
   * Fill a tile with player color (for territory overlay)
   */
  private fillTileDiamond(
    ctx: CanvasRenderingContext2D,
    screenPos: { x: number; y: number },
    _renderState: RenderState,
    color: string,
    alpha: number
  ): void {
    const centerX = screenPos.x + this.tileWidth / 2;
    const centerY = screenPos.y + this.tileHeight / 2;
    const halfWidth = this.tileWidth / 2;
    const halfHeight = this.tileHeight / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY - halfHeight); // Top
    ctx.lineTo(centerX + halfWidth, centerY); // Right
    ctx.lineTo(centerX, centerY + halfHeight); // Bottom
    ctx.lineTo(centerX - halfWidth, centerY); // Left
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /**
   * Get border configuration from game options
   * Integrates with client-side options system
   */
  static getBorderOptionsFromSettings(settings: Record<string, unknown>): BorderRenderOptions {
    return {
      showBorders: (settings?.drawBorders as boolean) ?? true,
      borderWidth: (settings?.borderWidth as number) ?? 2,
      borderAlpha: (settings?.borderAlpha as number) ?? 0.8,
      borderStyle: (settings?.borderStyle as 'solid' | 'dashed') ?? 'solid',
    };
  }

  /**
   * Check if a screen position might contain border information
   * Useful for border hover effects or selection
   */
  getBorderInfoAt(
    screenX: number,
    screenY: number,
    tiles: Record<string, Tile>,
    players: Record<string, Player>
  ): { tile?: Tile; owner?: Player; isBorder: boolean } {
    // TODO: Implement proper screen to tile conversion
    const tilePos = { x: screenX / this.tileWidth, y: screenY / this.tileHeight };
    const tileKey = `${Math.floor(tilePos.x)},${Math.floor(tilePos.y)}`;
    const tile = tiles[tileKey];

    if (!tile || !tile.owner) {
      return { isBorder: false };
    }

    const owner = players[tile.owner];

    // Check if this position is near a border by examining neighbors
    const neighbors = [
      tiles[`${tile.x},${tile.y - 1}`],
      tiles[`${tile.x + 1},${tile.y}`],
      tiles[`${tile.x},${tile.y + 1}`],
      tiles[`${tile.x - 1},${tile.y}`],
    ];

    const isBorder = neighbors.some(neighbor => !neighbor || neighbor.owner !== tile.owner);

    return {
      tile,
      owner,
      isBorder,
    };
  }
}
