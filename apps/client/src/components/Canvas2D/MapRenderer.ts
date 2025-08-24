/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GameState, MapViewport, Tile, Unit, City } from '../../types';
import { TilesetLoader } from './TilesetLoader';

interface RenderState {
  viewport: MapViewport;
  map: GameState['map'];
  units: GameState['units'];
  cities: GameState['cities'];
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private tileWidth = 96;
  private tileHeight = 48;

  // Tileset loader for sprite management
  private tilesetLoader: TilesetLoader;
  private isInitialized = false;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.tilesetLoader = new TilesetLoader();
    this.setupCanvas();
  }

  async initialize(serverUrl: string): Promise<void> {
    try {
      await this.tilesetLoader.loadTileset(serverUrl);

      const tileSize = this.tilesetLoader.getTileSize();
      this.tileWidth = tileSize.width;
      this.tileHeight = tileSize.height;

      this.isInitialized = true;
      console.log('MapRenderer initialized with tileset');
    } catch (error) {
      console.error('Failed to initialize MapRenderer:', error);
      throw error;
    }
  }

  private setupCanvas() {
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.font = '14px Arial, sans-serif';
  }

  render(state: RenderState) {
    this.clearCanvas();

    if (!this.isInitialized) {
      this.renderLoadingMessage();
      return;
    }

    // Check for freeciv-web global tiles array instead of state.map.tiles
    const globalTiles = (window as any).tiles;
    const globalMap = (window as any).map;

    if (
      !globalTiles ||
      !globalMap ||
      !Array.isArray(globalTiles) ||
      globalTiles.length === 0
    ) {
      this.renderEmptyMap();
      return;
    }

    const visibleTiles = this.getVisibleTilesFromGlobal(
      state.viewport,
      globalMap,
      globalTiles
    );

    for (const tile of visibleTiles) {
      this.renderTile(tile, state.viewport);
    }

    Object.values(state.units).forEach(unit => {
      if (this.isInViewport(unit.x, unit.y, state.viewport)) {
        this.renderUnit(unit, state.viewport);
      }
    });

    Object.values(state.cities).forEach(city => {
      if (this.isInViewport(city.x, city.y, state.viewport)) {
        this.renderCity(city, state.viewport);
      }
    });

    if (import.meta.env.DEV && this.isInitialized) {
      // Uncomment to see the diamond grid overlay
      // this.debugRenderGrid(state.viewport, true);
    }
  }

  private clearCanvas() {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

    this.ctx.fillStyle = '#4682B4';
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
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
    this.ctx.fillText(
      'Loading Tileset...',
      this.ctx.canvas.width / 2,
      this.ctx.canvas.height / 2
    );
  }

  private renderTile(tile: Tile, viewport: MapViewport) {
    const screenPos = this.mapToScreen(tile.x, tile.y, viewport);

    const terrainSprite = this.getTerrainSprite(tile.terrain);

    if (terrainSprite) {
      this.ctx.drawImage(
        terrainSprite,
        screenPos.x,
        screenPos.y,
        this.tileWidth * viewport.zoom,
        this.tileHeight * viewport.zoom
      );
    } else {
      const color = this.getTerrainColor(tile.terrain);
      this.ctx.fillStyle = color;
      this.ctx.fillRect(
        screenPos.x,
        screenPos.y,
        this.tileWidth * viewport.zoom,
        this.tileHeight * viewport.zoom
      );
    }

    // Draw tile borders in development mode for debugging
    if (import.meta.env.DEV) {
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(
        screenPos.x,
        screenPos.y,
        this.tileWidth * viewport.zoom,
        this.tileHeight * viewport.zoom
      );
    }
  }

  private renderUnit(unit: Unit, viewport: MapViewport) {
    const screenPos = this.mapToScreen(unit.x, unit.y, viewport);

    this.ctx.fillStyle = this.getPlayerColor(unit.playerId);
    this.ctx.beginPath();
    this.ctx.arc(
      screenPos.x + (this.tileWidth * viewport.zoom) / 2,
      screenPos.y + (this.tileHeight * viewport.zoom) / 2,
      8 * viewport.zoom,
      0,
      2 * Math.PI
    );
    this.ctx.fill();

    this.ctx.fillStyle = 'white';
    this.ctx.font = `${12 * viewport.zoom}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      unit.type.charAt(0).toUpperCase(),
      screenPos.x + (this.tileWidth * viewport.zoom) / 2,
      screenPos.y + (this.tileHeight * viewport.zoom) / 2 + 4
    );
  }

  private renderCity(city: City, viewport: MapViewport) {
    const screenPos = this.mapToScreen(city.x, city.y, viewport);

    this.ctx.fillStyle = this.getPlayerColor(city.playerId);
    this.ctx.fillRect(
      screenPos.x + 5,
      screenPos.y + 5,
      (this.tileWidth - 10) * viewport.zoom,
      (this.tileHeight - 10) * viewport.zoom
    );

    this.ctx.fillStyle = 'white';
    this.ctx.font = `${10 * viewport.zoom}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      city.name,
      screenPos.x + (this.tileWidth * viewport.zoom) / 2,
      screenPos.y - 5
    );

    this.ctx.fillText(
      city.size.toString(),
      screenPos.x + (this.tileWidth * viewport.zoom) / 2,
      screenPos.y + (this.tileHeight * viewport.zoom) / 2
    );
  }

  private mapToGuiVector(
    mapDx: number,
    mapDy: number
  ): { guiDx: number; guiDy: number } {
    const guiDx = ((mapDx - mapDy) * this.tileWidth) >> 1;
    const guiDy = ((mapDx + mapDy) * this.tileHeight) >> 1;
    return { guiDx, guiDy };
  }

  private guiToMapPos(
    guiX: number,
    guiY: number
  ): { mapX: number; mapY: number } {
    const W = this.tileWidth;
    const H = this.tileHeight;

    guiX -= W >> 1;

    const numeratorX = guiX * H + guiY * W;
    const numeratorY = guiY * W - guiX * H;
    const denominator = W * H;

    console.log(
      `Numerators: X=${numeratorX}, Y=${numeratorY}, denominator=${denominator}`
    );

    const mapX = this.divide(numeratorX, denominator);
    const mapY = this.divide(numeratorY, denominator);

    return { mapX, mapY };
  }

  private divide(n: number, d: number): number {
    if (d === 0) return 0;

    const result = Math.floor(n / d);
    return result;
  }

  private mapToScreen(mapX: number, mapY: number, viewport: MapViewport) {
    const guiVector = this.mapToGuiVector(mapX, mapY);
    return {
      x: (guiVector.guiDx - viewport.x) * viewport.zoom,
      y: (guiVector.guiDy - viewport.y) * viewport.zoom,
    };
  }

  canvasToMap(canvasX: number, canvasY: number, viewport: MapViewport) {
    const guiX = canvasX / viewport.zoom + viewport.x;
    const guiY = canvasY / viewport.zoom + viewport.y;
    const result = this.guiToMapPos(guiX, guiY);
    return result;
  }

  private isInViewport(
    mapX: number,
    mapY: number,
    viewport: MapViewport
  ): boolean {
    const screenPos = this.mapToScreen(mapX, mapY, viewport);
    return (
      screenPos.x + this.tileWidth * viewport.zoom >= 0 &&
      screenPos.x <= viewport.width &&
      screenPos.y + this.tileHeight * viewport.zoom >= 0 &&
      screenPos.y <= viewport.height
    );
  }

  private getTerrainColor(terrain: string): string {
    const colors: Record<string, string> = {
      grassland: '#90EE90',
      plains: '#DAA520',
      desert: '#F4A460',
      tundra: '#D3D3D3',
      forest: '#228B22',
      jungle: '#006400',
      hills: '#8B4513',
      mountains: '#696969',
      ocean: '#4682B4',
      swamp: '#556B2F',
    };

    return colors[terrain] || '#808080';
  }

  private getPlayerColor(playerId: string): string {
    const colors = [
      '#FF0000',
      '#0000FF',
      '#00FF00',
      '#FFFF00',
      '#FF00FF',
      '#00FFFF',
    ];
    const index = parseInt(playerId, 36) % colors.length;
    return colors[index];
  }

  private getTerrainSprite(terrain: string): HTMLCanvasElement | null {
    if (!this.isInitialized) return null;

    // Use proper terrain-specific sprites based on freeciv tileset
    const terrainSprites: Record<string, string> = {
      grassland: '0grassland_grassland', // Use grassland terrain sprite
      plains: '0plains_plains', // Use plains terrain sprite
      desert: '0desert_desert', // Use desert terrain sprite (confirmed available)
      ocean: '0ocean_ocean', // Use ocean terrain sprite
      forest: 't.l1.forest_n1e1s1w1', // Layer 1 forest (confirmed working)
      hills: 't.l1.hills_n1e1s1w1', // Layer 1 hills (confirmed working)
      mountains: 't.l1.mountains_n1e1s1w1', // Layer 1 mountains (confirmed working)
      jungle: 't.l1.jungle_n1e1s1w1', // Layer 1 jungle (should work)
      tundra: '0tundra_tundra', // Use tundra terrain sprite
      swamp: '0swamp_swamp', // Use swamp terrain sprite
    };

    const spriteTag = terrainSprites[terrain];
    if (spriteTag) {
      const sprite = this.tilesetLoader.getSprite(spriteTag);
      if (sprite) {
        return sprite;
      }
    }

    // Ultimate fallback - just use any available t.l0 sprite for isometric shape
    const availableSprites = this.tilesetLoader.getAvailableSprites();
    const anyTL0Sprite = availableSprites.find(s =>
      s.startsWith('t.l0.cellgroup')
    );
    if (anyTL0Sprite) {
      return this.tilesetLoader.getSprite(anyTL0Sprite);
    }

    return null;
  }

  debugCoordinateAccuracy(): void {
    if (!this.isInitialized) return;

    console.log('=== NEW COORDINATE DEBUG TEST v2 ===');
    console.log('Tile dimensions:', this.tileWidth, 'x', this.tileHeight);

    // Test simple case first
    console.log('Testing direct guiToMapPos with (0,0)');
    const result1 = this.guiToMapPos(0, 0);
    console.log('Result:', result1);

    console.log('Testing direct guiToMapPos with (48,24)');
    const result2 = this.guiToMapPos(48, 24);
    console.log('Result:', result2);
  }

  // Debug method to render diamond grid overlay
  debugRenderGrid(viewport: MapViewport, showTileNumbers = false): void {
    if (!this.isInitialized) return;

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    this.ctx.lineWidth = 1;
    this.ctx.font = '10px Arial';
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
          screenPos.x + (this.tileWidth * viewport.zoom) / 2,
          screenPos.y + (this.tileHeight * viewport.zoom) / 2,
          (this.tileWidth * viewport.zoom) / 2,
          (this.tileHeight * viewport.zoom) / 2
        );

        // Optionally draw tile coordinates
        if (showTileNumbers && viewport.zoom > 0.5) {
          this.ctx.fillText(
            `${x},${y}`,
            screenPos.x + (this.tileWidth * viewport.zoom) / 2,
            screenPos.y + (this.tileHeight * viewport.zoom) / 2
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
        });
      }
    }

    return tiles;
  }
}
