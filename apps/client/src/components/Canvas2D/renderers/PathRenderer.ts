/**
 * @module client/components/Canvas2D/renderers/PathRenderer
 * Implements the Path Renderer canvas rendering stage.
 */
import type { GotoPath } from '../../../services/PathfindingService';
import type { MapViewport, Tile } from '../../../types';
import { BaseRenderer, type RenderState } from './BaseRenderer';
import { createMapGeometry, nativeAxisGuiPeriod } from '../mapTopologyGeometry';

export interface PathRenderEntry {
  state: RenderState;
  tile: Tile;
}

export class PathRenderer extends BaseRenderer {
  // Debug text rendering constants
  private static readonly DEBUG_FONT_SIZE = 10; // Font size for debug overlays
  private mapWidth = 0;
  private mapHeight = 0;
  private topologyId = 0;
  private wrapId = 0;

  override setMapGeometry(map: RenderState['map']): void {
    super.setMapGeometry(map);
    this.mapWidth = map.xsize ?? map.width;
    this.mapHeight = map.ysize ?? map.height;
    this.topologyId = map.topology_id ?? 0;
    this.wrapId = map.wrap_id ?? 0;
  }

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
   * Paint the GOTO layer in the same globally ordered tile walk as the rest
   * of the map. This keeps wrapped copies at their translated positions and
   * lets callers append nuclear sprites before advancing to the next tile.
   */
  renderPathLayerEntries(
    entries: readonly PathRenderEntry[],
    afterTile?: (state: RenderState, tile: Tile) => void
  ): void {
    const first = entries[0];
    if (!first) return;
    const gotoPath = first.state.gotoPath;
    const segmentsByOrigin = new Map<
      string,
      Array<{ from: GotoPath['tiles'][number]; to: GotoPath['tiles'][number] }>
    >();
    if (gotoPath?.tiles && gotoPath.tiles.length > 1) {
      for (let index = 0; index < gotoPath.tiles.length - 1; index += 1) {
        const from = gotoPath.tiles[index];
        const to = gotoPath.tiles[index + 1];
        const key = `${from.x},${from.y}`;
        const segments = segmentsByOrigin.get(key) ?? [];
        segments.push({ from, to });
        segmentsByOrigin.set(key, segments);
      }
      this.setGotoLineStyle();
    }

    for (const { state, tile } of entries) {
      for (const segment of segmentsByOrigin.get(`${tile.x},${tile.y}`) ?? []) {
        this.renderGotoSegment(segment.from, segment.to, state.viewport);
      }
      afterTile?.(state, tile);
    }
  }

  /**
   * Render goto path using freeciv-web's individual directional segments from each tile.
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:849-888
   */
  private renderGotoPath(gotoPath: GotoPath, viewport: MapViewport): void {
    if (!gotoPath.tiles || gotoPath.tiles.length < 2) return;

    this.setGotoLineStyle();

    // Draw individual directional segments connecting each tile to the next
    for (let i = 0; i < gotoPath.tiles.length - 1; i++) {
      const fromTile = gotoPath.tiles[i];
      const toTile = gotoPath.tiles[i + 1];

      // Skip segments not in viewport
      if (!this.isInViewport(fromTile.x, fromTile.y, viewport)) {
        continue;
      }

      this.renderGotoSegment(fromTile, toTile, viewport);
    }
  }

  private setGotoLineStyle(): void {
    this.ctx.strokeStyle = 'rgba(0,168,255,0.9)';
    this.ctx.lineWidth = 10;
    this.ctx.lineCap = 'round';
  }

  private renderGotoSegment(
    fromTile: Pick<GotoPath['tiles'][number], 'x' | 'y'>,
    toTile: Pick<GotoPath['tiles'][number], 'x' | 'y'>,
    viewport: MapViewport
  ): void {
    const fromPos = this.mapToScreen(fromTile.x, fromTile.y, viewport);
    const toPos = this.getNearestWrappedScreenPosition(
      fromPos,
      this.mapToScreen(toTile.x, toTile.y, viewport)
    );
    this.renderGotoLineSegment(fromPos.x, fromPos.y, toPos.x, toPos.y);
  }

  private getNearestWrappedScreenPosition(
    from: { x: number; y: number },
    target: { x: number; y: number }
  ): { x: number; y: number } {
    if (!this.wrapId || !this.mapWidth || !this.mapHeight) return target;

    const geometry = createMapGeometry(this.mapWidth, this.mapHeight, this.topologyId);
    const xPeriod = nativeAxisGuiPeriod('x', geometry, this.tileWidth, this.tileHeight);
    const yPeriod = nativeAxisGuiPeriod('y', geometry, this.tileWidth, this.tileHeight);
    const xOffsets = (this.wrapId & 1) !== 0 ? [-1, 0, 1] : [0];
    const yOffsets = (this.wrapId & 2) !== 0 ? [-1, 0, 1] : [0];
    let nearest = target;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const xOffset of xOffsets) {
      for (const yOffset of yOffsets) {
        const candidate = {
          x: target.x + xOffset * xPeriod.x + yOffset * yPeriod.x,
          y: target.y + xOffset * xPeriod.y + yOffset * yPeriod.y,
        };
        const distance = (candidate.x - from.x) ** 2 + (candidate.y - from.y) ** 2;
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      }
    }

    return nearest;
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
