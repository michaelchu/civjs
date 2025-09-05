import type { GotoPath } from '../../../services/PathfindingService';
import type { MapViewport } from '../../../types';
import { BaseRenderer, type RenderState } from './BaseRenderer';

export class PathRenderer extends BaseRenderer {
  // Debug text rendering constants
  private static readonly DEBUG_FONT_SIZE = 10; // Font size for debug overlays

  /**
   * Render goto path and debug overlays.
   */
  renderPaths(state: RenderState): void {
    // Render goto path if available (similar to freeciv-web's path rendering)
    if (state.gotoPath && state.gotoPath.tiles.length > 1) {
      if (import.meta.env.DEV) {
        console.log('Rendering goto path:', state.gotoPath);
      }
      this.renderGotoPath(state.gotoPath, state.viewport);
    } else if (import.meta.env.DEV && state.gotoPath) {
      console.log('Goto path available but not rendered:', state.gotoPath);
    }

    if (import.meta.env.DEV) {
      // Uncomment to see the diamond grid overlay
      // this.debugRenderGrid(state.viewport, true);
    }
  }

  /**
   * Render goto path exactly like freeciv-web: individual directional segments from each tile
   * Each tile draws one line segment in the direction of the next tile
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:382-397
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:3276 - ptile['goto_dir'] = dir
   */
  private renderGotoPath(gotoPath: GotoPath, viewport: MapViewport): void {
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
  private renderGotoLineSegment(fromX: number, fromY: number, toX: number, toY: number): void {
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
  private renderTurnIndicators(gotoPath: GotoPath, viewport: MapViewport): void {
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

  // Debug method to render diamond grid overlay
  debugRenderGrid(viewport: MapViewport, showTileNumbers = false): void {
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    this.ctx.lineWidth = 1;
    this.ctx.font = `${PathRenderer.DEBUG_FONT_SIZE}px Arial`;
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
}
