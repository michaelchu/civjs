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

    // DEBUG: Temporarily force test borders for debugging
    // Create fake ownership data to test border rendering
    const visibleTiles = Object.values(tiles)
      .filter(tile => tile.visible)
      .slice(0, 20);
    if (visibleTiles.length > 3) {
      // Force ownership on some tiles for testing
      for (let i = 0; i < Math.min(5, visibleTiles.length); i++) {
        const tile = visibleTiles[i];
        const ownedTile = { ...tile, owner: i < 3 ? 'player1' : 'player2' };
        tiles[`${tile.x},${tile.y}`] = ownedTile;
      }
      console.log('[BorderRenderer] DEBUG: Added fake ownership to first 5 visible tiles');
    }

    // Render actual borders between tiles with different owners
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
    // DEBUG: Draw a very obvious border that we can't miss
    // Just draw a simple rectangle around the tile for now
    const x = screenPos.x;
    const y = screenPos.y;

    ctx.beginPath();
    ctx.strokeStyle = '#FF0000'; // Bright red
    ctx.lineWidth = 8; // Very thick
    ctx.globalAlpha = 1.0; // Fully opaque

    // Draw a simple rectangle around the tile
    switch (side) {
      case 'north':
        ctx.moveTo(x, y);
        ctx.lineTo(x + tileWidth, y);
        break;

      case 'east':
        ctx.moveTo(x + tileWidth, y);
        ctx.lineTo(x + tileWidth, y + tileHeight);
        break;

      case 'south':
        ctx.moveTo(x + tileWidth, y + tileHeight);
        ctx.lineTo(x, y + tileHeight);
        break;

      case 'west':
        ctx.moveTo(x, y + tileHeight);
        ctx.lineTo(x, y);
        break;
    }

    ctx.stroke();
    console.log(
      `[BorderRenderer] Drew ${side} border at (${x},${y}) with size ${tileWidth}x${tileHeight}`
    );
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
