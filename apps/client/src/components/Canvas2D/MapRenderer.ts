/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MapViewport, Tile } from '../../types';
import { TilesetLoader } from './TilesetLoader';
import { TerrainRenderer } from './renderers/TerrainRenderer';
import { UnitRenderer } from './renderers/UnitRenderer';
import { CityRenderer } from './renderers/CityRenderer';
import { PathRenderer } from './renderers/PathRenderer';
import type { RenderState } from './renderers/BaseRenderer';

declare global {
  interface Window {
    spritesLogged?: boolean;
  }
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private tileWidth = 96;
  private tileHeight = 48;

  // Tileset loader for sprite management
  private tilesetLoader: TilesetLoader;
  private isInitialized = false;

  // Specialized renderers
  private terrainRenderer: TerrainRenderer;
  private unitRenderer: UnitRenderer;
  private cityRenderer: CityRenderer;
  private pathRenderer: PathRenderer;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.tilesetLoader = new TilesetLoader();
    this.setupCanvas();

    // Initialize specialized renderers
    this.terrainRenderer = new TerrainRenderer(
      ctx,
      this.tilesetLoader,
      this.tileWidth,
      this.tileHeight
    );
    this.unitRenderer = new UnitRenderer(ctx, this.tilesetLoader, this.tileWidth, this.tileHeight);
    this.cityRenderer = new CityRenderer(ctx, this.tilesetLoader, this.tileWidth, this.tileHeight);
    this.pathRenderer = new PathRenderer(ctx, this.tilesetLoader, this.tileWidth, this.tileHeight);
  }

  async initialize(): Promise<void> {
    try {
      await this.tilesetLoader.loadTileset();

      const tileSize = this.tilesetLoader.getTileSize();
      this.tileWidth = tileSize.width;
      this.tileHeight = tileSize.height;

      // Update tile size in all specialized renderers
      this.terrainRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.unitRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.cityRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.pathRenderer.updateTileSize(this.tileWidth, this.tileHeight);

      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize MapRenderer:', error);
      throw error;
    }
  }

  private setupCanvas() {
    // Disable image smoothing for pixel-perfect sprite rendering
    this.ctx.imageSmoothingEnabled = false;
    // Also disable webkitImageSmoothingEnabled for older browsers
    (this.ctx as any).webkitImageSmoothingEnabled = false;
    (this.ctx as any).mozImageSmoothingEnabled = false;
    (this.ctx as any).msImageSmoothingEnabled = false;

    this.ctx.font = '14px Arial, sans-serif';
  }

  async render(state: RenderState) {
    // Invalidate terrain cache if tiles data has changed
    this.terrainRenderer.invalidateTileCache();

    if (!this.isInitialized) {
      this.clearCanvas();
      this.renderLoadingMessage();
      return;
    }

    // Check for freeciv-web global tiles array instead of state.map.tiles
    const globalTiles = (window as any).tiles;
    const globalMap = (window as any).map;

    if (!globalTiles || !globalMap || !Array.isArray(globalTiles) || globalTiles.length === 0) {
      this.clearCanvas();
      this.renderEmptyMap();
      return;
    }

    /**
     * Implement freeciv-web's map boundary handling to fix diamond-shaped map edges.
     *
     * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:282-291
     *   The original boundary detection and background filling logic that prevents
     *   diamond-shaped map edges by filling out-of-bounds areas with background color.
     */
    const viewportExceedsMapBounds = this.checkViewportBounds(state.viewport);

    if (viewportExceedsMapBounds) {
      // Clear canvas without background fill (freeciv-web uses rgb(0,0,0) black)
      // We improve on this by rendering actual ocean tiles instead of solid color
      this.clearCanvas(false);

      // Render ocean tiles in out-of-bounds areas (enhancement over freeciv-web's black fill)
      // This creates a more seamless infinite world appearance
      this.terrainRenderer.renderOceanPadding(state);
    } else {
      // Normal ocean background when viewport is entirely within map bounds
      this.clearCanvas(true, '#4682B4');
    }

    const visibleTiles = this.getVisibleTilesFromGlobal(state.viewport, globalMap, globalTiles);

    // Render terrain layer (includes rivers and resources per-tile to maintain z-order)
    this.terrainRenderer.renderTerrain(state, visibleTiles);

    // Render selection outline after terrain but before units
    this.unitRenderer.renderUnitSelection(state);

    // Render units layer
    this.unitRenderer.renderUnits(state);

    // Render cities layer
    await this.cityRenderer.renderCities(state);

    // Render paths and overlays
    this.pathRenderer.renderPaths(state);
  }

  private clearCanvas(fillBackground = true, backgroundColor = '#4682B4') {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

    if (fillBackground) {
      this.ctx.fillStyle = backgroundColor;
      this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    }
  }

  private renderEmptyMap() {
    this.ctx.strokeStyle = '#336699';
    this.ctx.lineWidth = 1;

    const gridSize = 50;
    for (let x = 0; x < this.ctx.canvas.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.ctx.canvas.height);
      this.ctx.stroke();
    }

    for (let y = 0; y < this.ctx.canvas.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.ctx.canvas.width, y);
      this.ctx.stroke();
    }

    this.ctx.fillStyle = 'white';
    this.ctx.font = '24px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      'No Map Data - Connect to Server',
      this.ctx.canvas.width / 2,
      this.ctx.canvas.height / 2
    );
  }

  private renderLoadingMessage() {
    this.ctx.fillStyle = 'white';
    this.ctx.font = '20px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Loading Tileset...', this.ctx.canvas.width / 2, this.ctx.canvas.height / 2);
  }

  /**
   * Convert map coordinates to GUI (isometric) coordinates.
   * This handles the coordinate transformation for isometric diamond-shaped tile layout.
   * @param mapDx - Map X coordinate difference
   * @param mapDy - Map Y coordinate difference
   * @returns GUI coordinates object with guiDx and guiDy
   */
  mapToGuiVector(mapDx: number, mapDy: number): { guiDx: number; guiDy: number } {
    const guiDx = ((mapDx - mapDy) * this.tileWidth) >> 1;
    const guiDy = ((mapDx + mapDy) * this.tileHeight) >> 1;
    return { guiDx, guiDy };
  }

  private guiToMapPos(guiX: number, guiY: number): { mapX: number; mapY: number } {
    const W = this.tileWidth;
    const H = this.tileHeight;

    guiX -= W >> 1;

    const numeratorX = guiX * H + guiY * W;
    const numeratorY = guiY * W - guiX * H;
    const denominator = W * H;

    const mapX = this.divide(numeratorX, denominator);
    const mapY = this.divide(numeratorY, denominator);

    return { mapX, mapY };
  }

  private divide(n: number, d: number): number {
    if (d === 0) return 0;

    const result = Math.floor(n / d);
    return result;
  }

  canvasToMap(canvasX: number, canvasY: number, viewport: MapViewport) {
    const guiX = canvasX + viewport.x;
    const guiY = canvasY + viewport.y;
    const result = this.guiToMapPos(guiX, guiY);
    return result;
  }

  /**
   * Check if viewport extends beyond map boundaries to determine if ocean padding is needed.
   *
   * This implements the boundary detection logic from freeciv-web to fix the diamond-shaped
   * map edges issue. When the viewport extends beyond map bounds, we need to render ocean
   * tiles in the out-of-bounds areas to create a rectangular world appearance.
   *
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:282-291
   * @param viewport - The current viewport containing x, y, width, height
   * @returns true if any part of the viewport extends beyond map boundaries
   */
  private checkViewportBounds(viewport: MapViewport): boolean {
    const globalMap = (window as any).map;
    if (!globalMap || !globalMap.xsize || !globalMap.ysize) {
      return false; // No map data available
    }

    // Convert viewport corners to map coordinates using canvasToMap (equivalent to base_canvas_to_map_pos)
    const corners = [
      this.canvasToMap(0, 0, viewport), // Top-left corner (r in freeciv-web)
      this.canvasToMap(viewport.width, 0, viewport), // Top-right corner (s in freeciv-web)
      this.canvasToMap(0, viewport.height, viewport), // Bottom-left corner (t in freeciv-web)
      this.canvasToMap(viewport.width, viewport.height, viewport), // Bottom-right corner (u in freeciv-web)
    ];

    // Check if any corner is outside map bounds (same logic as freeciv-web conditional)
    return corners.some(
      corner =>
        corner.mapX < 0 ||
        corner.mapX > globalMap.xsize ||
        corner.mapY < 0 ||
        corner.mapY > globalMap.ysize
    );
  }

  // Helper functions copied from freeciv-web for map wrapping and boundaries

  /**
   * Map wrapping flags from freeciv-web map.js
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:35-36
   */
  private static readonly WRAP_X = 1;
  private static readonly WRAP_Y = 2;

  /**
   * Check if the map has a specific wrapping flag enabled.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:77-80
   * @param flag - The wrapping flag to check (WRAP_X or WRAP_Y)
   * @returns true if the map has this wrapping enabled
   */
  private wrapHasFlag(flag: number): boolean {
    const globalMap = (window as any).map;
    return globalMap && (globalMap.wrap_id & flag) !== 0;
  }

  /**
   * Freeciv coordinate wrapping function for handling map boundaries.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/utility.js FC_WRAP function
   * @param value - The coordinate value to wrap
   * @param range - The range size (map dimension)
   * @returns The wrapped coordinate value
   */
  private fcWrap(value: number, range: number): number {
    return value < 0
      ? value % range !== 0
        ? (value % range) + range
        : 0
      : value >= range
        ? value % range
        : value;
  }

  /**
   * Convert map coordinates to native coordinates for wrapping calculations.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:243-248
   * @param mapX - Map X coordinate
   * @param mapY - Map Y coordinate
   * @returns Native coordinates object with natX and natY
   */
  private mapToNativePos(mapX: number, mapY: number): { natX: number; natY: number } {
    const globalMap = (window as any).map;
    const natY = Math.floor(mapX + mapY - globalMap.xsize);
    const natX = Math.floor((2 * mapX - natY - (natY & 1)) / 2);
    return { natX, natY };
  }

  /**
   * Convert native coordinates back to map coordinates after wrapping.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:233-238
   * @param natX - Native X coordinate
   * @param natY - Native Y coordinate
   * @returns Map coordinates object with mapX and mapY
   */
  private nativeToMapPos(natX: number, natY: number): { mapX: number; mapY: number } {
    const globalMap = (window as any).map;
    const mapX = Math.floor((natY + (natY & 1)) / 2 + natX);
    const mapY = Math.floor(natY - mapX + globalMap.xsize);
    return { mapX, mapY };
  }

  /**
   * Normalize (wrap) the GUI position for map boundary handling.
   * This is equivalent to map wrapping but in GUI coordinates to preserve pixel accuracy.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:136-183
   * @param guiX - GUI X coordinate to normalize
   * @param guiY - GUI Y coordinate to normalize
   * @returns Normalized GUI coordinates that respect map wrapping
   */
  private normalizeGuiPos(guiX: number, guiY: number): { guiX: number; guiY: number } {
    const globalMap = (window as any).map;
    if (!globalMap) return { guiX, guiY };

    // Convert the (gui_x, gui_y) into a (map_x, map_y) plus a GUI offset from this tile
    const mapPos = this.guiToMapPos(guiX, guiY);
    let { mapX, mapY } = mapPos;

    const guiPos = this.mapToGuiVector(mapX, mapY);
    const guiX0 = guiPos.guiDx;
    const guiY0 = guiPos.guiDy;

    const diffX = guiX - guiX0;
    const diffY = guiY - guiY0;

    // Perform wrapping without any realness check. It's important that
    // we wrap even if the map position is unreal, which normalize_map_pos doesn't necessarily do.
    const nativePos = this.mapToNativePos(mapX, mapY);
    let { natX, natY } = nativePos;

    if (this.wrapHasFlag(MapRenderer.WRAP_X)) {
      natX = this.fcWrap(natX, globalMap.xsize);
    }
    if (this.wrapHasFlag(MapRenderer.WRAP_Y)) {
      natY = this.fcWrap(natY, globalMap.ysize);
    }

    const wrappedMapPos = this.nativeToMapPos(natX, natY);
    mapX = wrappedMapPos.mapX;
    mapY = wrappedMapPos.mapY;

    // Now convert the wrapped map position back to a GUI position and add the offset back on
    const wrappedGuiPos = this.mapToGuiVector(mapX, mapY);
    const finalGuiX = wrappedGuiPos.guiDx + diffX;
    const finalGuiY = wrappedGuiPos.guiDy + diffY;

    return { guiX: finalGuiX, guiY: finalGuiY };
  }

  /**
   * Calculate the centered starting position for the viewport.
   * Centers the viewport on the middle tile of the map for optimal initial view.
   * @param viewportWidth - Width of the viewport in pixels
   * @param viewportHeight - Height of the viewport in pixels
   * @returns GUI coordinates for centering the viewport on the map
   */
  getCenteredViewportPosition(
    viewportWidth: number,
    viewportHeight: number
  ): { x: number; y: number } {
    const globalMap = (window as any).map;

    if (!globalMap || !globalMap.xsize || !globalMap.ysize) {
      return { x: 0, y: 0 };
    }

    // For isometric maps, we need to center based on the actual center tile of the map
    // Let's use freeciv-web's approach: center on the middle tile
    const centerTileX = Math.floor(globalMap.xsize / 2);
    const centerTileY = Math.floor(globalMap.ysize / 2);

    // Convert center tile to GUI coordinates
    const centerTileGui = this.mapToGuiVector(centerTileX, centerTileY);

    // Position viewport so center tile is in center of screen
    const centerX = centerTileGui.guiDx - viewportWidth / 2;
    const centerY = centerTileGui.guiDy - viewportHeight / 2;

    return { x: centerX, y: centerY };
  }

  /**
   * Change the mapview origin, clip it, and apply boundary constraints.
   * This is the main function for handling viewport movement and boundary enforcement.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:103-111
   * @param guiX0 - Proposed GUI X coordinate for viewport origin
   * @param guiY0 - Proposed GUI Y coordinate for viewport origin
   * @param viewportWidth - Width of the viewport in pixels (default: 800)
   * @param viewportHeight - Height of the viewport in pixels (default: 600)
   * @returns Constrained GUI coordinates that respect map boundaries
   */
  setMapviewOrigin(
    guiX0: number,
    guiY0: number,
    viewportWidth: number = 800,
    viewportHeight: number = 600
  ): { x: number; y: number } {
    const globalMap = (window as any).map;

    // If no map data, apply simple bounds instead of infinite panning
    if (!globalMap || !globalMap.xsize || !globalMap.ysize) {
      console.warn('No map data available, applying fallback bounds');
      // Apply simple rectangular bounds as fallback (prevent infinite panning)
      const maxX = 1000;
      const maxY = 1000;
      const minX = -500;
      const minY = -500;

      const constrainedX = Math.max(minX, Math.min(maxX, guiX0));
      const constrainedY = Math.max(minY, Math.min(maxY, guiY0));

      return { x: constrainedX, y: constrainedY };
    }

    // For non-wrapping maps, apply very generous boundary constraints
    // Allow panning to see the entire map with reasonable padding
    if (globalMap.wrap_id === 0) {
      const mapWidthGui = globalMap.xsize * this.tileWidth;
      const mapHeightGui = globalMap.ysize * this.tileHeight;

      // Very generous bounds - allow seeing entire map plus lots of padding
      // This matches freeciv-web's behavior which is quite permissive
      // Use consistent minimum padding to prevent snap-back on small screens
      const padding = Math.max(viewportWidth * 2, viewportHeight * 2, 2000); // Much more generous padding

      const minX = -(mapWidthGui + padding);
      const maxX = padding;
      const minY = -(mapHeightGui + padding);
      const maxY = padding;

      const constrainedX = Math.max(minX, Math.min(maxX, guiX0));
      const constrainedY = Math.max(minY, Math.min(maxY, guiY0));

      // Only apply constraints if we're really far out of bounds
      // This prevents snap-back when dragging near edges
      const tolerance = 100; // pixels of tolerance before snapping
      if (
        Math.abs(constrainedX - guiX0) < tolerance &&
        Math.abs(constrainedY - guiY0) < tolerance
      ) {
        return { x: guiX0, y: guiY0 }; // Keep original position if close to bounds
      }

      return { x: constrainedX, y: constrainedY };
    }

    // For wrapping maps, use the full normalize_gui_pos logic
    const normalized = this.normalizeGuiPos(guiX0, guiY0);
    return { x: normalized.guiX, y: normalized.guiY };
  }

  /**
   * Set the scaling factors for different sprite types
   * @param resourceScale - Scale factor for resource sprites (0.1 to 2.0)
   * @param cityScale - Scale factor for city sprites (0.1 to 2.0)
   */
  setSpriteScales(resourceScale?: number, cityScale?: number) {
    // Note: resourceScale is now fixed at 0.7 in TerrainRenderer for consistency
    if (resourceScale !== undefined) {
      console.warn('Resource scale is now fixed in terrain rendering for performance');
    }
    if (cityScale !== undefined) {
      this.cityRenderer.setCityScale(cityScale);
    }
  }

  /**
   * Get current sprite scaling factors
   */
  getSpriteScales() {
    return {
      resourceScale: 0.7, // Fixed value as per original implementation
      cityScale: this.cityRenderer.getCityScale(),
    };
  }

  debugCoordinateAccuracy(): void {
    if (!this.isInitialized) return;
  }

  cleanup() {
    this.tilesetLoader.cleanup();
    this.isInitialized = false;
  }

  private getVisibleTilesFromGlobal(
    // @ts-expect-error - TODO: implement viewport culling
    viewport: MapViewport,
    // @ts-expect-error - TODO: implement map bounds checking
    globalMap: any,
    globalTiles: any[]
  ): Tile[] {
    const tiles: Tile[] = [];

    // For now, let's do a simple approach - get all tiles that have data
    // Later we can add the complex isometric culling logic
    for (let i = 0; i < globalTiles.length; i++) {
      const tile = globalTiles[i];
      if (tile && tile.terrain && (tile.known > 0 || tile.seen > 0)) {
        // Convert to our expected format
        tiles.push({
          x: tile.x,
          y: tile.y,
          terrain: tile.terrain,
          visible: tile.known > 0,
          known: tile.seen > 0,
          units: [],
          city: undefined,
          elevation: tile.elevation || 0,
          resource: tile.resource || undefined,
          riverMask: tile.riverMask || tile.river_mask || 0, // Support both naming conventions
        });
      }
    }

    return tiles;
  }
}
