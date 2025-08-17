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

  // Viewport management
  private viewport: ViewportConfig = {
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    zoom: 1.0,
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
   * Convert isometric coordinates to screen position
   * Based on Freeciv's map_to_gui_pos
   */
  public isoToScreen(tileX: number, tileY: number): { x: number; y: number } {
    const x = ((tileX - tileY) * this.tileWidth) / 2;
    const y = ((tileX + tileY) * this.tileHeight) / 2;
    return { x, y };
  }

  /**
   * Convert screen coordinates to isometric tile position
   * Based on Freeciv's gui_to_map_pos
   */
  public screenToIso(screenX: number, screenY: number): TilePosition {
    // Adjust for viewport offset and zoom
    const worldX = (screenX + this.viewport.x) / this.viewport.zoom;
    const worldY = (screenY + this.viewport.y) / this.viewport.zoom;

    // Convert to tile coordinates
    const tileX = Math.floor(
      (worldX / (this.tileWidth / 2) + worldY / (this.tileHeight / 2)) / 2
    );
    const tileY = Math.floor(
      (worldY / (this.tileHeight / 2) - worldX / (this.tileWidth / 2)) / 2
    );

    return { x: tileX, y: tileY };
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
    this.centerViewport();
  }

  /**
   * Center viewport on map
   */
  private centerViewport(): void {
    const centerTile = this.isoToScreen(this.mapWidth / 2, this.mapHeight / 2);
    this.viewport.x = centerTile.x - this.viewport.width / 2;
    this.viewport.y = centerTile.y - this.viewport.height / 2;
  }

  /**
   * Update viewport size when canvas resizes
   */
  public resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.bufferCanvas.width = width;
    this.bufferCanvas.height = height;
    this.viewport.width = width;
    this.viewport.height = height;

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
    // Clear buffer
    this.bufferCtx.fillStyle = '#000000';
    this.bufferCtx.fillRect(
      0,
      0,
      this.bufferCanvas.width,
      this.bufferCanvas.height
    );

    // Save context state
    this.bufferCtx.save();

    // Apply zoom and translation
    this.bufferCtx.scale(this.viewport.zoom, this.viewport.zoom);
    this.bufferCtx.translate(-this.viewport.x, -this.viewport.y);

    // Calculate visible tile range (with padding for partial tiles)
    const topLeft = this.screenToIso(0, 0);
    const bottomRight = this.screenToIso(
      this.viewport.width,
      this.viewport.height
    );

    const startX = Math.max(0, topLeft.x - 2);
    const endX = Math.min(this.mapWidth, bottomRight.x + 3);
    const startY = Math.max(0, topLeft.y - 2);
    const endY = Math.min(this.mapHeight, bottomRight.y + 3);

    // Render tiles in correct order for isometric view
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        if (this.terrainMap[y] && this.terrainMap[y][x]) {
          const terrain = this.terrainMap[y][x];
          const sprite = this.sprites.get(terrain);

          if (sprite) {
            const pos = this.isoToScreen(x, y);
            this.bufferCtx.drawImage(
              sprite.canvas,
              pos.x - sprite.width / 2,
              pos.y - 8 // Offset for isometric overlap
            );
          }
        }
      }
    }

    // Render game objects (units, cities) on top of terrain
    this.gameObjectLayer.render(this.bufferCtx, this.viewport);

    // Restore context state
    this.bufferCtx.restore();

    // Copy buffer to main canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.bufferCanvas, 0, 0);
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
   * Pan the viewport
   */
  public pan(dx: number, dy: number): void {
    this.viewport.x += dx / this.viewport.zoom;
    this.viewport.y += dy / this.viewport.zoom;
  }

  /**
   * Zoom the viewport
   */
  public zoom(factor: number, centerX: number, centerY: number): void {
    const oldZoom = this.viewport.zoom;
    this.viewport.zoom = Math.max(
      0.5,
      Math.min(2.0, this.viewport.zoom * factor)
    );

    // Adjust viewport to zoom around center point
    const zoomDiff = this.viewport.zoom - oldZoom;
    this.viewport.x += (centerX / oldZoom) * zoomDiff;
    this.viewport.y += (centerY / oldZoom) * zoomDiff;
  }

  /**
   * Center on a specific tile
   */
  public centerOnTile(tileX: number, tileY: number): void {
    const pos = this.isoToScreen(tileX, tileY);
    this.viewport.x = pos.x - this.viewport.width / (2 * this.viewport.zoom);
    this.viewport.y = pos.y - this.viewport.height / (2 * this.viewport.zoom);
  }

  /**
   * Get current viewport info
   */
  public getViewport(): ViewportConfig {
    return { ...this.viewport };
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.stopRenderLoop();
    this.sprites.clear();
  }
}
