/**
 * BorderRenderer - Renders national borders on the map
 * Ported from reference/freeciv-web border rendering functionality
 */

import { BaseRenderer, RenderState } from './BaseRenderer';
import type { Tile, Player } from '../../../types';

export interface BorderRenderOptions {
  showBorders: boolean;
  borderWidth: number;
  borderAlpha: number;
  borderStyle: 'solid' | 'dashed';
}

export class BorderRenderer extends BaseRenderer {
  private defaultOptions: BorderRenderOptions = {
    showBorders: true,
    borderWidth: 2,
    borderAlpha: 0.8,
    borderStyle: 'solid'
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
    players: Record<string, Player>,
    renderState: RenderState,
    options: Partial<BorderRenderOptions> = {}
  ): void {
    const opts = { ...this.defaultOptions, ...options };
    
    if (!opts.showBorders) {
      return;
    }

    const ctx = renderState.ctx;
    if (!ctx) return;

    // Update player colors if players changed
    if (this.playerColors.size === 0 || Object.keys(players).length !== this.playerColors.size) {
      this.setPlayerColors(players);
    }

    // Render borders between tiles with different owners
    for (const tileKey in tiles) {
      const tile = tiles[tileKey];
      if (!tile.visible || !tile.owner) continue;

      const screenPos = this.tileToScreen(tile.x, tile.y, renderState);
      if (!this.isInViewport(screenPos, renderState)) continue;

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
    const ctx = renderState.ctx;
    if (!ctx || !tile.owner) return;

    const tileWidth = renderState.tileWidth;
    const tileHeight = renderState.tileHeight;
    const playerColor = this.playerColors.get(tile.owner) || '#FFFFFF';

    // Set border style
    ctx.strokeStyle = playerColor;
    ctx.lineWidth = options.borderWidth;
    ctx.globalAlpha = options.borderAlpha;
    
    if (options.borderStyle === 'dashed') {
      ctx.setLineDash([5, 3]);
    } else {
      ctx.setLineDash([]);
    }

    // Check all four neighboring tiles for border lines
    const neighbors = [
      { x: tile.x, y: tile.y - 1, side: 'north' },  // North
      { x: tile.x + 1, y: tile.y, side: 'east' },   // East
      { x: tile.x, y: tile.y + 1, side: 'south' },  // South
      { x: tile.x - 1, y: tile.y, side: 'west' }    // West
    ];

    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.x},${neighbor.y}`;
      const neighborTile = allTiles[neighborKey];
      
      // Draw border if neighbor is different owner or no neighbor exists (map edge)
      const shouldDrawBorder = !neighborTile || 
                              neighborTile.owner !== tile.owner ||
                              !neighborTile.visible;

      if (shouldDrawBorder) {
        this.drawBorderSide(ctx, screenPos, neighbor.side, tileWidth, tileHeight);
      }
    }

    ctx.globalAlpha = 1.0;
    ctx.setLineDash([]);
  }

  /**
   * Draw a border line on one side of a tile
   * Based on isometric tile geometry from freeciv-web
   */
  private drawBorderSide(
    ctx: CanvasRenderingContext2D,
    screenPos: { x: number; y: number },
    side: string,
    tileWidth: number,
    tileHeight: number
  ): void {
    const centerX = screenPos.x + tileWidth / 2;
    const centerY = screenPos.y + tileHeight / 2;
    const halfWidth = tileWidth / 2;
    const halfHeight = tileHeight / 2;

    ctx.beginPath();

    switch (side) {
      case 'north':
        // Top edge of diamond
        ctx.moveTo(centerX - halfWidth, centerY);
        ctx.lineTo(centerX, centerY - halfHeight);
        ctx.lineTo(centerX + halfWidth, centerY);
        break;

      case 'east':
        // Right edge of diamond
        ctx.moveTo(centerX + halfWidth, centerY);
        ctx.lineTo(centerX, centerY + halfHeight);
        break;

      case 'south':
        // Bottom edge of diamond
        ctx.moveTo(centerX + halfWidth, centerY);
        ctx.lineTo(centerX, centerY + halfHeight);
        ctx.lineTo(centerX - halfWidth, centerY);
        break;

      case 'west':
        // Left edge of diamond
        ctx.moveTo(centerX - halfWidth, centerY);
        ctx.lineTo(centerX, centerY - halfHeight);
        break;
    }

    ctx.stroke();
  }

  /**
   * Render national territory highlights (optional overlay)
   */
  renderTerritoryOverlay(
    tiles: Record<string, Tile>,
    players: Record<string, Player>,
    renderState: RenderState,
    selectedPlayer?: string,
    alpha: number = 0.2
  ): void {
    const ctx = renderState.ctx;
    if (!ctx) return;

    for (const tileKey in tiles) {
      const tile = tiles[tileKey];
      if (!tile.visible || !tile.owner) continue;

      // Only highlight selected player's territory if specified
      if (selectedPlayer && tile.owner !== selectedPlayer) continue;

      const screenPos = this.tileToScreen(tile.x, tile.y, renderState);
      if (!this.isInViewport(screenPos, renderState)) continue;

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
    renderState: RenderState,
    color: string,
    alpha: number
  ): void {
    const centerX = screenPos.x + renderState.tileWidth / 2;
    const centerY = screenPos.y + renderState.tileHeight / 2;
    const halfWidth = renderState.tileWidth / 2;
    const halfHeight = renderState.tileHeight / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY - halfHeight); // Top
    ctx.lineTo(centerX + halfWidth, centerY);  // Right
    ctx.lineTo(centerX, centerY + halfHeight); // Bottom
    ctx.lineTo(centerX - halfWidth, centerY);  // Left
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /**
   * Get border configuration from game options
   * Integrates with client-side options system
   */
  static getBorderOptionsFromSettings(settings: any): BorderRenderOptions {
    return {
      showBorders: settings?.drawBorders ?? true,
      borderWidth: settings?.borderWidth ?? 2,
      borderAlpha: settings?.borderAlpha ?? 0.8,
      borderStyle: settings?.borderStyle ?? 'solid'
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
    players: Record<string, Player>,
    renderState: RenderState
  ): { tile?: Tile; owner?: Player; isBorder: boolean } {
    const tilePos = this.screenToTile(screenX, screenY, renderState);
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
      tiles[`${tile.x - 1},${tile.y}`]
    ];

    const isBorder = neighbors.some(neighbor => 
      !neighbor || neighbor.owner !== tile.owner
    );

    return {
      tile,
      owner,
      isBorder
    };
  }
}