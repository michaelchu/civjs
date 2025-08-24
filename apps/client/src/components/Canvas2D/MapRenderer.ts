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
  // Amplio2 tileset dimensions (from freeciv-web tileset_config_amplio2.js)
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
      
      // Update tile dimensions from loaded tileset
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
    // Disable image smoothing for pixel-perfect rendering
    this.ctx.imageSmoothingEnabled = false;

    // Set font for text rendering
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
    
    if (!globalTiles || !globalMap || !Array.isArray(globalTiles) || globalTiles.length === 0) {
      this.renderEmptyMap();
      return;
    }

    // Calculate visible tile range using freeciv-web globals
    const visibleTiles = this.getVisibleTilesFromGlobal(state.viewport, globalMap, globalTiles);
    

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
    
    // Debug grid overlay in development
    if (import.meta.env.DEV && this.isInitialized) {
      // Uncomment to see the diamond grid overlay
      // this.debugRenderGrid(state.viewport, true);
    }
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

  // Port of freeciv-web's complex diamond-space tile iteration
  // Based on freeciv-web mapview_common.js lines 306-379
  private getVisibleTiles(
    viewport: MapViewport,
    map: GameState['map']
  ): Tile[] {
    // Always use simple method for debugging
    return this.getVisibleTilesSimple(viewport, map);
    
    if (!this.isInitialized) {
      return this.getVisibleTilesSimple(viewport, map);
    }
    
    const tiles: Tile[] = [];
    
    // Convert viewport bounds to GUI coordinates
    const guiX0 = viewport.x;
    const guiY0 = viewport.y;
    const guiXW = viewport.width + (this.tileWidth >> 1);
    const guiYH = viewport.height + (this.tileHeight >> 1);
    
    if (guiXW <= 0 || guiYH <= 0) {
      return tiles;
    }
    
    // Diamond-space bounds calculation (port of lines 324-333)
    const ptileR1 = 2;
    const ptileR2 = ptileR1 * 2;
    const ptileW = this.tileWidth;
    const ptileH = this.tileHeight;
    
    const ptileX0 = Math.floor(((guiX0 * ptileR2) / ptileW) - ptileR1 / 2);
    const ptileY0 = Math.floor(((guiY0 * ptileR2) / ptileH) - ptileR1 / 2);
    const ptileX1 = Math.floor((((guiX0 + guiXW) * ptileR2 + ptileW - 1) / ptileW) + ptileR1);
    const ptileY1 = Math.floor((((guiY0 + guiYH) * ptileR2 + ptileH - 1) / ptileH) + ptileR1);
    
    const ptileCount = (ptileX1 - ptileX0) * (ptileY1 - ptileY0);
    
    // Diamond-space iteration ensures proper back-to-front rendering
    for (let ptileIndex = 0; ptileIndex < ptileCount; ptileIndex++) {
      const ptileXi = ptileX0 + (ptileIndex % (ptileX1 - ptileX0));
      const ptileYi = Math.floor(ptileY0 + (ptileIndex / (ptileX1 - ptileX0)));
      const ptileSi = ptileXi + ptileYi;
      const ptileDi = ptileYi - ptileXi;
      
      // Skip non-diamond positions
      if ((ptileXi + ptileYi) % 2 !== 0) {
        continue;
      }
      
      if (ptileXi % 2 === 0 && ptileYi % 2 === 0) {
        if ((ptileXi + ptileYi) % 4 === 0) {
          // This is a tile position in diamond space
          const mapX = Math.floor((ptileSi / 4) - 1);
          const mapY = Math.floor(ptileDi / 4);
          
          // Bounds check and get tile
          if (this.isInMapBounds(mapX, mapY, map)) {
            const tileKey = `${mapX},${mapY}`;
            const tile = map.tiles[tileKey];
            if (tile) {
              tiles.push(tile);
            }
          }
        }
      }
    }
    
    return tiles;
  }
  
  // EXACT freeciv-web tile iteration (copied from mapview_common.js lines 306-379)
  private getVisibleTilesSimple(
    viewport: MapViewport,
    map: GameState['map']
  ): Tile[] {
    const tiles: Tile[] = [];
    
    // Exact copy from freeciv-web gui_rect_iterate logic
    const gui_x0 = viewport.x;
    const gui_y0 = viewport.y;
    const width = viewport.width || 800;
    const height = viewport.height || 600;
    
    //gui_rect_iterate begin
    let gui_x_0 = gui_x0;
    let gui_y_0 = gui_y0;
    let gui_x_w = width + (this.tileWidth >> 1);  // tileset_tile_width
    let gui_y_h = height + (this.tileHeight >> 1); // tileset_tile_height
    
    if (gui_x_w < 0) {
      gui_x_0 += gui_x_w;
      gui_x_w = -gui_x_w;
    }
    
    if (gui_y_h < 0) {
      gui_y_0 += gui_y_h;
      gui_y_h = -gui_y_h;
    }
    
    if (gui_x_w > 0 && gui_y_h > 0) {
      const ptile_r1 = 2;
      const ptile_r2 = ptile_r1 * 2;
      const ptile_w = this.tileWidth;  // tileset_tile_width
      const ptile_h = this.tileHeight; // tileset_tile_height
      
      // Exact freeciv-web complex coordinate calculations with all edge case handling
      const ptile_x0 = Math.floor(((gui_x_0 * ptile_r2) / ptile_w - (((gui_x_0 * ptile_r2) < 0 && (gui_x_0 * ptile_r2) % ptile_w < 0) ? 1 : 0)) - ptile_r1 / 2);
      const ptile_y0 = Math.floor(((gui_y_0 * ptile_r2) / ptile_h - (((gui_y_0 * ptile_r2) < 0 && (gui_y_0 * ptile_r2) % ptile_h < 0) ? 1 : 0)) - ptile_r1 / 2);
      const ptile_x1 = Math.floor(((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1) / ptile_w - ((((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1) < 0 && ((gui_x_0 + gui_x_w) * ptile_r2 + ptile_w - 1) % ptile_w < 0) ? 1 : 0)) + ptile_r1;
      const ptile_y1 = Math.floor(((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1) / ptile_h - ((((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1) < 0 && ((gui_y_0 + gui_y_h) * ptile_r2 + ptile_h - 1) % ptile_h < 0) ? 1 : 0)) + ptile_r1;
      const ptile_count = (ptile_x1 - ptile_x0) * (ptile_y1 - ptile_y0);
      
      
      for (let ptile_index = 0; ptile_index < ptile_count; ptile_index++) {
        const ptile_xi = ptile_x0 + (ptile_index % (ptile_x1 - ptile_x0));
        const ptile_yi = Math.floor(ptile_y0 + (ptile_index / (ptile_x1 - ptile_x0)));
        const ptile_si = ptile_xi + ptile_yi;
        const ptile_di = ptile_yi - ptile_xi;
        
        // Exact freeciv-web conditions
        if ((ptile_xi + ptile_yi) % 2 !== 0) {
          continue;
        }
        
        // Skip wrapping check for now (flat earth logic: map['wrap_id'] == 0)
        const mapXSize = (map as any).xsize || map.width;
        const mapWrapId = (map as any).wrap_id || 0;
        if (mapWrapId === 0 && (ptile_si <= 0 || ((ptile_si / 4)) > mapXSize)) {
          continue;  // Skip if flat earth without wrapping.
        }
        
        if (ptile_xi % 2 === 0 && ptile_yi % 2 === 0) {
          if ((ptile_xi + ptile_yi) % 4 === 0) {
            /* Tile */ 
            // Exact freeciv-web map_pos_to_tile conversion: map_pos_to_tile((ptile_si / 4) - 1, (ptile_di / 4))
            let mapX = Math.floor((ptile_si / 4) - 1);
            let mapY = Math.floor(ptile_di / 4);
            
            // Apply freeciv-web map_pos_to_tile wrapping logic
            if (mapX >= map.width) {
              mapY -= 1;
            } else if (mapX < 0) {
              mapY += 1;
            }
            
            
            // Use freeciv-web tile array access: tiles[x + y * map['xsize']]
            const mapXSize = (map as any).xsize || map.width;
            const mapYSize = (map as any).ysize || map.height;
            if (mapX >= 0 && mapX < mapXSize && mapY >= 0 && mapY < mapYSize) {
              let tile = null;
              
              // Try freeciv-web array format first (most compatible)
              const arrayIndex = mapX + mapY * mapXSize;
              
              if ((map as any).tilesArray) {
                tile = (map as any).tilesArray[arrayIndex];
              }
              
              // Also try global tiles variable (exact freeciv-web compatibility)
              if (!tile && (window as any).tiles) {
                tile = (window as any).tiles[arrayIndex];
              }
              
              // Fallback to our object format  
              if (!tile) {
                const tileKey = `${mapX},${mapY}`;
                tile = map.tiles[tileKey];
              }
              
              if (tile) {
                tiles.push(tile);
              }
            }
          }
        }
      }
    }
    return tiles;
  }
  
  private isInMapBounds(x: number, y: number, map: GameState['map']): boolean {
    return x >= 0 && x < map.width && y >= 0 && y < map.height;
  }

  private renderTile(tile: Tile, viewport: MapViewport) {
    const screenPos = this.mapToScreen(tile.x, tile.y, viewport);

    // Try to get the terrain sprite first
    const terrainSprite = this.getTerrainSprite(tile.terrain);
    
    if (terrainSprite) {
      // Render actual freeciv sprite
      this.ctx.drawImage(
        terrainSprite,
        screenPos.x,
        screenPos.y,
        this.tileWidth * viewport.zoom,
        this.tileHeight * viewport.zoom
      );
    } else {
      // Fallback to colored rectangle if sprite not found
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

  // Port of freeciv-web's map_to_gui_vector() - isometric transformation
  private mapToGuiVector(mapDx: number, mapDy: number): { guiDx: number; guiDy: number } {
    const guiDx = ((mapDx - mapDy) * this.tileWidth) >> 1;
    const guiDy = ((mapDx + mapDy) * this.tileHeight) >> 1;
    return { guiDx, guiDy };
  }

  // Port of freeciv-web's gui_to_map_pos() - reverse isometric transformation
  private guiToMapPos(guiX: number, guiY: number): { mapX: number; mapY: number } {
    const W = this.tileWidth;
    const H = this.tileHeight;
    
    console.log(`guiToMapPos input: gui(${guiX}, ${guiY}), tile(${W}, ${H})`);
    
    // Critical half-tile offset for isometric projection
    guiX -= W >> 1;
    console.log(`After half-tile offset: gui(${guiX}, ${guiY})`);
    
    // Isometric coordinate math using freeciv's DIVIDE function
    const numeratorX = guiX * H + guiY * W;
    const numeratorY = guiY * W - guiX * H;
    const denominator = W * H;
    
    console.log(`Numerators: X=${numeratorX}, Y=${numeratorY}, denominator=${denominator}`);
    
    const mapX = this.divide(numeratorX, denominator);
    const mapY = this.divide(numeratorY, denominator);
    
    console.log(`Final result: map(${mapX}, ${mapY})`);
    return { mapX, mapY };
  }
  
  // Port of freeciv-web's DIVIDE function - handles negative numbers correctly
  private divide(n: number, d: number): number {
    if (d === 0) return 0; // Prevent division by zero
    
    const result = Math.floor(n / d);
    console.log(`DIVIDE(${n}, ${d}) = ${result}`);
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
    console.log(`canvasToMap input: canvas(${canvasX}, ${canvasY}), viewport(${viewport.x}, ${viewport.y}), zoom(${viewport.zoom})`);
    const guiX = canvasX / viewport.zoom + viewport.x;
    const guiY = canvasY / viewport.zoom + viewport.y;
    console.log(`Converted to gui: (${guiX}, ${guiY})`);
    const result = this.guiToMapPos(guiX, guiY);
    console.log(`canvasToMap final result:`, result);
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
    // Simple color mapping - this should come from player data
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
      'grassland': '0grassland_grassland',       // Use grassland terrain sprite
      'plains': '0plains_plains',               // Use plains terrain sprite  
      'desert': '0desert_desert',               // Use desert terrain sprite (confirmed available)
      'ocean': '0ocean_ocean',                  // Use ocean terrain sprite
      'forest': 't.l1.forest_n1e1s1w1',        // Layer 1 forest (confirmed working)
      'hills': 't.l1.hills_n1e1s1w1',          // Layer 1 hills (confirmed working)
      'mountains': 't.l1.mountains_n1e1s1w1',  // Layer 1 mountains (confirmed working)
      'jungle': 't.l1.jungle_n1e1s1w1',        // Layer 1 jungle (should work)
      'tundra': '0tundra_tundra',               // Use tundra terrain sprite
      'swamp': '0swamp_swamp',                  // Use swamp terrain sprite
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
    const anyTL0Sprite = availableSprites.find(s => s.startsWith('t.l0.cellgroup'));
    if (anyTL0Sprite) {
      return this.tilesetLoader.getSprite(anyTL0Sprite);
    }
    
    return null;
  }

  // Debug method to test coordinate accuracy
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
        if (screenPos.x < -this.tileWidth || screenPos.x > viewport.width + this.tileWidth ||
            screenPos.y < -this.tileHeight || screenPos.y > viewport.height + this.tileHeight) {
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
  
  private drawDiamond(centerX: number, centerY: number, halfWidth: number, halfHeight: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(centerX, centerY - halfHeight); // Top
    this.ctx.lineTo(centerX + halfWidth, centerY);   // Right
    this.ctx.lineTo(centerX, centerY + halfHeight);  // Bottom
    this.ctx.lineTo(centerX - halfWidth, centerY);   // Left
    this.ctx.closePath();
    this.ctx.stroke();
  }

  cleanup() {
    this.tilesetLoader.cleanup();
    this.isInitialized = false;
  }

  private getVisibleTilesFromGlobal(
    viewport: MapViewport,
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
          resource: tile.resource || undefined
        });
      }
    }
    
    return tiles;
  }
}
