/**
 * Canvas2D Renderer - Pure canvas implementation inspired by Freeciv-web
 * Replaces Phaser.js with direct canvas rendering for better performance
 */

import type { TerrainType } from '../game/TerrainService';
import { GameObjectLayer } from './GameObjectLayer';
import type { Unit, City } from './GameObjectLayer';

export interface Sprite {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

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

export class Canvas2DRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bufferCanvas: HTMLCanvasElement;
  private bufferCtx: CanvasRenderingContext2D;

  // Sprite cache - similar to Freeciv's approach
  private sprites: Map<string, Sprite> = new Map();
  private tileWidth = 64;
  private tileHeight = 32;

  // Freeciv-style viewport management
  private viewport: ViewportConfig = {
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    zoom: 1.0,
  };

  // Freeciv mapview state
  private mapview = {
    gui_x0: 0,
    gui_y0: 0,
    width: 800,
    height: 600,
    store_width: 800,
    store_height: 600,
  };

  // Map data
  private terrainMap: TerrainType[][] = [];
  private mapWidth = 0;
  private mapHeight = 0;

  // Animation and rendering
  private animationFrameId: number | null = null;
  private lastRenderTime = 0;
  private renderInterval = 16; // ~60fps

  // Game object layer for units and cities
  private gameObjectLayer: GameObjectLayer;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;

    // Create buffer canvas for double buffering (Freeciv technique)
    this.bufferCanvas = document.createElement('canvas');
    this.bufferCanvas.width = canvas.width;
    this.bufferCanvas.height = canvas.height;
    const bufferCtx = this.bufferCanvas.getContext('2d');
    if (!bufferCtx) throw new Error('Failed to get buffer context');
    this.bufferCtx = bufferCtx;

    // Disable image smoothing for pixel-perfect rendering
    this.ctx.imageSmoothingEnabled = false;
    this.bufferCtx.imageSmoothingEnabled = false;

    this.initializeSprites();

    // Initialize game object layer
    this.gameObjectLayer = new GameObjectLayer(this);
  }

  /**
   * Initialize terrain sprites - creates cached canvases for each terrain type
   * Similar to Freeciv's init_cache_sprites
   */
  private initializeSprites(): void {
    const terrainTypes: TerrainType[] = [
      'ocean',
      'coast',
      'grassland',
      'plains',
      'desert',
      'tundra',
      'forest',
      'hills',
      'mountains',
    ];

    terrainTypes.forEach(terrain => {
      const sprite = this.createTerrainSprite(terrain);
      this.sprites.set(terrain, sprite);
    });
  }

  /**
   * Create a cached sprite for a terrain type
   */
  private createTerrainSprite(terrain: TerrainType): Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = this.tileWidth;
    canvas.height = this.tileHeight + 16; // Extra height for isometric overlap
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create sprite context');

    // Draw isometric diamond shape
    ctx.save();
    ctx.translate(this.tileWidth / 2, 8);

    // Set terrain color
    ctx.fillStyle = this.getTerrainColor(terrain);

    // Draw isometric tile
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(this.tileWidth / 2, this.tileHeight / 2);
    ctx.lineTo(0, this.tileHeight);
    ctx.lineTo(-this.tileWidth / 2, this.tileHeight / 2);
    ctx.closePath();
    ctx.fill();

    // Add border for clarity
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();

    return {
      canvas,
      width: this.tileWidth,
      height: this.tileHeight + 16,
    };
  }

  /**
   * Get color for terrain type
   */
  private getTerrainColor(terrain: TerrainType): string {
    const colors: Record<TerrainType, string> = {
      ocean: '#006994',
      coast: '#4A90A4',
      grassland: '#7CBA3D',
      plains: '#C4A57B',
      desert: '#F2E7AE',
      tundra: '#BFBFBF',
      forest: '#228B22',
      hills: '#8B7355',
      mountains: '#8B7D6B',
    };
    return colors[terrain] || '#808080';
  }

  /**
   * Convert map coordinates to GUI coordinates - Freeciv's map_to_gui_vector
   */
  private mapToGuiVector(
    mapX: number,
    mapY: number
  ): { gui_dx: number; gui_dy: number } {
    const gui_dx = ((mapX - mapY) * this.tileWidth) >> 1;
    const gui_dy = ((mapX + mapY) * this.tileHeight) >> 1;
    return { gui_dx, gui_dy };
  }

  /**
   * Convert isometric coordinates to screen position - Freeciv's map_to_gui_pos
   */
  public isoToScreen(tileX: number, tileY: number): { x: number; y: number } {
    const result = this.mapToGuiVector(tileX, tileY);
    return { x: result.gui_dx, y: result.gui_dy };
  }

  /**
   * Convert screen coordinates to isometric tile position - Freeciv's gui_to_map_pos
   */
  public screenToIso(screenX: number, screenY: number): TilePosition {
    // Convert screen coordinates to GUI coordinates
    const gui_x = screenX + this.mapview.gui_x0;
    const gui_y = screenY + this.mapview.gui_y0;

    // Freeciv's exact conversion formula
    const W = this.tileWidth;
    const H = this.tileHeight;

    const adjusted_gui_x = gui_x - (W >> 1);
    const map_x = this.divide(adjusted_gui_x * H + gui_y * W, W * H);
    const map_y = this.divide(gui_y * W - adjusted_gui_x * H, W * H);

    return { x: map_x, y: map_y };
  }

  /**
   * Integer division that rounds towards negative infinity (like Freeciv's DIVIDE)
   */
  private divide(a: number, b: number): number {
    return Math.floor(a / b);
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
    console.log(
      `Terrain map dimensions: ${terrainMap.length} rows, ${terrainMap[0]?.length || 0} cols`
    );

    this.centerViewport();
  }

  /**
   * Center viewport on map - Freeciv style
   */
  private centerViewport(): void {
    // Center on the middle of the map
    const centerMapX = Math.floor(this.mapWidth / 2);
    const centerMapY = Math.floor(this.mapHeight / 2);
    const centerGui = this.mapToGuiVector(centerMapX, centerMapY);

    // Position the viewport so this tile is in the center of the screen
    this.mapview.gui_x0 = centerGui.gui_dx - this.mapview.width / 2;
    this.mapview.gui_y0 = centerGui.gui_dy - this.mapview.height / 2;

    console.log(
      `Centering on map tile (${centerMapX}, ${centerMapY}) -> GUI (${centerGui.gui_dx}, ${centerGui.gui_dy})`
    );
    console.log(
      `Setting gui_x0=${this.mapview.gui_x0}, gui_y0=${this.mapview.gui_y0}`
    );

    this.normalizeMapviewOrigin();
  }

  /**
   * Update viewport size when canvas resizes - Freeciv style
   */
  public resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    // Freeciv uses a larger buffer for smooth scrolling
    this.bufferCanvas.width = Math.floor(width * 1.5);
    this.bufferCanvas.height = Math.floor(height * 1.5);

    this.viewport.width = width;
    this.viewport.height = height;

    // Update Freeciv mapview state
    this.mapview.width = width;
    this.mapview.height = height;
    this.mapview.store_width = width;
    this.mapview.store_height = height;

    // Re-apply settings
    this.ctx.imageSmoothingEnabled = false;
    this.bufferCtx.imageSmoothingEnabled = false;
  }

  /**
   * Main render loop - uses requestAnimationFrame like Freeciv
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
   * Main render function - draws visible tiles to buffer then copies to main canvas
   */
  private render(): void {
    // Clear main canvas
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Save context state
    this.ctx.save();

    // Freeciv-style rendering directly to main canvas
    this.updateMapCanvas(0, 0, this.mapview.width, this.mapview.height);

    // Render game objects (units, cities) on top of terrain
    this.gameObjectLayer.render(this.ctx, this.viewport);

    // Restore context state
    this.ctx.restore();
  }

  /**
   * Set units to render
   */
  public setUnits(units: Unit[]): void {
    this.gameObjectLayer.setUnits(units);
  }

  /**
   * Set cities to render
   */
  public setCities(cities: City[]): void {
    this.gameObjectLayer.setCities(cities);
  }

  /**
   * Pan the viewport - Freeciv style
   */
  public pan(dx: number, dy: number): void {
    this.mapview.gui_x0 += dx;
    this.mapview.gui_y0 += dy;
    this.normalizeMapviewOrigin();

    // Debug logging
    console.log(
      `Pan: dx=${dx}, dy=${dy}, gui_x0=${this.mapview.gui_x0}, gui_y0=${this.mapview.gui_y0}`
    );
  }

  /**
   * Normalize mapview origin to prevent overflow - simplified version of Freeciv's normalize_gui_pos
   */
  private normalizeMapviewOrigin(): void {
    // Keep values reasonable to prevent integer overflow
    const maxOffset = this.mapWidth * this.tileWidth * 2;

    this.mapview.gui_x0 = Math.max(
      -maxOffset,
      Math.min(maxOffset, this.mapview.gui_x0)
    );
    this.mapview.gui_y0 = Math.max(
      -maxOffset,
      Math.min(maxOffset, this.mapview.gui_y0)
    );
  }

  /**
   * Freeciv's update_map_canvas - simplified for debugging
   */
  private updateMapCanvas(
    canvas_x: number,
    canvas_y: number,
    width: number,
    height: number
  ): void {
    const gui_x0 = this.mapview.gui_x0 + canvas_x;
    const gui_y0 = this.mapview.gui_y0 + canvas_y;

    console.log(
      `updateMapCanvas: gui_x0=${gui_x0}, gui_y0=${gui_y0}, size=${width}x${height}`
    );

    // Clear background
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(canvas_x, canvas_y, width, height);

    // Calculate screen bounds to fill rectangular viewport with minimal padding
    const topLeft = this.screenToIso(-this.tileWidth, -this.tileHeight);
    const topRight = this.screenToIso(width + this.tileWidth, -this.tileHeight);
    const bottomLeft = this.screenToIso(
      -this.tileWidth,
      height + this.tileHeight
    );
    const bottomRight = this.screenToIso(
      width + this.tileWidth,
      height + this.tileHeight
    );

    // Find the bounding box of tiles that intersect the rectangular screen
    const minX = Math.max(
      0,
      Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x) - 2
    );
    const maxX = Math.min(
      this.mapWidth - 1,
      Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x) + 2
    );
    const minY = Math.max(
      0,
      Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y) - 2
    );
    const maxY = Math.min(
      this.mapHeight - 1,
      Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y) + 2
    );

    // Only render tiles in the calculated range
    for (let map_y = minY; map_y <= maxY; map_y++) {
      for (let map_x = minX; map_x <= maxX; map_x++) {
        // Check if the tile would actually appear on screen
        const gui_pos = this.mapToGuiVector(map_x, map_y);
        const canvas_x = gui_pos.gui_dx - gui_x0;
        const canvas_y = gui_pos.gui_dy - gui_y0;

        // Only draw if tile overlaps with the rectangular screen area
        if (
          canvas_x > -this.tileWidth &&
          canvas_x < width + this.tileWidth &&
          canvas_y > -this.tileHeight &&
          canvas_y < height + this.tileHeight
        ) {
          this.drawTileAt(map_x, map_y, gui_x0, gui_y0);
        }
      }
    }
  }

  /**
   * Draw a single tile at map coordinates
   */
  private drawTileAt(
    map_x: number,
    map_y: number,
    gui_x0: number,
    gui_y0: number
  ): void {
    if (this.terrainMap[map_y] && this.terrainMap[map_y][map_x]) {
      const terrain = this.terrainMap[map_y][map_x];
      const sprite = this.sprites.get(terrain);

      if (sprite) {
        const gui_pos = this.mapToGuiVector(map_x, map_y);
        const canvas_x = gui_pos.gui_dx - gui_x0;
        const canvas_y = gui_pos.gui_dy - gui_y0;

        this.ctx.drawImage(
          sprite.canvas,
          canvas_x - sprite.width / 2,
          canvas_y - 8
        );
      }
    }
  }

  /**
   * Zoom the viewport
   */
  public zoom(factor: number, centerX: number, centerY: number): void {
    const oldZoom = this.viewport.zoom;
    const newZoom = Math.max(0.5, Math.min(2.0, this.viewport.zoom * factor));

    if (newZoom === this.viewport.zoom) return; // No zoom change

    // Calculate world position at center point
    const worldX = (centerX + this.viewport.x) / oldZoom;
    const worldY = (centerY + this.viewport.y) / oldZoom;

    // Update zoom
    this.viewport.zoom = newZoom;

    // Adjust viewport to keep center point fixed
    this.viewport.x = worldX * newZoom - centerX;
    this.viewport.y = worldY * newZoom - centerY;

    // Clamp viewport to map bounds
    this.clampViewport();
  }

  /**
   * Center on a specific tile - Freeciv style
   */
  public centerOnTile(tileX: number, tileY: number): void {
    const gui_pos = this.mapToGuiVector(tileX, tileY);
    this.mapview.gui_x0 = gui_pos.gui_dx - this.mapview.width / 2;
    this.mapview.gui_y0 = gui_pos.gui_dy - this.mapview.height / 2;
    this.normalizeMapviewOrigin();
  }

  /**
   * Get current viewport info
   */
  public getViewport(): ViewportConfig {
    return { ...this.viewport };
  }

  /**
   * Clamp viewport to map boundaries (with generous padding)
   */
  private clampViewport(): void {
    if (this.mapWidth === 0 || this.mapHeight === 0) return;

    // Calculate map center and rough dimensions
    const mapCenterX = (this.mapWidth * this.tileWidth) / 2;
    const mapCenterY = (this.mapHeight * this.tileHeight) / 2;
    const mapExtentX = this.mapWidth * this.tileWidth;
    const mapExtentY = this.mapHeight * this.tileHeight;

    // Allow generous padding around map (2x map size)
    const padding = Math.max(mapExtentX, mapExtentY);

    this.viewport.x = Math.max(
      -mapCenterX - padding,
      Math.min(mapCenterX + padding, this.viewport.x)
    );

    this.viewport.y = Math.max(
      -mapCenterY - padding,
      Math.min(mapCenterY + padding, this.viewport.y)
    );
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.stopRenderLoop();
    this.sprites.clear();
  }
}
