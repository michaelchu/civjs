/**
 * Isometric Renderer - Advanced isometric tile rendering system
 * Based on proven isometric rendering techniques for strategy games
 */

import type { TerrainType } from '../types/terrain';

// Import renderer modules
import * as MapView from '../renderer/2dcanvas/mapview';
import * as MapViewCommon from '../renderer/2dcanvas/mapview_common';
import * as MapCtrl from '../renderer/2dcanvas/mapctrl';
import * as TilesetConfig from '../renderer/2dcanvas/tileset_config_amplio2';
import { setActionButtonCallback, canvas_pos_to_tile } from '../renderer/types';

export interface TilePosition {
  x: number;
  y: number;
}

export interface ViewportConfig {
  width: number;
  height: number;
  x: number;
  y: number;
  zoom: number;
}

export interface RendererCallbacks {
  onTileClick?: (x: number, y: number) => void;
  onUnitSelect?: (unitId: string) => void;
  onRightClick?: (x: number, y: number) => void;
}

export class IsometricRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bufferCanvas: HTMLCanvasElement;
  private bufferCtx: CanvasRenderingContext2D;

  // Map data
  private terrainMap: TerrainType[][] = [];
  private mapWidth = 0;
  private mapHeight = 0;

  // Animation and rendering
  private animationFrameId: number | null = null;
  private lastRenderTime = 0;
  private renderInterval = 16; // ~60fps

  // Zoom state
  private zoomLevel = 1.0;
  private minZoom = 0.5;
  private maxZoom = 3.0;

  // Game object layer for units and cities
  // private gameObjectLayer: GameObjectLayer;

  // Renderer state - connect to global state
  private isDragging = false;

  // Callbacks for React integration
  private callbacks: RendererCallbacks;

  constructor(canvas: HTMLCanvasElement, callbacks: RendererCallbacks = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;
    this.callbacks = callbacks;

    // Create buffer canvas for double buffering (Isometric technique)
    this.bufferCanvas = document.createElement('canvas');
    this.bufferCanvas.width = canvas.width;
    this.bufferCanvas.height = canvas.height;
    const bufferCtx = this.bufferCanvas.getContext('2d');
    if (!bufferCtx) throw new Error('Failed to get buffer context');
    this.bufferCtx = bufferCtx;

    // Disable image smoothing for pixel-perfect rendering
    this.ctx.imageSmoothingEnabled = false;
    this.bufferCtx.imageSmoothingEnabled = false;

    // Initialize renderer systems
    this.initRendererSystems();

    // Initialize game object layer
    // this.gameObjectLayer = new GameObjectLayer(this);

    // Set up callback for action button (tile clicks)
    setActionButtonCallback((x: number, y: number, type: string) => {
      // Convert screen coordinates to tile coordinates
      const tile = canvas_pos_to_tile(x, y);

      if (type === 'SELECT_POPUP' && this.callbacks.onTileClick) {
        this.callbacks.onTileClick(tile.x, tile.y);
      }
    });

    // Initialize mouse controls
    this.initMouseControls();
  }

  /**
   * Initialize rendering and control systems
   */
  private initRendererSystems(): void {
    // Set up global canvas references using setter functions
    MapView.set_mapview_canvas(this.canvas);
    MapView.set_mapview_canvas_ctx(this.ctx);
    MapView.set_buffer_canvas(this.bufferCanvas);
    MapView.set_buffer_canvas_ctx(this.bufferCtx);

    // Set up mapview configuration
    MapViewCommon.mapview.width = this.canvas.width;
    MapViewCommon.mapview.height = this.canvas.height;
    MapViewCommon.mapview.store_width = this.canvas.width;
    MapViewCommon.mapview.store_height = this.canvas.height;

    // Initialize procedural sprites
    MapView.init_sprites();

    console.log(
      'Renderer systems initialized with',
      Object.keys(MapView.sprites).length,
      'sprites'
    );
  }

  /**
   * Initialize mouse control system
   */
  private initMouseControls(): void {
    // Event bindings
    this.canvas.addEventListener('mouseup', e => this.handleMouseUp(e));
    this.canvas.addEventListener('mousedown', e => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', e => this.handleMouseMove(e));
    this.canvas.addEventListener('wheel', e => this.handleWheel(e), {
      passive: false,
    });

    // Touch device support
    this.canvas.addEventListener('touchstart', e =>
      MapCtrl.mapview_touch_start(e)
    );
    this.canvas.addEventListener('touchend', e => MapCtrl.mapview_touch_end(e));
    this.canvas.addEventListener('touchmove', e =>
      MapCtrl.mapview_touch_move(e)
    );

    // Prevent context menu on right click
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Make canvas focusable to capture wheel events reliably
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.focus();
  }

  /**
   * Handle mouse up events
   */
  private handleMouseUp(e: MouseEvent): void {
    MapCtrl.update_mouse_position(e, this.canvas);

    // Stop dragging
    this.isDragging = false;

    MapCtrl.mapview_mouse_click(e);
  }

  /**
   * Handle mouse down events
   */
  private handleMouseDown(e: MouseEvent): void {
    MapCtrl.update_mouse_position(e, this.canvas);

    // Start dragging for left mouse button
    if (e.button === 0) {
      this.isDragging = true;
      MapCtrl.set_touch_start_x(MapCtrl.mouse_x);
      MapCtrl.set_touch_start_y(MapCtrl.mouse_y);
    }

    MapCtrl.mapview_mouse_down(e);
  }

  /**
   * Handle mouse move events
   */
  private handleMouseMove(e: MouseEvent): void {
    MapCtrl.update_mouse_position(e, this.canvas);

    // Panning logic - use our local isDragging state
    if (this.isDragging) {
      const diff_x = MapCtrl.touch_start_x - MapCtrl.mouse_x;
      const diff_y = MapCtrl.touch_start_y - MapCtrl.mouse_y;

      // Update mapview position
      MapViewCommon.mapview.gui_x0 += diff_x;
      MapViewCommon.mapview.gui_y0 += diff_y;

      // Update start position for next frame
      MapCtrl.set_touch_start_x(MapCtrl.mouse_x);
      MapCtrl.set_touch_start_y(MapCtrl.mouse_y);

      console.log(
        `Pan: diff (${diff_x}, ${diff_y}) -> gui_x0=${MapViewCommon.mapview.gui_x0}, gui_y0=${MapViewCommon.mapview.gui_y0}`
      );
    }
  }

  /**
   * Handle mouse wheel events for zooming
   */
  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    e.stopPropagation();

    // Get mouse position for zoom center
    const rect = this.canvas.getBoundingClientRect();
    const centerX = e.clientX - rect.left;
    const centerY = e.clientY - rect.top;

    // Zoom factor based on wheel direction (smaller steps for smoother zoom)
    const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;

    console.log(`Wheel event: deltaY=${e.deltaY}, factor=${zoomFactor}`);

    this.zoom(zoomFactor, centerX, centerY);
  }

  /**
   * Set the terrain map data
   */
  public setTerrainMap(
    terrainMap: TerrainType[][],
    width: number,
    height: number
  ): void {
    this.terrainMap = terrainMap;
    this.mapWidth = width;
    this.mapHeight = height;

    console.log(`Set terrain map: ${width}x${height} tiles`);

    // Center the viewport
    this.centerViewport();
  }

  /**
   * Center viewport
   */
  private centerViewport(): void {
    const centerMapX = Math.floor(this.mapWidth / 2);
    const centerMapY = Math.floor(this.mapHeight / 2);

    // Create tile object for centering function
    const centerTile = { x: centerMapX, y: centerMapY };
    MapViewCommon.center_tile_mapcanvas_2d(centerTile);

    console.log(`Center: tile (${centerMapX},${centerMapY})`);
  }

  /**
   * Update viewport size when canvas resizes
   */
  public resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.bufferCanvas.width = Math.floor(width * 1.5);
    this.bufferCanvas.height = Math.floor(height * 1.5);

    // Update mapview state
    MapViewCommon.mapview.width = width;
    MapViewCommon.mapview.height = height;
    MapViewCommon.mapview.store_width = width;
    MapViewCommon.mapview.store_height = height;

    // Re-apply settings
    this.ctx.imageSmoothingEnabled = false;
    this.bufferCtx.imageSmoothingEnabled = false;

    console.log(`Resized to ${width}x${height}, mapview updated`);
  }

  /**
   * Main render loop
   */
  public startRenderLoop(): void {
    const render = (timestamp: number) => {
      if (timestamp - this.lastRenderTime >= this.renderInterval) {
        this.render();
        this.lastRenderTime = timestamp;
      }
      this.animationFrameId = requestAnimationFrame(render);
    };
    this.animationFrameId = requestAnimationFrame(render);
  }

  /**
   * Stop the render loop
   */
  public stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Main render function
   */
  private render(): void {
    // Check sprites are initialized
    if (!MapView.sprites_init) {
      MapView.init_cache_sprites();
    }

    // Clear main canvas
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply zoom transformation
    this.ctx.save();
    this.ctx.scale(this.zoomLevel, this.zoomLevel);

    // Use update_map_canvas approach
    // For now, we'll implement a simplified version that renders our terrain
    this.renderTerrainMap();

    // Render game objects (units, cities) on top of terrain
    // this.gameObjectLayer.render(this.ctx, this.getViewport());

    // Restore transformation
    this.ctx.restore();
  }

  /**
   * Render terrain map using update_map_canvas algorithm
   */
  private renderTerrainMap(): void {
    // Calculate expanded viewport to account for zoom level
    // When zoomed out, we need to render more tiles to fill the screen
    const zoomExpansion = 1 / this.zoomLevel;

    // Add extra buffer to prevent edge culling - especially important for isometric
    const bufferMultiplier = 1.5;
    const expandedWidth = Math.floor(
      MapViewCommon.mapview.width * zoomExpansion * bufferMultiplier
    );
    const expandedHeight = Math.floor(
      MapViewCommon.mapview.height * zoomExpansion * bufferMultiplier
    );

    // Calculate offset to center the expanded viewport
    const offsetX = Math.floor(
      (expandedWidth - MapViewCommon.mapview.width) / 2
    );
    const offsetY = Math.floor(
      (expandedHeight - MapViewCommon.mapview.height) / 2
    );

    // Use complete update_map_canvas implementation with expanded viewport
    MapViewCommon.update_map_canvas(
      -offsetX,
      -offsetY,
      expandedWidth,
      expandedHeight,
      this.ctx,
      this.terrainMap,
      this.mapWidth,
      this.mapHeight
    );
  }

  /**
   * Set units to render
   */
  public setUnits(units: any[]): void {
    // this.gameObjectLayer.setUnits(units);
    console.log('Units updated:', units.length);
  }

  /**
   * Set cities to render
   */
  public setCities(cities: any[]): void {
    // this.gameObjectLayer.setCities(cities);
    console.log('Cities updated:', cities.length);
  }

  /**
   * Get current viewport info
   */
  public getViewport(): ViewportConfig {
    return {
      width: MapViewCommon.mapview.width,
      height: MapViewCommon.mapview.height,
      x: MapViewCommon.mapview.gui_x0,
      y: MapViewCommon.mapview.gui_y0,
      zoom: 1.0,
    };
  }

  /**
   * Convert screen coordinates to isometric tile position
   */
  public screenToIso(screenX: number, screenY: number): TilePosition {
    // Use coordinate conversion
    const gui_x = screenX + MapViewCommon.mapview.gui_x0;
    const gui_y = screenY + MapViewCommon.mapview.gui_y0;

    // This would use gui_to_map_pos function
    // For now, implement basic conversion
    const tileWidth = TilesetConfig.tileset_tile_width;
    const tileHeight = TilesetConfig.tileset_tile_height;

    const adjusted_gui_x = gui_x - (tileWidth >> 1);
    const map_x = Math.floor(
      (adjusted_gui_x * tileHeight + gui_y * tileWidth) /
        (tileWidth * tileHeight)
    );
    const map_y = Math.floor(
      (gui_y * tileWidth - adjusted_gui_x * tileHeight) /
        (tileWidth * tileHeight)
    );

    return { x: map_x, y: map_y };
  }

  /**
   * Center camera on a specific tile
   */
  public centerOnTile(x: number, y: number): void {
    const centerTile = { x, y };
    MapViewCommon.center_tile_mapcanvas_2d(centerTile);
    console.log(`Center: tile (${x},${y})`);
  }

  /**
   * Pan the viewport by delta values (for mouse controller compatibility)
   */
  public pan(deltaX: number, deltaY: number): void {
    MapViewCommon.mapview.gui_x0 += deltaX;
    MapViewCommon.mapview.gui_y0 += deltaY;
  }

  /**
   * Zoom functionality
   */
  public zoom(factor: number, centerX?: number, centerY?: number): void {
    const newZoom = this.zoomLevel * factor;

    // Clamp zoom level
    if (newZoom < this.minZoom || newZoom > this.maxZoom) {
      return;
    }

    // If zoom center is provided, adjust viewport to keep that point under the mouse
    if (centerX !== undefined && centerY !== undefined) {
      // Calculate the world position at the zoom center before zoom
      const oldZoom = this.zoomLevel;
      const worldX = centerX / oldZoom + MapViewCommon.mapview.gui_x0 / oldZoom;
      const worldY = centerY / oldZoom + MapViewCommon.mapview.gui_y0 / oldZoom;

      // Update zoom level
      this.zoomLevel = newZoom;

      // Recalculate viewport position to keep the same world point under the mouse
      MapViewCommon.mapview.gui_x0 = worldX * newZoom - centerX;
      MapViewCommon.mapview.gui_y0 = worldY * newZoom - centerY;
    } else {
      this.zoomLevel = newZoom;
    }

    console.log(
      `Zoom: ${this.zoomLevel.toFixed(2)} at (${centerX}, ${centerY})`
    );
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.stopRenderLoop();
  }
}
