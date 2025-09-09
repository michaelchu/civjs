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

  // Border caching system to prevent unnecessary redraws
  private lastOwnershipHash = '';
  private cachedBorderPaths = new Map<string, Path2D>();

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
   * Check if border cache needs updating by hashing ownership data
   */
  private generateOwnershipHash(tiles: Record<string, Tile>): string {
    const ownershipData: string[] = [];
    let tilesWithOwner = 0;
    for (const tileKey in tiles) {
      const tile = tiles[tileKey];
      if (tile.owner && tile.owner !== null) {
        ownershipData.push(`${tile.x},${tile.y}:${tile.owner}`);
        tilesWithOwner++;
      }
    }

    // Debug: Log ownership data periodically
    if (tilesWithOwner > 0) {
      console.log('[BorderRenderer] Found owned tiles in hash generation:', {
        tilesWithOwner,
        totalTiles: Object.keys(tiles).length,
        firstThreeOwned: ownershipData.slice(0, 3),
        hashLength: ownershipData.join('|').length,
      });
    }

    return ownershipData.join('|');
  }

  /**
   * Render borders for all visible tiles with caching to eliminate flicker
   * Based on reference/freeciv-web border rendering but optimized for smooth performance
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
      return; // No players data available - don't spam logs
    }

    // Check if we need to update the border cache
    const currentOwnershipHash = this.generateOwnershipHash(tiles);
    const ownershipChanged = currentOwnershipHash !== this.lastOwnershipHash;

    if (ownershipChanged) {
      console.log('[BorderRenderer] Ownership changed, updating border cache');
      this.updateBorderCache(tiles, renderState);
      this.lastOwnershipHash = currentOwnershipHash;
    } else if (this.cachedBorderPaths.size === 0 && currentOwnershipHash === '') {
      // No ownership data yet - don't render anything
      return;
    }

    // Render cached borders
    this.renderCachedBorders(opts);
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

  /**
   * Update the border cache when ownership changes
   */
  private updateBorderCache(tiles: Record<string, Tile>, renderState: RenderState): void {
    this.cachedBorderPaths.clear();

    // Create paths for each player's borders
    const playerBorders = new Map<string, Path2D>();
    let ownedTilesProcessed = 0;

    for (const tileKey in tiles) {
      const tile = tiles[tileKey];
      if (!tile.owner || !tile.visible) continue;

      ownedTilesProcessed++;

      // Get or create path for this player
      if (!playerBorders.has(tile.owner)) {
        playerBorders.set(tile.owner, new Path2D());
      }

      const path = playerBorders.get(tile.owner)!;

      // Add border segments for this tile
      this.addTileBordersToPath(tile, tiles, renderState, path);
    }

    // Store the completed paths
    this.cachedBorderPaths = playerBorders;

    console.log('[BorderRenderer] Border cache updated:', {
      ownedTilesProcessed,
      totalTiles: Object.keys(tiles).length,
      playersWithBorders: playerBorders.size,
      playerIds: Array.from(playerBorders.keys()),
    });
  }

  /**
   * Add border segments for a tile to a Path2D
   */
  private addTileBordersToPath(
    tile: Tile,
    allTiles: Record<string, Tile>,
    renderState: RenderState,
    path: Path2D
  ): void {
    const players = renderState.players;
    if (!tile.owner || !players[tile.owner]) return;

    // Calculate screen position once
    const screenPos = this.mapToScreen(tile.x, tile.y, renderState.viewport);

    // Check all four cardinal neighbors for border lines
    for (let i = 0; i < CARDINAL_TILESET_DIRS.length; i++) {
      const dir = CARDINAL_TILESET_DIRS[i];
      const neighborCoords = this.getNeighborCoords(tile.x, tile.y, dir);
      const neighborKey = `${neighborCoords.x},${neighborCoords.y}`;
      const neighborTile = allTiles[neighborKey];

      // Same border detection logic as before
      const shouldDrawBorder =
        neighborTile != null &&
        neighborTile.owner != null &&
        tile.owner != null &&
        tile.owner !== neighborTile.owner &&
        tile.owner !== UNOWNED_TILE.toString() &&
        players[tile.owner] != null;

      if (shouldDrawBorder) {
        const side = this.directionToSide(dir) as 'top' | 'right' | 'bottom' | 'left';
        this.addBorderSideToPath(path, screenPos, side, this.tileWidth, this.tileHeight);
      }
    }
  }

  /**
   * Add a border side to a Path2D instead of drawing directly
   */
  private addBorderSideToPath(
    path: Path2D,
    screenPos: { x: number; y: number },
    side: 'top' | 'right' | 'bottom' | 'left',
    tileWidth: number,
    tileHeight: number
  ): void {
    const centerX = screenPos.x + tileWidth / 2;
    const centerY = screenPos.y + tileHeight / 2;

    // Isometric border positioning (reference: freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js)
    switch (side) {
      case 'top': // North border
        path.moveTo(centerX - 1, screenPos.y + 3);
        path.lineTo(centerX + 1, screenPos.y + 3);
        break;
      case 'right': // East border
        path.moveTo(screenPos.x + tileWidth - 3, centerY - 1);
        path.lineTo(screenPos.x + tileWidth - 3, centerY + 1);
        break;
      case 'bottom': // South border
        path.moveTo(centerX - 1, screenPos.y + tileHeight - 3);
        path.lineTo(centerX + 1, screenPos.y + tileHeight - 3);
        break;
      case 'left': // West border
        path.moveTo(screenPos.x + 3, centerY - 1);
        path.lineTo(screenPos.x + 3, centerY + 1);
        break;
    }
  }

  /**
   * Render the cached border paths
   */
  private renderCachedBorders(options: BorderRenderOptions): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.lineWidth = options.borderWidth;
    ctx.globalAlpha = options.borderAlpha;

    if (options.borderStyle === 'dashed') {
      ctx.setLineDash([5, 3]);
    } else {
      ctx.setLineDash([]);
    }

    let bordersDrawn = 0;

    // Draw borders for each player using cached paths
    for (const [playerId, path] of this.cachedBorderPaths.entries()) {
      const playerColor = this.playerColors.get(playerId) || DEFAULT_BORDER_COLOR;
      ctx.strokeStyle = playerColor;
      ctx.stroke(path);
      bordersDrawn++;
    }

    // Only log when there are actual borders to show
    if (bordersDrawn > 0) {
      console.log('[BorderRenderer] Cached border rendering complete:', {
        playersWithBorders: bordersDrawn,
        totalPaths: this.cachedBorderPaths.size,
      });
    }

    // Reset alpha
    ctx.globalAlpha = 1.0;
  }
}
