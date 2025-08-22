import type { GameState, MapViewport, Tile, Unit, City } from '../../types';

interface RenderState {
  viewport: MapViewport;
  map: GameState['map'];
  units: GameState['units'];
  cities: GameState['cities'];
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private tileWidth = 64;
  private tileHeight = 32;
  
  // Sprite cache - will be populated when we add tileset loading
  private sprites: Record<string, HTMLCanvasElement> = {};

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.setupCanvas();
  }

  private setupCanvas() {
    // Disable image smoothing for pixel-perfect rendering
    this.ctx.imageSmoothingEnabled = false;
    
    // Set font for text rendering
    this.ctx.font = '14px Arial, sans-serif';
  }

  render(state: RenderState) {
    this.clearCanvas();
    
    if (!state.map.tiles || Object.keys(state.map.tiles).length === 0) {
      this.renderEmptyMap();
      return;
    }

    // Calculate visible tile range
    const visibleTiles = this.getVisibleTiles(state.viewport, state.map);
    
    // Render tiles
    for (const tile of visibleTiles) {
      this.renderTile(tile, state.viewport);
    }
    
    // Render units
    Object.values(state.units).forEach(unit => {
      if (this.isInViewport(unit.x, unit.y, state.viewport)) {
        this.renderUnit(unit, state.viewport);
      }
    });
    
    // Render cities
    Object.values(state.cities).forEach(city => {
      if (this.isInViewport(city.x, city.y, state.viewport)) {
        this.renderCity(city, state.viewport);
      }
    });
  }

  private clearCanvas() {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    
    // Fill with ocean color as background
    this.ctx.fillStyle = '#4682B4';
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  private renderEmptyMap() {
    // Render placeholder grid for development
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
    
    // Draw "No Map Data" message
    this.ctx.fillStyle = 'white';
    this.ctx.font = '24px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      'No Map Data - Connect to Server',
      this.ctx.canvas.width / 2,
      this.ctx.canvas.height / 2
    );
  }

  private getVisibleTiles(viewport: MapViewport, map: GameState['map']): Tile[] {
    const tiles: Tile[] = [];
    
    // Calculate visible tile bounds (with some padding)
    const startX = Math.max(0, Math.floor(viewport.x / this.tileWidth) - 2);
    const endX = Math.min(map.width, Math.ceil((viewport.x + viewport.width) / this.tileWidth) + 2);
    const startY = Math.max(0, Math.floor(viewport.y / this.tileHeight) - 2);
    const endY = Math.min(map.height, Math.ceil((viewport.y + viewport.height) / this.tileHeight) + 2);
    
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tileKey = `${x},${y}`;
        const tile = map.tiles[tileKey];
        if (tile) {
          tiles.push(tile);
        }
      }
    }
    
    return tiles;
  }

  private renderTile(tile: Tile, viewport: MapViewport) {
    const screenPos = this.mapToScreen(tile.x, tile.y, viewport);
    
    // For now, render simple colored squares based on terrain
    const color = this.getTerrainColor(tile.terrain);
    
    this.ctx.fillStyle = color;
    this.ctx.fillRect(
      screenPos.x,
      screenPos.y,
      this.tileWidth * viewport.zoom,
      this.tileHeight * viewport.zoom
    );
    
    // Draw tile borders in development mode
    this.ctx.strokeStyle = '#333333';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(
      screenPos.x,
      screenPos.y,
      this.tileWidth * viewport.zoom,
      this.tileHeight * viewport.zoom
    );
  }

  private renderUnit(unit: Unit, viewport: MapViewport) {
    const screenPos = this.mapToScreen(unit.x, unit.y, viewport);
    
    // Render unit as colored circle for now
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
    
    // Add unit type indicator
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
    
    // Render city as square
    this.ctx.fillStyle = this.getPlayerColor(city.playerId);
    this.ctx.fillRect(
      screenPos.x + 5,
      screenPos.y + 5,
      (this.tileWidth - 10) * viewport.zoom,
      (this.tileHeight - 10) * viewport.zoom
    );
    
    // City name
    this.ctx.fillStyle = 'white';
    this.ctx.font = `${10 * viewport.zoom}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      city.name,
      screenPos.x + (this.tileWidth * viewport.zoom) / 2,
      screenPos.y - 5
    );
    
    // City size
    this.ctx.fillText(
      city.size.toString(),
      screenPos.x + (this.tileWidth * viewport.zoom) / 2,
      screenPos.y + (this.tileHeight * viewport.zoom) / 2
    );
  }

  private mapToScreen(mapX: number, mapY: number, viewport: MapViewport) {
    return {
      x: (mapX * this.tileWidth - viewport.x) * viewport.zoom,
      y: (mapY * this.tileHeight - viewport.y) * viewport.zoom,
    };
  }

  canvasToMap(canvasX: number, canvasY: number, viewport: MapViewport) {
    return {
      x: Math.floor((canvasX / viewport.zoom + viewport.x) / this.tileWidth),
      y: Math.floor((canvasY / viewport.zoom + viewport.y) / this.tileHeight),
    };
  }

  private isInViewport(mapX: number, mapY: number, viewport: MapViewport): boolean {
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
    // Simple color mapping - this should come from player data
    const colors = ['#FF0000', '#0000FF', '#00FF00', '#FFFF00', '#FF00FF', '#00FFFF'];
    const index = parseInt(playerId, 36) % colors.length;
    return colors[index];
  }

  cleanup() {
    // Cleanup resources if needed
  }
}