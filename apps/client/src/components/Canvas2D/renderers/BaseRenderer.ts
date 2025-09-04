import type { MapViewport, Unit, City } from '../../../types';
import type { GotoPath } from '../../../services/PathfindingService';
import type { TilesetLoader } from '../TilesetLoader';

export interface RenderState {
  viewport: MapViewport;
  map: unknown; // Global map object
  units: Record<string, Unit>;
  cities: Record<string, City>;
  selectedUnitId?: string | null;
  gotoPath?: GotoPath | null;
}

export abstract class BaseRenderer {
  protected ctx: CanvasRenderingContext2D;
  protected tilesetLoader: TilesetLoader;
  protected tileWidth: number;
  protected tileHeight: number;

  constructor(
    ctx: CanvasRenderingContext2D,
    tilesetLoader: TilesetLoader,
    tileWidth: number,
    tileHeight: number
  ) {
    this.ctx = ctx;
    this.tilesetLoader = tilesetLoader;
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
  }

  /**
   * Convert map coordinates to GUI (isometric) coordinates.
   */
  protected mapToGuiVector(mapDx: number, mapDy: number): { guiDx: number; guiDy: number } {
    const guiDx = ((mapDx - mapDy) * this.tileWidth) >> 1;
    const guiDy = ((mapDx + mapDy) * this.tileHeight) >> 1;
    return { guiDx, guiDy };
  }

  /**
   * Convert map coordinates to screen coordinates.
   */
  protected mapToScreen(mapX: number, mapY: number, viewport: MapViewport) {
    const guiVector = this.mapToGuiVector(mapX, mapY);
    return {
      x: guiVector.guiDx - viewport.x,
      y: guiVector.guiDy - viewport.y,
    };
  }

  /**
   * Check if a tile at map coordinates is visible in the viewport.
   */
  protected isInViewport(mapX: number, mapY: number, viewport: MapViewport): boolean {
    const screenPos = this.mapToScreen(mapX, mapY, viewport);
    return (
      screenPos.x + this.tileWidth >= 0 &&
      screenPos.x <= viewport.width &&
      screenPos.y + this.tileHeight >= 0 &&
      screenPos.y <= viewport.height
    );
  }

  /**
   * Get player color by ID.
   */
  protected getPlayerColor(playerId: string): string {
    const colors = ['#FF0000', '#0000FF', '#00FF00', '#FFFF00', '#FF00FF', '#00FFFF'];
    const index = parseInt(playerId, 36) % colors.length;
    return colors[index];
  }

  /**
   * Map terrain names to freeciv graphics names (from terrain.ruleset).
   */
  protected mapTerrainName(terrain: string): string {
    const terrainMap: Record<string, string> = {
      // Water terrains
      ocean: 'coast',
      deep_ocean: 'floor',
      coast: 'coast',
      lake: 'lake',
      // Land terrains
      grassland: 'grassland',
      plains: 'plains',
      desert: 'desert',
      forest: 'forest',
      hills: 'hills',
      mountains: 'mountains',
      tundra: 'tundra',
      swamp: 'swamp',
      jungle: 'jungle',
      arctic: 'arctic',
      inaccessible: 'inaccessible',
    };

    return terrainMap[terrain] || terrain;
  }

  /**
   * Update tile dimensions if they change.
   */
  updateTileSize(tileWidth: number, tileHeight: number): void {
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
  }
}
