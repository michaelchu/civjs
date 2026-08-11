/**
 * @module client/components/Canvas2D/MapRenderer
 * Defines the Map Renderer canvas component.
 */
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
import { PresentationEffectRenderer } from './renderers/PresentationEffectRenderer';
import { rulesetService } from '../../services/RulesetService';
import { resolveGraphic } from '../../services/PresentationResolver';
import type { RenderState } from './renderers/BaseRenderer';
import {
  createMapGeometry,
  guiToMapPosition,
  guiToNativePosition,
  getProjectedMapBounds,
  isIsometricTopology,
  mapToGuiPosition,
  nativeAxisGuiPeriod,
  nativeToGuiPosition,
  normalizeMapPosition,
  type MapGeometry,
} from './mapTopologyGeometry';

declare global {
  interface Window {
    spritesLogged?: boolean;
  }
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private tileWidth = 96;
  private tileHeight = 48;

  /** Sprite definitions and images shared by every rendering stage. */
  private tilesetLoader: TilesetProvider;
  private isInitialized = false;
  private isDisposed = false;

  /** Bypasses frame throttling for an explicitly requested visual update. */
  private forceImmediateRender = false;
  private pendingRenderTimeoutId: number | null = null;

  /**
   * Frame-timing state compatible with the Freeciv-web map renderer.
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:27-36
   */
  private lastRedrawTime = 0;
  private MAPVIEW_REFRESH_INTERVAL = 35;
  private totalDraws = 0;
  private meanTime = 0;
  private stopChecking = false;
  private calibrateThreshold = 1000000000;
  private isSmallScreen = false;

  /** Layer-specific renderers, invoked in Freeciv draw order. */
  private terrainRenderer: TerrainRenderer;
  private unitRenderer: UnitRenderer;
  private cityRenderer: CityRenderer;
  private pathRenderer: PathRenderer;
  private borderRenderer: BorderRenderer;
  private fogRenderer: FogRenderer;
  private presentationEffectRenderer: PresentationEffectRenderer;
  private fogOfWarEnabled = true;
  private currentMap: GameState['map'] = { width: 0, height: 0, tiles: {} };
  private currentGeometry: MapGeometry = createMapGeometry(0, 0);

  /**
   * Creates the renderer and its layer-specific stages.
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:3796
   */
  constructor(
    ctx: CanvasRenderingContext2D,
    tilesetProvider: TilesetProvider = new Amplio2TilesetProvider(),
    private readonly rulesetName: string = 'civ2civ3'
  ) {
    this.ctx = ctx;
    this.tilesetLoader = tilesetProvider;
    this.setupCanvas();

    this.isSmallScreen = window.innerWidth <= 640 || window.innerHeight <= 590;
    if (this.isSmallScreen) {
      this.MAPVIEW_REFRESH_INTERVAL = 12;
    }

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
    this.presentationEffectRenderer = new PresentationEffectRenderer(
      ctx,
      this.tilesetLoader,
      this.tileWidth,
      this.tileHeight
    );
  }

  /** Loads the tileset and distributes its resolved graphics to each renderer. */
  async initialize(): Promise<void> {
    try {
      await this.tilesetLoader.load();
      if (this.isDisposed) return;

      const [presentation, nationStyles] = await Promise.all([
        rulesetService.loadPresentationRuleset(this.rulesetName),
        rulesetService.getNationStyles(this.rulesetName),
      ]);
      if (this.isDisposed) return;

      const tileSize = this.tilesetLoader.getTileSize();
      this.tileWidth = tileSize.width;
      this.tileHeight = tileSize.height;

      this.terrainRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.unitRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.cityRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.pathRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.borderRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.fogRenderer.updateTileSize(this.tileWidth, this.tileHeight);
      this.presentationEffectRenderer.updateTileSize(this.tileWidth, this.tileHeight);
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
      this.unitRenderer.setActivityGraphics(presentation.extras);
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

  /** Exposes the resolved tileset dimensions for viewport projection overlays. */
  getTileSize(): { width: number; height: number } {
    return { width: this.tileWidth, height: this.tileHeight };
  }

  /** Configures the canvas for crisp pixel-art sprite rendering. */
  private setupCanvas() {
    this.ctx.imageSmoothingEnabled = false;
    (this.ctx as any).webkitImageSmoothingEnabled = false;
    (this.ctx as any).mozImageSmoothingEnabled = false;
    (this.ctx as any).msImageSmoothingEnabled = false;

    this.ctx.font = '14px Arial, sans-serif';
  }

  /**
   * Renders a map snapshot in Freeciv layer order, throttling ordinary frames
   * while allowing interaction feedback to request an immediate redraw.
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:522-540,688-700
   */
  render(state: RenderState, immediate = false) {
    if (this.isDisposed) return;

    this.renderState = state;
    this.currentMap = state.map;
    const currentTime = new Date().getTime();
    const timeSinceLastRender = currentTime - this.lastRedrawTime;

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

    this.currentGeometry = createMapGeometry(mapWidth, mapHeight, state.map.topology_id ?? 0);

    this.terrainRenderer.setMapGeometry?.(state.map);
    this.borderRenderer.setMapGeometry?.(state.map);
    this.cityRenderer.setMapGeometry?.(state.map);
    this.unitRenderer.setMapGeometry?.(state.map);
    this.presentationEffectRenderer.setMapGeometry?.(state.map);
    this.fogRenderer.setMapGeometry?.(state.map);
    this.pathRenderer.setMapGeometry?.(state.map);

    /**
     * Implement freeciv-web's map boundary handling to fix diamond-shaped map edges.
     *
     * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:282-291
     *   The original boundary detection and background filling logic that prevents
     *   diamond-shaped map edges by filling out-of-bounds areas with background color.
     */
    // Wrapped maps have no finite edge. Their terrain and overlays are drawn
    // from the periodic viewport copies below, so treating a seam as an
    // out-of-bounds edge would incorrectly paint ocean/black padding there.
    const viewportExceedsMapBounds =
      !this.isWrappedMap() && this.checkViewportBounds(state.viewport);

    if (this.fogOfWarEnabled) {
      // Unknown space includes both unrevealed map tiles and any finite-map
      // padding visible around the isometric diamond. Start from opaque black
      // so the decorative ocean padding cannot leak around the fog sprites.
      this.clearCanvas(true, '#000');
    } else if (viewportExceedsMapBounds) {
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

    const renderViews = this.getWrappedRenderViews(mapTiles, state.viewport);
    let hasActivePresentationEffects = false;
    for (const renderView of renderViews) {
      const renderState =
        renderView.viewport === state.viewport
          ? state
          : { ...state, viewport: renderView.viewport };
      // Always render every wrapped copy. `||=` would short-circuit the
      // renderMapLayers call after the first copy reports an active marker or
      // combat effect, leaving the remaining terrain copies undrawn.
      const viewHasActivePresentationEffects = this.renderMapLayers(
        renderState,
        renderView.visibleTiles
      );
      hasActivePresentationEffects =
        hasActivePresentationEffects || viewHasActivePresentationEffects;
    }
    const hasActiveBorderAnimation =
      this.borderRenderer.hasActiveAnimation?.(state.reducedMotion) ?? false;

    if (
      (this.unitRenderer.hasActiveMovementAnimations() ||
        hasActivePresentationEffects ||
        hasActiveBorderAnimation) &&
      this.movementAnimationFrameId === null
    ) {
      this.movementAnimationFrameId = requestAnimationFrame(() => {
        this.movementAnimationFrameId = null;
        if (this.renderState) this.render(this.renderState, true);
      });
    }

    const renderEnd = performance.now();
    const elapsed = renderEnd - renderStart;

    this.lastRedrawTime = currentTime;
    this.totalDraws++;
    this.meanTime = (this.meanTime * (this.totalDraws - 1) + elapsed) / this.totalDraws;

    if (!this.stopChecking && this.totalDraws % 100 === 0) {
      this.MAPVIEW_REFRESH_INTERVAL = Math.max(12, Math.min(140, this.meanTime + 10));

      if (this.totalDraws > this.calibrateThreshold) {
        this.stopChecking = true;
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

  /**
   * Draw one map copy in the same layer order as the reference client.
   * Wrapped maps call this once for every periodic copy that intersects the
   * canvas. The renderers continue to consume the authoritative finite tile
   * and entity coordinates; only the viewport origin is translated.
   */
  private renderMapLayers(state: RenderState, visibleTiles: Tile[]): boolean {
    /*
     * Freeciv draws terrain and specials before borders, cities, units, fog,
     * and interaction overlays. Keep that order so each layer occludes only
     * the information it is permitted to hide.
     * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:580-720
     */
    this.terrainRenderer.renderTerrain(state, visibleTiles);

    this.borderRenderer.render(state);
    this.terrainRenderer.renderSpecials(state, visibleTiles);

    this.cityRenderer.renderCities(state);

    /* During combat, preserve short-lived visual unit copies after server removal. */
    const presentationUnitOverrides =
      this.presentationEffectRenderer?.getUnitOverrides?.(state) ?? {};
    const presentationState = Object.keys(presentationUnitOverrides).length
      ? {
          ...state,
          units: { ...state.units, ...presentationUnitOverrides },
        }
      : state;
    this.unitRenderer.renderUnits(presentationState);

    const hasActivePresentationEffects = this.presentationEffectRenderer?.render(state) ?? false;
    if (this.fogOfWarEnabled) {
      this.fogRenderer.render(state);
    }

    this.pathRenderer.renderPaths(state);
    this.unitRenderer.renderUnitSelection(presentationState);
    this.unitRenderer.renderSelectedUnit?.(presentationState);

    return hasActivePresentationEffects;
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
    const position = mapToGuiPosition(mapDx, mapDy, this.tileWidth, this.tileHeight);
    return { guiDx: position.x, guiDy: position.y };
  }

  private guiToMapPos(guiX: number, guiY: number): { mapX: number; mapY: number } {
    const position = guiToMapPosition(guiX, guiY, this.tileWidth, this.tileHeight);
    return { mapX: position.x, mapY: position.y };
  }

  canvasToMap(canvasX: number, canvasY: number, viewport: MapViewport) {
    const guiX = canvasX + viewport.x;
    const guiY = canvasY + viewport.y;
    const native = guiToNativePosition(
      guiX,
      guiY,
      this.getCurrentGeometry(),
      this.tileWidth,
      this.tileHeight
    );
    return { mapX: native.x, mapY: native.y };
  }

  /**
   * Check if viewport extends beyond map boundaries to determine if ocean padding is needed.
   *
   * This implements the boundary detection logic from freeciv-web to fix the diamond-shaped
   * map edges issue. When the viewport extends beyond map bounds, we need to render ocean
   * tiles in the out-of-bounds areas to create a rectangular world appearance.
   *
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:282-291
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

    const corners = [
      this.canvasToMap(0, 0, viewport),
      this.canvasToMap(canvasWidth, 0, viewport),
      this.canvasToMap(0, canvasHeight, viewport),
      this.canvasToMap(canvasWidth, canvasHeight, viewport),
    ];

    return corners.some(
      corner =>
        corner.mapX < 0 || corner.mapX >= mapWidth || corner.mapY < 0 || corner.mapY >= mapHeight
    );
  }

  /**
   * Map wrapping flags from freeciv-web map.js
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:35-36
   */
  private static readonly WRAP_X = 1;
  private static readonly WRAP_Y = 2;

  /**
   * Check if the map has a specific wrapping flag enabled.
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:77-80
   * @param flag - The wrapping flag to check (WRAP_X or WRAP_Y)
   * @returns true if the map has this wrapping enabled
   */
  private wrapHasFlag(flag: number): boolean {
    return ((this.currentMap.wrap_id ?? 0) & flag) !== 0;
  }

  /**
   * Return whether the current map has at least one periodic axis.
   */
  private isWrappedMap(): boolean {
    return this.wrapHasFlag(MapRenderer.WRAP_X) || this.wrapHasFlag(MapRenderer.WRAP_Y);
  }

  /**
   * Normalize a mapview origin through Freeciv's native rectangular axes.
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:195-239
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

    const normalized = normalizeMapPosition(
      mapX,
      mapY,
      mapWidth,
      mapHeight,
      this.currentMap.topology_id ?? 0,
      this.currentMap.wrap_id ?? 0
    );
    mapX = normalized.x;
    mapY = normalized.y;

    // Now convert the wrapped map position back to a GUI position and add the offset back on
    const wrappedGuiPos = this.mapToGuiVector(mapX, mapY);
    const finalGuiX = wrappedGuiPos.guiDx + diffX;
    const finalGuiY = wrappedGuiPos.guiDy + diffY;

    return { guiX: finalGuiX, guiY: finalGuiY };
  }

  /**
   * Return the GUI translation for one complete map period on an axis.
   * Wrapping is performed in map coordinates, so the period is the GUI vector
   * for adding one map width/height to that coordinate.
   */
  private getGuiWrapPeriod(axis: 'x' | 'y'): { x: number; y: number } {
    const period = nativeAxisGuiPeriod(
      axis,
      this.getCurrentGeometry(),
      this.tileWidth,
      this.tileHeight
    );
    return { x: period.x, y: period.y };
  }

  private getWrapOffsets(period: { x: number; y: number }, viewport: MapViewport): number[] {
    const periodSize = Math.max(Math.abs(period.x), Math.abs(period.y), 1);
    const viewportSpan = Math.max(viewport.width, viewport.height) + this.tileWidth * 2;
    const count = Math.max(1, Math.ceil(viewportSpan / periodSize));
    return Array.from({ length: count * 2 + 1 }, (_, index) => index - count);
  }

  /**
   * Build the finite-map copies needed to cover a wrapped viewport. A copy is
   * represented by translating the viewport in the opposite direction of the
   * map period; all renderers can then keep using authoritative x/y values.
   */
  private getWrappedRenderViews(
    mapTiles: Tile[],
    viewport: MapViewport
  ): Array<{ viewport: MapViewport; visibleTiles: Tile[] }> {
    if (!this.isWrappedMap()) {
      return [{ viewport, visibleTiles: this.getVisibleTiles(mapTiles, viewport) }];
    }

    const xPeriod = this.getGuiWrapPeriod('x');
    const yPeriod = this.getGuiWrapPeriod('y');
    const xOffsets = this.wrapHasFlag(MapRenderer.WRAP_X)
      ? this.getWrapOffsets(xPeriod, viewport)
      : [0];
    const yOffsets = this.wrapHasFlag(MapRenderer.WRAP_Y)
      ? this.getWrapOffsets(yPeriod, viewport)
      : [0];
    const views: Array<{ viewport: MapViewport; visibleTiles: Tile[] }> = [];

    for (const xOffset of xOffsets) {
      for (const yOffset of yOffsets) {
        const copyViewport = {
          ...viewport,
          x: viewport.x - xOffset * xPeriod.x - yOffset * yPeriod.x,
          y: viewport.y - xOffset * xPeriod.y - yOffset * yPeriod.y,
        };

        // Include unknown tiles when deciding whether a copy is needed. Fog
        // still has to cover a copy even when terrain itself is hidden.
        const copyTiles = this.getVisibleTiles(mapTiles, copyViewport, true);
        if (copyTiles.length === 0) continue;

        views.push({
          viewport: copyViewport,
          visibleTiles: this.fogOfWarEnabled ? copyTiles.filter(tile => tile.known) : copyTiles,
        });
      }
    }

    return views.length > 0
      ? views
      : [{ viewport, visibleTiles: this.getVisibleTiles(mapTiles, viewport) }];
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

    return this.getViewportPositionForTile(centerTileX, centerTileY, viewportWidth, viewportHeight);
  }

  /**
   * Position a viewport so the center of a map tile is at the center of the
   * current canvas.
   */
  getViewportPositionForTile(
    mapX: number,
    mapY: number,
    viewportWidth: number,
    viewportHeight: number
  ): { x: number; y: number } {
    const tileGui = this.nativeToGuiPosition(mapX, mapY);
    return {
      // Keep the viewport origin on device pixels. Fractional origins make
      // adjacent terrain sprites sample between rows and expose dark seams.
      x: Math.round(tileGui.guiDx + this.tileWidth / 2 - viewportWidth / 2),
      y: Math.round(tileGui.guiDy + this.tileHeight / 2 - viewportHeight / 2),
    };
  }

  /**
   * Change the mapview origin, clip it, and apply boundary constraints.
   * This is the main function for handling viewport movement and boundary enforcement.
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:103-111
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
      const geometry = this.getCurrentGeometry();
      const projectedBounds = getProjectedMapBounds(geometry, this.tileWidth, this.tileHeight);
      const mapWidthGui = geometry.isIsometric ? projectedBounds.width : mapWidth * this.tileWidth;
      const mapHeightGui = geometry.isIsometric
        ? projectedBounds.height
        : mapHeight * this.tileHeight;

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
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:696-700
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
    // @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:688-700
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

  private getVisibleTiles(mapTiles: Tile[], viewport: MapViewport, includeUnknown = false): Tile[] {
    const tiles: Tile[] = [];
    const canvasWidth = this.ctx.canvas?.width || viewport.width;
    const canvasHeight = this.ctx.canvas?.height || viewport.height;
    // Tall terrain and overlay sprites extend beyond their tile bounding box.
    // Keep one tile of horizontal and two tiles of vertical overdraw around
    // the canvas so viewport culling cannot clip those sprites.
    const horizontalMargin = this.tileWidth;
    const verticalMargin = this.tileHeight * 2;

    for (const tile of mapTiles) {
      const position = this.nativeToGuiPosition(tile.x, tile.y);
      const screenX = position.guiDx - viewport.x;
      const screenY = position.guiDy - viewport.y;
      const intersectsViewport =
        screenX + this.tileWidth >= -horizontalMargin &&
        screenX <= canvasWidth + horizontalMargin &&
        screenY + this.tileHeight >= -verticalMargin &&
        screenY <= canvasHeight + verticalMargin;

      if (
        intersectsViewport &&
        tile.terrain &&
        (includeUnknown || !this.fogOfWarEnabled || tile.known)
      ) {
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

  private nativeToGuiPosition(nativeX: number, nativeY: number): { guiDx: number; guiDy: number } {
    const position = nativeToGuiPosition(
      nativeX,
      nativeY,
      this.getCurrentGeometry(),
      this.tileWidth,
      this.tileHeight
    );
    return { guiDx: position.x, guiDy: position.y };
  }

  private getCurrentGeometry(): MapGeometry {
    const nativeWidth = this.currentMap.xsize ?? this.currentMap.width;
    const nativeHeight = this.currentMap.ysize ?? this.currentMap.height;
    const topologyId = this.currentMap.topology_id ?? 0;
    if (
      this.currentGeometry.nativeWidth !== nativeWidth ||
      this.currentGeometry.nativeHeight !== nativeHeight ||
      this.currentGeometry.isIsometric !== isIsometricTopology(topologyId)
    ) {
      this.currentGeometry = createMapGeometry(nativeWidth, nativeHeight, topologyId);
    }
    return this.currentGeometry;
  }
}
