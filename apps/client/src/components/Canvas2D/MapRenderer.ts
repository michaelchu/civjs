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
  getProjectedMapBounds,
  guiToMapPosition,
  guiToNativePosition,
  mapToGuiPosition,
  nativeAxisGuiPeriod,
  nativeToGuiPosition,
  normalizeMapPosition,
  sortMapPointsInPainterOrder,
  usesNativeLogicalProjection,
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
  private readonly usesReferenceSquareTiming: boolean;

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
  private mapTilesSource: GameState['map']['tiles'] | null = null;
  private mapTilesCache: Tile[] = [];
  private nativeHexRowsSource: Tile[] | null = null;
  private nativeHexRows: Tile[][] = [];
  private indexedTilesSource: Tile[] | null = null;
  private tileByIndex = new Map<number, Tile>();
  private renderCompleteListener: ((viewport: MapViewport) => void) | null = null;

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
    this.usesReferenceSquareTiming =
      tilesetProvider.metadata.projection === 'isometric' &&
      tilesetProvider.metadata.topologyId === 1;
    this.MAPVIEW_REFRESH_INTERVAL = this.usesReferenceSquareTiming ? 10 : 35;
    this.tilesetLoader.setSpriteReadyListener?.(() => {
      if (!this.isDisposed && this.renderState) this.render(this.renderState, true);
    });
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
      this.cityRenderer.setProductionGraphics(presentation.units, presentation.buildings);
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

  /**
   * Notify consumers only after a viewport has actually been painted.
   * MapRenderer may defer a normal render while its refresh interval is
   * active; publishing the requested viewport before that deferred paint
   * would move the minimap outline ahead of the board.
   */
  setRenderCompleteListener(listener: ((viewport: MapViewport) => void) | null): void {
    this.renderCompleteListener = listener;
  }

  private notifyRenderComplete(viewport: MapViewport): void {
    this.renderCompleteListener?.({ ...viewport });
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
      this.notifyRenderComplete(state.viewport);
      return;
    }

    const mapWidth = state.map.xsize ?? state.map.width;
    const mapHeight = state.map.ysize ?? state.map.height;
    const mapTiles = this.getMapTiles(state.map.tiles);
    if (!mapWidth || !mapHeight || mapTiles.length === 0) {
      this.clearCanvas();
      this.renderEmptyMap();
      this.notifyRenderComplete(state.viewport);
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
    this.unitRenderer.beginFrame?.(state);
    this.presentationEffectRenderer.beginFrame?.(state);

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

    if (this.fogOfWarEnabled || viewportExceedsMapBounds) {
      // Freeciv-web clears finite out-of-map pixels to black. Fog also needs
      // the same opaque base so unknown tiles cannot expose stale frame data.
      this.clearCanvas(true, '#000');
    } else {
      // Normal ocean background when viewport is entirely within map bounds
      this.clearCanvas(true, '#4682B4');
    }

    const renderViews = this.getWrappedRenderViews(mapTiles, state.viewport).map(renderView => ({
      state: renderView.isPrimary ? state : { ...state, viewport: renderView.viewport },
      visibleTiles: renderView.visibleTiles,
      isPrimary: renderView.isPrimary,
    }));
    const hasActivePresentationEffects =
      renderViews.length === 1 && renderViews[0].isPrimary
        ? this.renderMapLayers(renderViews[0].state, renderViews[0].visibleTiles)
        : this.renderMapViews(renderViews);
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
    this.notifyRenderComplete(state.viewport);

    if (!this.usesReferenceSquareTiming && !this.stopChecking && this.totalDraws % 100 === 0) {
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
   * Advance all periodic map copies through one source layer at a time.
   * freeciv-web normalizes coordinates inside one global layer pass; this is
   * the equivalent for CivJS's explicit translated-copy representation.
   */
  private renderMapViews(
    views: Array<{ state: RenderState; visibleTiles: Tile[]; isPrimary?: boolean }>
  ): boolean {
    /*
     * Preserve every source layer boundary. In particular, borders terminate
     * SPECIAL1, base middlegrounds follow cities, and base foregrounds follow
     * fog. Collapsing those passes changes occlusion even when sprite geometry
     * is otherwise exact.
     * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:287-453
     * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:292-387
     */
    const preparedViews = views.map(view => {
      /* During combat, preserve short-lived visual unit copies after server removal. */
      const overrides = this.presentationEffectRenderer?.getUnitOverrides?.(view.state) ?? {};
      return {
        ...view,
        presentationState: Object.keys(overrides).length
          ? { ...view.state, units: { ...view.state.units, ...overrides } }
          : view.state,
      };
    });
    /*
     * Freeciv performs one GUI painter walk per source layer. Explicit map
     * copies therefore have to be merged before painting: batching copy A and
     * then copy B lets B's shallower sprite cover A's deeper unit at a seam.
     * A tile entry retains a translated viewport, so the existing renderers
     * can still address canonical server entities without duplicating state.
     */
    const tileEntries = preparedViews
      .flatMap((view, viewIndex) =>
        view.visibleTiles.map((tile, tileIndex) => {
          const gui = nativeToGuiPosition(
            tile.x,
            tile.y,
            this.getCurrentGeometry(),
            this.tileWidth,
            this.tileHeight
          );
          return {
            ...view,
            tile,
            screenX: gui.x - view.state.viewport.x,
            screenY: gui.y - view.state.viewport.y,
            stableOrder: viewIndex * Math.max(1, view.visibleTiles.length) + tileIndex,
          };
        })
      )
      .sort(
        (first, second) =>
          first.screenY - second.screenY ||
          first.screenX - second.screenX ||
          first.stableOrder - second.stableOrder
      );
    const seenTileOrigins = new Set<string>();
    const uniqueTileEntries = tileEntries.filter(entry => {
      const key = `${entry.tile.x},${entry.tile.y}@${entry.screenX},${entry.screenY}`;
      if (seenTileOrigins.has(key)) return false;
      seenTileOrigins.add(key);
      return true;
    });
    const paintTileEntries = uniqueTileEntries.filter(
      entry => !this.fogOfWarEnabled || Boolean(entry.tile.known)
    );
    const forEachPaintTile = (
      render: (state: RenderState, tile: Tile, presentationState: RenderState) => void
    ) => {
      for (const entry of paintTileEntries) {
        render(entry.state, entry.tile, entry.presentationState);
      }
    };

    const renderEntries = paintTileEntries.map(entry => ({ state: entry.state, tile: entry.tile }));
    const presentationEntries = paintTileEntries.map(entry => ({
      state: entry.presentationState,
      tile: entry.tile,
    }));
    // freeciv-web's put_one_tile() skips unknown tiles for every normal layer,
    // but explicitly still invokes LAYER_GOTO. Keep those geometry-visible
    // entries available only to the final path/effect pass.
    const gotoEntries = uniqueTileEntries.map(entry => ({
      state: entry.presentationState,
      tile: entry.tile,
    }));

    if (usesNativeLogicalProjection(this.getCurrentGeometry().topologyId)) {
      return this.renderNativeHexLayers(paintTileEntries, renderEntries, gotoEntries);
    }

    this.terrainRenderer.renderTerrainEntries(renderEntries);

    // SPECIAL1 and UNIT contain multiple source operations which must remain
    // adjacent for each tile, rather than becoming independent global passes.
    forEachPaintTile((viewState, tile) => {
      this.terrainRenderer.renderSpecials(viewState, [tile]);
      this.borderRenderer.render(viewState, [tile]);
    });
    this.cityRenderer.renderCityEntries(renderEntries);
    forEachPaintTile((viewState, tile) => this.terrainRenderer.renderSpecial2(viewState, [tile]));

    let hasActivePresentationEffects = false;
    this.unitRenderer.renderUnitLayerEntries(presentationEntries, (presentationState, tile) => {
      const active =
        this.presentationEffectRenderer?.renderUnitEffectsForTile?.(presentationState, tile) ??
        false;
      hasActivePresentationEffects = hasActivePresentationEffects || active;
    });
    const primaryView = preparedViews.find(view => view.isPrimary) ?? preparedViews[0];
    if (this.fogOfWarEnabled && primaryView) this.fogRenderer.render(primaryView.state);
    forEachPaintTile((viewState, tile) => this.terrainRenderer.renderSpecial3(viewState, [tile]));
    forEachPaintTile((viewState, tile) =>
      this.terrainRenderer.renderTileLabels?.(viewState, [tile])
    );
    // CITYBAR is one source layer. For each tile Freeciv emits the city text
    // first, then that same tile's worked-output/unavailable sprites. Keeping
    // the operations adjacent is observable when a worked-cell sprite overlaps
    // a neighboring city bar, including across wrapped copies.
    // @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:449-472
    forEachPaintTile((viewState, tile) =>
      this.cityRenderer.renderCityOverlayEntries([{ state: viewState, tile }])
    );

    this.pathRenderer.renderPathLayerEntries(gotoEntries, (viewState, tile) => {
      const active =
        this.presentationEffectRenderer?.renderGotoEffectsForTile?.(viewState, tile) ?? false;
      hasActivePresentationEffects = hasActivePresentationEffects || active;
    });

    return hasActivePresentationEffects;
  }

  /** Paint the exact layer sequence declared by Hexemplio's native tilespec. */
  private renderNativeHexLayers(
    paintTileEntries: Array<{ state: RenderState; tile: Tile; presentationState: RenderState }>,
    renderEntries: Array<{ state: RenderState; tile: Tile }>,
    gotoEntries: Array<{ state: RenderState; tile: Tile }>
  ): boolean {
    const decorateFoggedTile = (_state: RenderState, tile: Tile, render: () => void) =>
      this.renderWithNativeAutoFog(tile, render);
    const presentationEntries = paintTileEntries.map(({ presentationState, tile }) => ({
      state: presentationState,
      tile,
    }));
    const forEachFoggedTile = (
      render: (state: RenderState, tile: Tile, presentationState: RenderState) => void
    ) => {
      for (const entry of paintTileEntries) {
        this.renderWithNativeAutoFog(entry.tile, () =>
          render(entry.state, entry.tile, entry.presentationState)
        );
      }
    };

    this.terrainRenderer.renderTerrainLayerEntries(renderEntries, 0, decorateFoggedTile);
    this.terrainRenderer.renderTerrainLayerEntries(renderEntries, 1, decorateFoggedTile);
    this.terrainRenderer.renderDarknessEntries(renderEntries, decorateFoggedTile);
    this.terrainRenderer.renderTerrainLayerEntries(renderEntries, 2, decorateFoggedTile);
    this.terrainRenderer.renderWaterEntries(renderEntries, decorateFoggedTile);
    this.terrainRenderer.renderRoadEntries(renderEntries, decorateFoggedTile);
    forEachFoggedTile((state, tile) => this.terrainRenderer.renderSpecials(state, [tile]));
    forEachFoggedTile((state, tile) => this.borderRenderer.render(state, [tile]));
    this.cityRenderer.renderCityEntries(renderEntries, decorateFoggedTile);
    forEachFoggedTile((state, tile) => this.terrainRenderer.renderSpecial2(state, [tile]));

    let hasActivePresentationEffects = false;
    this.unitRenderer.renderNonFocusedUnitLayerEntries(
      presentationEntries,
      (effectState, effectTile) => {
        const active =
          this.presentationEffectRenderer?.renderUnitEffectsForTile?.(effectState, effectTile) ??
          false;
        hasActivePresentationEffects = hasActivePresentationEffects || active;
      },
      decorateFoggedTile
    );
    forEachFoggedTile((state, tile) => this.terrainRenderer.renderSpecial3(state, [tile]));
    this.cityRenderer.renderWorkedTileOverlayEntries(renderEntries, decorateFoggedTile);
    // TILELABEL and CITYBAR are client text layers, intentionally outside Auto fog.
    for (const { state, tile } of renderEntries)
      this.terrainRenderer.renderTileLabels(state, [tile]);
    this.cityRenderer.renderCityBarEntries(renderEntries);
    this.unitRenderer.renderFocusedUnitLayerEntries(presentationEntries, decorateFoggedTile);
    this.pathRenderer.renderPathLayerEntries(gotoEntries, (state, tile) => {
      const active =
        this.presentationEffectRenderer?.renderGotoEffectsForTile?.(state, tile) ?? false;
      hasActivePresentationEffects = hasActivePresentationEffects || active;
    });
    return hasActivePresentationEffects;
  }

  /** GTK's Auto fog darkens each foggable sprite to 65% over known-unseen tiles. */
  private renderWithNativeAutoFog(tile: Tile, render: () => void): void {
    const shouldFog =
      this.fogOfWarEnabled &&
      this.tilesetLoader.getRenderProfile?.()?.fogStyle === 'auto' &&
      tile.known &&
      !tile.visible;
    if (!shouldFog) {
      render();
      return;
    }

    this.ctx.save();
    const previousFilter = this.ctx.filter;
    this.ctx.filter =
      previousFilter && previousFilter !== 'none'
        ? `${previousFilter} brightness(65%)`
        : 'brightness(65%)';
    render();
    this.ctx.restore();
  }

  /**
   * Render one canonical map copy through the same global layer compositor
   * used for wrapped copies. Kept as a focused seam for painter-order tests.
   */
  private renderMapLayers(state: RenderState, visibleTiles: Tile[]): boolean {
    return this.renderMapViews([{ state, visibleTiles, isPrimary: true }]);
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
    const geometry = this.tilesetLoader.getGeometry();
    const position = guiToMapPosition(
      guiX,
      guiY,
      this.tileWidth,
      this.tileHeight,
      geometry.hexWidth,
      geometry.hexHeight
    );
    return { mapX: position.x, mapY: position.y };
  }

  canvasToMap(canvasX: number, canvasY: number, viewport: MapViewport) {
    const guiX = canvasX + viewport.x;
    const guiY = canvasY + viewport.y;
    const tilesetGeometry = this.tilesetLoader.getGeometry();
    const native = guiToNativePosition(
      guiX,
      guiY,
      this.getCurrentGeometry(),
      this.tileWidth,
      this.tileHeight,
      tilesetGeometry.hexWidth,
      tilesetGeometry.hexHeight
    );
    return { mapX: native.x, mapY: native.y };
  }

  /**
   * Check if the viewport extends beyond finite map boundaries.
   *
   * This implements the boundary detection logic from freeciv-web to fix the diamond-shaped
   * map edges issue. When the viewport extends beyond map bounds, the uncovered
   * canvas pixels must be cleared to the reference client's black background.
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
  ): Array<{ viewport: MapViewport; visibleTiles: Tile[]; isPrimary: boolean }> {
    if (!this.isWrappedMap()) {
      return [
        { viewport, visibleTiles: this.getVisibleTiles(mapTiles, viewport, true), isPrimary: true },
      ];
    }

    const xPeriod = this.getGuiWrapPeriod('x');
    const yPeriod = this.getGuiWrapPeriod('y');
    const xOffsets = this.wrapHasFlag(MapRenderer.WRAP_X)
      ? this.getWrapOffsets(xPeriod, viewport)
      : [0];
    const yOffsets = this.wrapHasFlag(MapRenderer.WRAP_Y)
      ? this.getWrapOffsets(yPeriod, viewport)
      : [0];
    const views: Array<{ viewport: MapViewport; visibleTiles: Tile[]; isPrimary: boolean }> = [];

    for (const xOffset of xOffsets) {
      for (const yOffset of yOffsets) {
        const copyViewport = {
          ...viewport,
          x: viewport.x - xOffset * xPeriod.x - yOffset * yPeriod.x,
          y: viewport.y - xOffset * xPeriod.y - yOffset * yPeriod.y,
        };

        // Most entries in the conservative wrap-offset grid are entirely
        // outside the canvas. Reject them from projected map bounds before an
        // O(map-size) tile scan; the exact culler below still decides which
        // tiles from an intersecting copy are paintable.
        const isPrimary = xOffset === 0 && yOffset === 0;
        if (!isPrimary && !this.projectedMapIntersectsViewport(copyViewport)) continue;

        // Include unknown tiles when deciding whether a copy is needed. Fog
        // still has to cover a copy even when terrain itself is hidden.
        const copyTiles = this.getVisibleTiles(mapTiles, copyViewport, true);
        if (copyTiles.length === 0 && !isPrimary) continue;

        views.push({
          viewport: copyViewport,
          visibleTiles: copyTiles,
          isPrimary,
        });
      }
    }

    return views.length > 0
      ? views
      : [
          {
            viewport,
            visibleTiles: this.getVisibleTiles(mapTiles, viewport, true),
            isPrimary: true,
          },
        ];
  }

  private projectedMapIntersectsViewport(viewport: MapViewport): boolean {
    const bounds = getProjectedMapBounds(
      this.getCurrentGeometry(),
      this.tileWidth,
      this.tileHeight
    );
    const canvasWidth = this.ctx.canvas?.width || viewport.width;
    const canvasHeight = this.ctx.canvas?.height || viewport.height;
    const horizontalMargin = this.tileWidth;
    const verticalMargin = this.tileHeight * 2;

    return (
      bounds.right >= viewport.x - horizontalMargin &&
      bounds.left <= viewport.x + canvasWidth + horizontalMargin &&
      bounds.bottom >= viewport.y - verticalMargin &&
      bounds.top <= viewport.y + canvasHeight + verticalMargin
    );
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
   * Change the mapview origin, preserving finite-map positions and normalizing
   * only wrapped axes exactly as Freeciv does.
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:103-111
   * @param guiX0 - Proposed GUI X coordinate for viewport origin
   * @param guiY0 - Proposed GUI Y coordinate for viewport origin
   * @param _viewportWidth - Retained for the existing camera API
   * @param _viewportHeight - Retained for the existing camera API
   * @returns The finite origin or its wrapped-map equivalent
   */
  setMapviewOrigin(
    guiX0: number,
    guiY0: number,
    _viewportWidth: number = 800,
    _viewportHeight: number = 600
  ): { x: number; y: number } {
    // Retain the public camera signature. Freeciv's finite/wrapped origin
    // normalization itself is independent of viewport dimensions.
    void _viewportWidth;
    void _viewportHeight;
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

    // normalize_gui_pos() preserves the exact GUI pixel offset on finite maps;
    // there is no generic camera clamp in set_mapview_origin().
    // @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:103-181
    if ((this.currentMap.wrap_id ?? 0) === 0) {
      return { x: guiX0, y: guiY0 };
    }

    // For wrapping maps, use the full normalize_gui_pos logic
    const normalized = this.normalizeGuiPos(guiX0, guiY0);
    return { x: normalized.guiX, y: normalized.guiY };
  }

  /**
   * Set the scaling factors for different sprite types
   * @param resourceScale - Scale factor for resource sprites (0.1 to 2.0)
   * @param cityScale - Retained for API compatibility; city atlas pixels are native-sized.
   */
  setSpriteScales(resourceScale?: number, cityScale?: number) {
    // Resource sprites are drawn at their native atlas dimensions, matching
    // freeciv-web's mapview_put_tile(). Keep the argument for API compatibility.
    if (resourceScale !== undefined) {
      console.warn('Resource scale is fixed at the reference tileset size');
    }
    if (cityScale !== undefined) {
      console.warn('City scale is fixed at the reference tileset size');
    }
  }

  /**
   * Get current sprite scaling factors
   */
  getSpriteScales() {
    return {
      resourceScale: 1,
      cityScale: 1,
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
    this.mapTilesSource = null;
    this.mapTilesCache = [];
    this.nativeHexRowsSource = null;
    this.nativeHexRows = [];
    this.indexedTilesSource = null;
    this.tileByIndex.clear();
    this.tilesetLoader.setSpriteReadyListener?.(null);
    this.tilesetLoader.dispose();
    this.isInitialized = false;
  }

  private getVisibleTiles(mapTiles: Tile[], viewport: MapViewport, includeUnknown = false): Tile[] {
    const geometry = this.getCurrentGeometry();
    if (geometry.isIsometric && !geometry.isHex) {
      return this.getReferenceIsometricTiles(mapTiles, viewport, includeUnknown);
    }

    const usesNativeHexRows = usesNativeLogicalProjection(geometry.topologyId);
    const candidateTiles = usesNativeHexRows
      ? this.getNativeHexRowCandidates(mapTiles, viewport)
      : mapTiles;
    const tiles: Tile[] = [];
    const canvasWidth = this.ctx.canvas?.width || viewport.width;
    const canvasHeight = this.ctx.canvas?.height || viewport.height;
    // Tall terrain and overlay sprites extend beyond their tile bounding box.
    // Keep one tile of horizontal and two tiles of vertical overdraw around
    // the canvas so viewport culling cannot clip those sprites.
    const horizontalMargin = this.tileWidth;
    const verticalMargin = this.tileHeight * 2;

    for (const tile of candidateTiles) {
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

    // Native ISO-hex rows are already cached in painter order (native y/x).
    return usesNativeHexRows
      ? tiles
      : sortMapPointsInPainterOrder(tiles, this.currentMap.topology_id ?? 0);
  }

  /** Reuse the stable map snapshot while the camera produces many scroll frames. */
  private getMapTiles(tileRecord: GameState['map']['tiles']): Tile[] {
    if (this.mapTilesSource !== tileRecord) {
      this.mapTilesSource = tileRecord;
      this.mapTilesCache = Object.values(tileRecord);
    }
    return this.mapTilesCache;
  }

  /**
   * ISO-hex GUI Y is determined solely by native Y, while GUI X is a direct
   * affine projection of native X plus the row stagger. Restrict culling to
   * the native coordinate window that can intersect the canvas instead of
   * projecting the entire map on every drag frame. Rows retain y/x order.
   */
  private getNativeHexRowCandidates(mapTiles: Tile[], viewport: MapViewport): Tile[] {
    const mapWidth = this.currentMap.xsize ?? this.currentMap.width;
    const mapHeight = this.currentMap.ysize ?? this.currentMap.height;
    if (!mapWidth || !mapHeight || this.tileHeight <= 0) return mapTiles;

    if (this.nativeHexRowsSource !== mapTiles) {
      this.nativeHexRowsSource = mapTiles;
      this.nativeHexRows = Array.from({ length: mapHeight }, () => []);
      for (const tile of mapTiles) {
        if (tile.y >= 0 && tile.y < mapHeight) this.nativeHexRows[tile.y].push(tile);
      }
      for (const row of this.nativeHexRows) row.sort((left, right) => left.x - right.x);
    }

    const canvasWidth = this.ctx.canvas?.width || viewport.width;
    const canvasHeight = this.ctx.canvas?.height || viewport.height;
    const horizontalMargin = this.tileWidth;
    const verticalMargin = this.tileHeight * 2;
    const minimumGuiX = viewport.x - horizontalMargin - this.tileWidth;
    const maximumGuiX = viewport.x + canvasWidth + horizontalMargin;
    const minimumGuiY = viewport.y - verticalMargin - this.tileHeight;
    const maximumGuiY = viewport.y + canvasHeight + verticalMargin;
    // nativeToGuiPosition() gives guiY = (nativeY + mapWidth) * tileHeight / 2.
    // Keep a one-row numerical cushion around the exact inclusive bounds.
    const firstRow = Math.max(0, Math.floor((minimumGuiY * 2) / this.tileHeight - mapWidth) - 1);
    const lastRow = Math.min(
      mapHeight - 1,
      Math.ceil((maximumGuiY * 2) / this.tileHeight - mapWidth) + 1
    );
    if (firstRow > lastRow) return [];

    const candidates: Tile[] = [];
    for (let y = firstRow; y <= lastRow; y++) {
      // guiX = (2 * nativeX + rowParity - mapWidth) * tileWidth / 2.
      const rowParity = y & 1;
      const firstX = Math.max(
        0,
        Math.ceil(((minimumGuiX * 2) / this.tileWidth + mapWidth - rowParity) / 2) - 1
      );
      const lastX = Math.min(
        mapWidth - 1,
        Math.floor(((maximumGuiX * 2) / this.tileWidth + mapWidth - rowParity) / 2) + 1
      );
      const row = this.nativeHexRows[y];
      const start = this.lowerBoundTileX(row, firstX);
      const end = this.lowerBoundTileX(row, lastX + 1);
      candidates.push(...row.slice(start, end));
    }
    return candidates;
  }

  private lowerBoundTileX(row: readonly Tile[], x: number): number {
    let low = 0;
    let high = row.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (row[middle].x < x) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /**
   * Enumerate the finite ISO tile positions exactly as gui_rect_iterate().
   *
   * Bounding-box culling is tempting here, but it draws diagonal edge tiles
   * that the reference painter intentionally skips and changes which opaque
   * CELL_CORNER sprites win at the map boundary. The browser painter walks a
   * doubled-coordinate grid containing both tile and corner positions; this
   * helper retains only its actual tile positions, in painter order.
   *
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:305-374
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:215-219
   */
  private getReferenceIsometricTiles(
    mapTiles: Tile[],
    viewport: MapViewport,
    includeUnknown: boolean
  ): Tile[] {
    const mapWidth = this.currentMap.xsize ?? this.currentMap.width;
    const mapHeight = this.currentMap.ysize ?? this.currentMap.height;
    if (!mapWidth || !mapHeight) return [];

    const canvasWidth = this.ctx.canvas?.width || viewport.width;
    const canvasHeight = this.ctx.canvas?.height || viewport.height;
    if (this.indexedTilesSource !== mapTiles) {
      this.indexedTilesSource = mapTiles;
      this.tileByIndex = new Map(mapTiles.map(tile => [tile.x + tile.y * mapWidth, tile] as const));
    }
    const guiWidth = canvasWidth + (this.tileWidth >> 1);
    const guiHeight = canvasHeight + (this.tileHeight >> 1);
    let guiX0 = viewport.x;
    let guiY0 = viewport.y;
    let guiW = guiWidth;
    let guiH = guiHeight;

    if (guiW < 0) {
      guiX0 += guiW;
      guiW = -guiW;
    }
    if (guiH < 0) {
      guiY0 += guiH;
      guiH = -guiH;
    }
    if (guiW <= 0 || guiH <= 0) return [];

    const painterRadius = 2;
    const painterScale = painterRadius * 2;
    const referenceFloor = (numerator: number, denominator: number): number =>
      Math.trunc(numerator / denominator - (numerator < 0 && numerator % denominator < 0 ? 1 : 0));
    const painterX0 = referenceFloor(guiX0 * painterScale, this.tileWidth) - painterRadius / 2;
    const painterY0 = referenceFloor(guiY0 * painterScale, this.tileHeight) - painterRadius / 2;
    const painterX1 =
      referenceFloor((guiX0 + guiW) * painterScale + this.tileWidth - 1, this.tileWidth) +
      painterRadius;
    const painterY1 =
      referenceFloor((guiY0 + guiH) * painterScale + this.tileHeight - 1, this.tileHeight) +
      painterRadius;

    const firstX = Math.floor(painterX0);
    const firstY = Math.floor(painterY0);
    const lastX = Math.floor(painterX1);
    const lastY = Math.floor(painterY1);
    const tiles: Tile[] = [];

    for (let painterY = firstY; painterY < lastY; painterY += 1) {
      for (let painterX = firstX; painterX < lastX; painterX += 1) {
        const sum = painterX + painterY;
        if (sum % 2 !== 0) continue;
        if (this.currentMap.wrap_id === 0 && (sum <= 0 || sum / 4 > mapWidth)) {
          continue;
        }
        if (painterX % 2 !== 0 || painterY % 2 !== 0 || sum % 4 !== 0) {
          continue;
        }

        const mapX = sum / 4 - 1;
        const mapY = (painterY - painterX) / 4;
        let lookupY = mapY;
        if (mapX >= mapWidth) lookupY -= 1;
        else if (mapX < 0) lookupY += 1;
        const tileIndex = mapX + lookupY * mapWidth;
        const tile =
          tileIndex >= 0 && tileIndex < mapWidth * mapHeight
            ? this.tileByIndex.get(tileIndex)
            : undefined;

        if (tile?.terrain && (includeUnknown || !this.fogOfWarEnabled || tile.known)) {
          tiles.push(this.fogOfWarEnabled ? tile : { ...tile, visible: true, known: true });
        }
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
      this.currentGeometry.topologyId !== topologyId
    ) {
      this.currentGeometry = createMapGeometry(nativeWidth, nativeHeight, topologyId);
    }
    return this.currentGeometry;
  }
}
