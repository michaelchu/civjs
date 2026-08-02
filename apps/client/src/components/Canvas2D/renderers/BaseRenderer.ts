/**
 * @module client/components/Canvas2D/renderers/BaseRenderer
 * Implements the Base Renderer canvas rendering stage.
 */
import type { MapViewport, Unit, City, GameState, PresentationEffect } from '../../../types';
import type { AccessibleTile, GotoPath } from '../../../services/PathfindingService';
import type { TilesetProvider } from '../tilesets/TilesetProvider';

export interface RenderState {
  viewport: MapViewport;
  map: GameState['map'];
  units: Record<string, Unit>;
  cities: Record<string, City>;
  players: Record<string, { color: string; name: string; nation: string; nationGraphic?: string }>; // Player data for border colors and validation
  selectedUnitId?: string | null;
  selectedCityId?: string | null;
  /** Local presentation equivalent of freeciv's pending action decision. */
  actionDecisionUnitId?: string | null;
  focusedUnits?: string[];
  urgentFocusQueue?: string[];
  gotoPath?: GotoPath | null;
  movementRange?: AccessibleTile[];
  movementRangeOrigin?: { x: number; y: number };
  currentPlayerId?: string;
  researchedTechs?: ReadonlySet<string>;
  presentationEffects?: PresentationEffect[];
  reducedMotion?: boolean;
  /** Matches freeciv-web's show_unit_movepct option, disabled by default. */
  showUnitMovePoints?: boolean;
}

export abstract class BaseRenderer {
  protected ctx: CanvasRenderingContext2D;
  protected tilesetLoader: TilesetProvider;
  protected tileWidth: number;
  protected tileHeight: number;
  private terrainGraphics: Record<string, string> = {};

  constructor(
    ctx: CanvasRenderingContext2D,
    tilesetLoader: TilesetProvider,
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
    const width = this.ctx.canvas?.width || viewport.width;
    const height = this.ctx.canvas?.height || viewport.height;
    // Unit and city sprites extend above and beside the tile diamond. Match
    // terrain culling's overdraw so a sprite is not removed while part of it
    // is still visible, and prefer the current backing buffer during resize.
    const horizontalMargin = this.tileWidth;
    const verticalMargin = this.tileHeight * 2;

    return (
      screenPos.x + this.tileWidth >= -horizontalMargin &&
      screenPos.x <= width + horizontalMargin &&
      screenPos.y + this.tileHeight >= -verticalMargin &&
      screenPos.y <= height + verticalMargin
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
    const authoritativeGraphic = this.terrainGraphics[terrain];
    if (authoritativeGraphic) return authoritativeGraphic;
    const terrainMap: Record<string, string> = {
      // Water terrains
      ocean: 'coast',
      deep_ocean: 'floor',
      coast: 'coast',
      lake: 'coast', // Lake uses coast graphics as fallback (matches freeciv-web behavior)
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

  setTerrainGraphics(graphics: Record<string, string>): void {
    this.terrainGraphics = graphics;
  }

  /**
   * Update tile dimensions if they change.
   */
  updateTileSize(tileWidth: number, tileHeight: number): void {
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
  }
}
