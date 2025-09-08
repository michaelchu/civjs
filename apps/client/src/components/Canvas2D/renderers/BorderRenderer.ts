/**
 * BorderRenderer - Renders national borders on the map
 * Ported from reference/freeciv-web border rendering functionality
 */

import { BaseRenderer, type RenderState } from './BaseRenderer';
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
    players: Record<string, Player>,
    renderState: RenderState,
    options: Partial<BorderRenderOptions> = {}
  ): void {
    const opts = { ...this.defaultOptions, ...options };

    // Debug logging
    console.log('[BorderRenderer] render called with:', {
      tileCount: Object.keys(tiles).length,
      playerCount: Object.keys(players).length,
      showBorders: opts.showBorders,
      hasContext: !!this.ctx,
    });

    if (!opts.showBorders) {
      console.log('[BorderRenderer] showBorders is false, skipping render');
      return;
    }

    const ctx = this.ctx;
    if (!ctx) {
      console.log('[BorderRenderer] no canvas context, skipping render');
      return;
    }

    // Update player colors if players changed
    if (this.playerColors.size === 0 || Object.keys(players).length !== this.playerColors.size) {
      this.setPlayerColors(players);
      console.log(
        '[BorderRenderer] updated player colors:',
        Array.from(this.playerColors.entries())
      );
    }

    // Count tiles with owners for debugging
    const tilesWithOwners = Object.values(tiles).filter(tile => tile.owner);
    const visibleTilesWithOwners = tilesWithOwners.filter(tile => tile.visible);
    console.log('[BorderRenderer] tiles analysis:', {
      totalTiles: Object.keys(tiles).length,
      tilesWithOwners: tilesWithOwners.length,
      visibleTilesWithOwners: visibleTilesWithOwners.length,
      sampleTileWithOwner:
        tilesWithOwners.length > 0
          ? {
              x: tilesWithOwners[0].x,
              y: tilesWithOwners[0].y,
              owner: tilesWithOwners[0].owner,
              visible: tilesWithOwners[0].visible,
            }
          : null,
    });

    let bordersDrawn = 0;

    // Render borders between tiles with different owners
    for (const tileKey in tiles) {
      const tile = tiles[tileKey];
      if (!tile.visible || !tile.owner) continue;

      const screenPos = this.mapToScreen(tile.x, tile.y, renderState.viewport);
      if (!this.isInViewport(tile.x, tile.y, renderState.viewport)) continue;

      this.renderTileBorders(tile, tiles, screenPos, renderState, opts);
      bordersDrawn++;
    }

    console.log('[BorderRenderer] render completed:', {
      bordersDrawn,
      playerColorsCount: this.playerColors.size,
    });
  }

  /**
   * Render border lines for a specific tile
   * Based on freeciv-web's border drawing approach
   */
  private renderTileBorders(
    tile: Tile,
    allTiles: Record<string, Tile>,
    screenPos: { x: number; y: number },
    _renderState: RenderState,
    options: BorderRenderOptions
  ): void {
    const ctx = this.ctx;
    if (!ctx || !tile.owner) return;

    const tileWidth = this.tileWidth;
    const tileHeight = this.tileHeight;
    const playerColor = this.playerColors.get(tile.owner) || '#FFFFFF';

    // Set border style - make borders more visible
    // Use a bright test color for debugging - remove this when borders are working
    ctx.strokeStyle = '#FF0000'; // Bright red for testing
    // ctx.strokeStyle = playerColor;
    ctx.lineWidth = 4; // Extra thick for testing
    ctx.globalAlpha = 1.0; // Fully opaque for testing

    if (options.borderStyle === 'dashed') {
      ctx.setLineDash([5, 3]);
    } else {
      ctx.setLineDash([]);
    }

    // Check all four neighboring tiles for border lines
    const neighbors = [
      { x: tile.x, y: tile.y - 1, side: 'north' }, // North
      { x: tile.x + 1, y: tile.y, side: 'east' }, // East
      { x: tile.x, y: tile.y + 1, side: 'south' }, // South
      { x: tile.x - 1, y: tile.y, side: 'west' }, // West
    ];

    let sidesDrawn = 0;
    const debugInfo: Array<{
      side: string;
      neighborExists: boolean;
      neighborOwner?: string;
      neighborVisible?: boolean;
      shouldDrawBorder: boolean;
    }> = [];

    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.x},${neighbor.y}`;
      const neighborTile = allTiles[neighborKey];

      // Draw border only if neighbor has different owner (matching freeciv-web logic)
      // Don't draw on map edges or visibility boundaries for now
      const shouldDrawBorder =
        neighborTile && neighborTile.owner && neighborTile.owner !== tile.owner;

      debugInfo.push({
        side: neighbor.side,
        neighborExists: !!neighborTile,
        neighborOwner: neighborTile?.owner,
        neighborVisible: neighborTile?.visible ?? false,
        shouldDrawBorder: !!shouldDrawBorder,
      });

      if (shouldDrawBorder) {
        this.drawBorderSide(ctx, screenPos, neighbor.side, tileWidth, tileHeight);
        sidesDrawn++;
      }
    }

    if (sidesDrawn > 0) {
      console.log(`[BorderRenderer] drew borders for tile (${tile.x},${tile.y}):`, {
        owner: tile.owner,
        playerColor,
        sidesDrawn,
        screenPos,
        tileSize: { width: tileWidth, height: tileHeight },
        debugInfo,
      });
    }

    ctx.globalAlpha = 1.0;
    ctx.setLineDash([]);
  }

  /**
   * Draw a border line on one side of a tile
   * Based on freeciv-web's mapview_put_border_line function
   */
  private drawBorderSide(
    ctx: CanvasRenderingContext2D,
    screenPos: { x: number; y: number },
    side: string,
    tileWidth: number,
    tileHeight: number
  ): void {
    // Reference coordinates based on freeciv-web (adjusted for our tile size)
    const x = screenPos.x + tileWidth * 0.5; // Roughly equivalent to canvas_x + 47
    const y = screenPos.y + tileHeight * 0.1; // Roughly equivalent to canvas_y + 3

    ctx.beginPath();

    // Simplified line drawing based on freeciv-web reference
    switch (side) {
      case 'north':
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x + tileWidth / 2, y + tileHeight / 2 - 2);
        break;

      case 'east':
        ctx.moveTo(x - 3, y + tileHeight - 3);
        ctx.lineTo(x + tileWidth / 2 - 3, y + tileHeight / 2 - 3);
        break;

      case 'south':
        ctx.moveTo(x - tileWidth / 2 + 3, y + tileHeight / 2 - 3);
        ctx.lineTo(x + 3, y + tileHeight - 3);
        break;

      case 'west':
        ctx.moveTo(x - tileWidth / 2 + 3, y + tileHeight / 2 - 3);
        ctx.lineTo(x + 3, y - 3);
        break;
    }

    ctx.stroke();
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
