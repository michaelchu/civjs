/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GameState, MapViewport, Tile } from '../../types';
import { Amplio2TilesetProvider } from './tilesets/Amplio2TilesetProvider';
import type { TilesetProvider } from './tilesets/TilesetProvider';
import { TerrainRenderer } from './renderers/TerrainRenderer';
import { UnitRenderer } from './renderers/UnitRenderer';
import { CityRenderer } from './renderers/CityRenderer';
import { PathRenderer } from './renderers/PathRenderer';
import { BorderRenderer } from './renderers/BorderRenderer';
import { FogRenderer } from './renderers/FogRenderer';
import { rulesetService } from '../../services/RulesetService';
import { resolveGraphic } from '../../services/PresentationResolver';
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
  private tilesetLoader: TilesetProvider;
  private isInitialized = false;
  private isDisposed = false;

  // Flag to force immediate render bypassing timing checks
  private forceImmediateRender = false;
  private pendingRenderTimeoutId: number | null = null;

  // @reference freeciv-web/javascript/2dcanvas/mapview_common.js:27-36
  // Performance timing system ported from freeciv-web
  private lastRedrawTime = 0;
  private MAPVIEW_REFRESH_INTERVAL = 35; // Default 35ms (~28 FPS)
  private totalDraws = 0;
  private meanTime = 0;
  private stopChecking = false;
  private calibrateThreshold = 1000000000; // 1 billion for calibration
  private isSmallScreen = false;

  // Specialized renderers
  private terrainRenderer: TerrainRenderer;
  private unitRenderer: UnitRenderer;
  private cityRenderer: CityRenderer;
  private pathRenderer: PathRenderer;
  private borderRenderer: BorderRenderer;
  private fogRenderer: FogRenderer;
  private fogOfWarEnabled = true;
  private currentMap: GameState['map'] = { width: 0, height: 0, tiles: {} };

  constructor(
    ctx: CanvasRenderingContext2D,
    tilesetProvider: TilesetProvider = new Amplio2TilesetProvider()
  ) {
    this.ctx = ctx;
    this.tilesetLoader = tilesetProvider;
    this.setupCanvas();

    // @reference freeciv-web/javascript/2dcanvas/mapview.js:3796
    // Screen size optimization from freeciv-web
    this.isSmallScreen = window.innerWidth <= 640 || window.innerHeight <= 590;
    if (this.isSmallScreen) {
      this.MAPVIEW_REFRESH_INTERVAL = 12; // Higher refresh rate for small screens
    }

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
    this.borderRenderer = new BorderRenderer(
      ctx,
      this.tilesetLoader,
      this.tileWidth,
      this.tileHeight
    );
    this.fogRenderer = new FogRenderer(ctx, this.tilesetLoader, this.tileWidth, this.tileHeight);
  }

  async initialize(): Promise<void> {
    try {
      await this.tilesetLoader.load();
      if (this.isDisposed) return;

      const [presentation, nationStyles] = await Promise.all([
        rulesetService.loadPresentationRuleset('classic'),
        rulesetService.getNationStyles('classic'),
      ]);
      if (this.isDisposed) return;

      const tileSize = this.tilesetLoader.getTileSize();
      this.tileWidth = tileSize.width;
      this.tileHeight = tileSize.height;

      // Update tile size in all specialized renderers
      this.terrainRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.unitRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.cityRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.pathRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.borderRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.fogRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      const terrainGraphics = Object.fromEntries(
        Object.entries(presentation.terrains)
          .map(([id, definition]) => [
            id,
            resolveGraphic(definition, graphic => this.tilesetLoader.hasTerrainDefinition(graphic)),
          ])
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
      );
      this.terrainRenderer.setTerrainGraphics(terrainGraphics);
      this.terrainRenderer.setExtraGraphics(presentation.extras);
      this.unitRenderer.setTerrainGraphics(terrainGraphics);
      this.cityRenderer.setTerrainGraphics(terrainGraphics);
      this.unitRenderer.setUnitGraphics(presentation.units);
      this.cityRenderer.setCityStyles(
        presentation.city_styles,
        presentation.nation_styles,
        nationStyles
      );

      this.isInitialized = true;
    } catch (error) {
      if (!this.isDisposed) {
        console.error('Failed to initialize MapRenderer:', error);
      }
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

  render(state: RenderState, immediate = false) {
    if (this.isDisposed) return;

    this.renderState = state;
    this.currentMap = state.map;
    // @reference freeciv-web/javascript/2dcanvas/mapview_common.js:688-700
    // Implement freeciv-web's performance timing system
    const currentTime = new Date().getTime();
    const timeSinceLastRender = currentTime - this.lastRedrawTime;

    // Skip render if not enough time has passed (freeciv-web timing logic)
    // Unless immediate render is requested (for critical updates like goto paths)
    if (
      !immediate &&
      !this.forceImmediateRender &&
      this.lastRedrawTime > 0 &&
      timeSinceLastRender < this.MAPVIEW_REFRESH_INTERVAL
    ) {
      if (this.pendingRenderTimeoutId === null) {
        this.pendingRenderTimeoutId = window.setTimeout(() => {
          this.pendingRenderTimeoutId = null;
          if (this.renderState) {
            this.render(this.renderState, true);
          }
        }, this.MAPVIEW_REFRESH_INTERVAL - timeSinceLastRender);
      }
      return;
    }

    if (this.pendingRenderTimeoutId !== null) {
      window.clearTimeout(this.pendingRenderTimeoutId);
      this.pendingRenderTimeoutId = null;
    }

    const renderStart = performance.now();

    if (!this.isInitialized) {
      this.clearCanvas();
      this.renderLoadingMessage();
      return;
    }

    const mapWidth = state.map.xsize ?? state.map.width;
    const mapHeight = state.map.ysize ?? state.map.height;
    const mapTiles = Object.values(state.map.tiles);
    if (!mapWidth || !mapHeight || mapTiles.length === 0) {
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

    const visibleTiles = this.getVisibleTiles(mapTiles, state.viewport);

    // Follow freeciv-web layer order exactly:
    // LAYER_TERRAIN1, LAYER_TERRAIN2, LAYER_TERRAIN3, LAYER_ROADS,
    // LAYER_SPECIAL1, LAYER_CITY1, LAYER_SPECIAL2, LAYER_UNIT, LAYER_FOG...

    // LAYER_TERRAIN1-3 + LAYER_ROADS + LAYER_SPECIAL1: Render terrain layer (includes rivers + resources)
    // Resources render in LAYER_SPECIAL1 in freeciv-web - they are NOT hidden by cities
    this.terrainRenderer.renderTerrain(state, visibleTiles);

    // LAYER_SPECIAL1: Render borders before resources and other specials.
    // @reference freeciv-web/javascript/2dcanvas/mapview.js:580-720 - Border rendering in layer order
    this.borderRenderer.render(state);
    this.terrainRenderer.renderSpecials(state, visibleTiles);

    // LAYER_CITY1: Render cities layer BEFORE units (freeciv-web order)
    this.cityRenderer.renderCities(state);

    // LAYER_SPECIAL2: Empty layer in our implementation (handled by specific renderers)
    // In freeciv-web this handles airbase, buoy, etc. but not resources

    // Render selection outline before units for proper layering
    this.unitRenderer.renderUnitSelection(state);

    // LAYER_UNIT: Render units layer ON TOP of cities
    this.unitRenderer.renderUnits(state);

    // LAYER_FOG: Freeciv draws fog after units so unseen dynamic entities
    // cannot leak through the remembered terrain layer.
    if (this.fogOfWarEnabled) {
      this.fogRenderer.render(state);
    }

    // Render paths and overlays on top of everything
    this.pathRenderer.renderPaths(state);

    if (this.unitRenderer.hasActiveMovementAnimations() && this.movementAnimationFrameId === null) {
      this.movementAnimationFrameId = requestAnimationFrame(() => {
        this.movementAnimationFrameId = null;
        if (this.renderState) this.render(this.renderState, true);
      });
    }

    // @reference freeciv-web/javascript/2dcanvas/mapview_common.js:522-540
    // Complete timing measurement and adjust refresh interval
    const renderEnd = performance.now();
    const elapsed = renderEnd - renderStart;

    this.lastRedrawTime = currentTime;
    this.totalDraws++;
    this.meanTime = (this.meanTime * (this.totalDraws - 1) + elapsed) / this.totalDraws;

    // Dynamic performance calibration from freeciv-web
    if (!this.stopChecking && this.totalDraws % 100 === 0) {
      this.MAPVIEW_REFRESH_INTERVAL = Math.max(12, Math.min(140, this.meanTime + 10));

      if (this.totalDraws > this.calibrateThreshold) {
        this.stopChecking = true;
        // Additional adjustment for short-turn games (like freeciv-web)
        this.MAPVIEW_REFRESH_INTERVAL *= 2.2;
        this.MAPVIEW_REFRESH_INTERVAL = Math.max(40, Math.min(140, this.MAPVIEW_REFRESH_INTERVAL));
      }
    }
  }

  /**
   * Enable or disable immediate rendering mode
   * When enabled, renders bypass timing checks for immediate updates
   */
  setImmediateRenderMode(enabled: boolean): void {
    this.forceImmediateRender = enabled;
  }

  setFogOfWarEnabled(enabled: boolean): void {
    this.fogOfWarEnabled = enabled;
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
    const mapWidth = this.currentMap.xsize ?? this.currentMap.width;
    const mapHeight = this.currentMap.ysize ?? this.currentMap.height;
    if (!mapWidth || !mapHeight) {
      return false; // No map data available
    }

    // The viewport dimensions can briefly lag behind the canvas during route
    // transitions and resizes. Use the backing buffer dimensions so boundary
    // detection covers every pixel that will actually be displayed.
    const canvasWidth = this.ctx.canvas?.width || viewport.width;
    const canvasHeight = this.ctx.canvas?.height || viewport.height;

    // Convert canvas corners to map coordinates using canvasToMap
    // (equivalent to base_canvas_to_map_pos).
    const corners = [
      this.canvasToMap(0, 0, viewport), // Top-left corner (r in freeciv-web)
      this.canvasToMap(canvasWidth, 0, viewport), // Top-right corner (s in freeciv-web)
      this.canvasToMap(0, canvasHeight, viewport), // Bottom-left corner (t in freeciv-web)
      this.canvasToMap(canvasWidth, canvasHeight, viewport), // Bottom-right corner (u in freeciv-web)
    ];

    // Check if any corner is outside map bounds (same logic as freeciv-web conditional)
    return corners.some(
      corner =>
        corner.mapX < 0 || corner.mapX >= mapWidth || corner.mapY < 0 || corner.mapY >= mapHeight
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
    return ((this.currentMap.wrap_id ?? 0) & flag) !== 0;
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
    const mapWidth = this.currentMap.xsize ?? this.currentMap.width;
    const natY = Math.floor(mapX + mapY - mapWidth);
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
    const mapWidth = this.currentMap.xsize ?? this.currentMap.width;
    const mapX = Math.floor((natY + (natY & 1)) / 2 + natX);
    const mapY = Math.floor(natY - mapX + mapWidth);
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
    const mapWidth = this.currentMap.xsize ?? this.currentMap.width;
    const mapHeight = this.currentMap.ysize ?? this.currentMap.height;
    if (!mapWidth || !mapHeight) return { guiX, guiY };

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
      natX = this.fcWrap(natX, mapWidth);
    }
    if (this.wrapHasFlag(MapRenderer.WRAP_Y)) {
      natY = this.fcWrap(natY, mapHeight);
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
    const mapWidth = this.currentMap.xsize ?? this.currentMap.width;
    const mapHeight = this.currentMap.ysize ?? this.currentMap.height;
    if (!mapWidth || !mapHeight) {
      return { x: 0, y: 0 };
    }

    // For isometric maps, we need to center based on the actual center tile of the map
    // Let's use freeciv-web's approach: center on the middle tile
    const centerTileX = Math.floor(mapWidth / 2);
    const centerTileY = Math.floor(mapHeight / 2);

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
    const mapWidth = this.currentMap.xsize ?? this.currentMap.width;
    const mapHeight = this.currentMap.ysize ?? this.currentMap.height;

    // If no map data, apply simple bounds instead of infinite panning
    if (!mapWidth || !mapHeight) {
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
    if ((this.currentMap.wrap_id ?? 0) === 0) {
      const mapWidthGui = mapWidth * this.tileWidth;
      const mapHeightGui = mapHeight * this.tileHeight;

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

  /**
   * @reference freeciv-web/javascript/2dcanvas/mapview_common.js:696-700
   * Start the requestAnimationFrame-based render loop like freeciv-web
   */
  private animationFrameId: number | null = null;
  private movementAnimationFrameId: number | null = null;
  private renderState: RenderState | null = null;

  startRenderLoop(initialState: RenderState) {
    this.renderState = initialState;
    this.updateMapCanvasCheck();
  }

  updateRenderState(newState: RenderState) {
    this.renderState = newState;
  }

  stopRenderLoop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private updateMapCanvasCheck = () => {
    // @reference freeciv-web/javascript/2dcanvas/mapview_common.js:688-700
    // requestAnimationFrame-based render loop from freeciv-web
    try {
      if (this.renderState && typeof window.requestAnimationFrame === 'function') {
        // Render with timing check (will skip if too soon)
        this.render(this.renderState);

        // Schedule next frame
        this.animationFrameId = requestAnimationFrame(this.updateMapCanvasCheck);
      }
    } catch (e: any) {
      if (e.name === 'NS_ERROR_NOT_AVAILABLE') {
        // Fallback to setTimeout for older browsers
        setTimeout(this.updateMapCanvasCheck, 100);
      }
    }
  };

  cleanup() {
    this.isDisposed = true;
    this.stopRenderLoop();
    if (this.pendingRenderTimeoutId !== null) {
      window.clearTimeout(this.pendingRenderTimeoutId);
      this.pendingRenderTimeoutId = null;
    }
    if (this.movementAnimationFrameId !== null) {
      cancelAnimationFrame(this.movementAnimationFrameId);
      this.movementAnimationFrameId = null;
    }
    this.renderState = null;
    this.tilesetLoader.dispose();
    this.isInitialized = false;
  }

  private getVisibleTiles(mapTiles: Tile[], viewport: MapViewport): Tile[] {
    const tiles: Tile[] = [];
    const canvasWidth = this.ctx.canvas?.width || viewport.width;
    const canvasHeight = this.ctx.canvas?.height || viewport.height;
    // Tall terrain and overlay sprites extend beyond their tile bounding box.
    // Keep one tile of horizontal and two tiles of vertical overdraw around
    // the canvas so viewport culling cannot clip those sprites.
    const horizontalMargin = this.tileWidth;
    const verticalMargin = this.tileHeight * 2;

    for (const tile of mapTiles) {
      const position = this.mapToGuiVector(tile.x, tile.y);
      const screenX = position.guiDx - viewport.x;
      const screenY = position.guiDy - viewport.y;
      const intersectsViewport =
        screenX + this.tileWidth >= -horizontalMargin &&
        screenX <= canvasWidth + horizontalMargin &&
        screenY + this.tileHeight >= -verticalMargin &&
        screenY <= canvasHeight + verticalMargin;

      if (intersectsViewport && tile.terrain && (!this.fogOfWarEnabled || tile.known)) {
        tiles.push(
          this.fogOfWarEnabled
            ? tile
            : {
                ...tile,
                visible: true,
                known: true,
              }
        );
      }
    }

    return tiles;
  }
}
