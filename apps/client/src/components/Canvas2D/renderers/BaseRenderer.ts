/**
 * @module client/components/Canvas2D/renderers/BaseRenderer
 * Implements the Base Renderer canvas rendering stage.
 */
import type { MapViewport, Unit, City, GameState, PresentationEffect } from '../../../types';
import type { GotoPath } from '../../../services/PathfindingService';
import type { TilesetProvider } from '../tilesets/TilesetProvider';
import {
  createMapGeometry,
  mapToGuiPosition,
  nativeToGuiPosition,
  type MapGeometry,
} from '../mapTopologyGeometry';

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
  currentPlayerId?: string;
  researchedTechs?: ReadonlySet<string>;
  presentationEffects?: PresentationEffect[];
  reducedMotion?: boolean;
}

export abstract class BaseRenderer {
  protected ctx: CanvasRenderingContext2D;
  protected tilesetLoader: TilesetProvider;
  protected tileWidth: number;
  protected tileHeight: number;
  private terrainGraphics: Record<string, string> = {};
  private projection: MapGeometry = createMapGeometry(0, 0);

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
    const position = mapToGuiPosition(mapDx, mapDy, this.tileWidth, this.tileHeight);
    return { guiDx: position.x, guiDy: position.y };
  }

  /**
   * Convert map coordinates to screen coordinates.
   */
  protected mapToScreen(mapX: number, mapY: number, viewport: MapViewport) {
    const guiVector = nativeToGuiPosition(
      mapX,
      mapY,
      this.projection,
      this.tileWidth,
      this.tileHeight
    );
    return {
      x: guiVector.x - viewport.x,
      y: guiVector.y - viewport.y,
    };
  }

  /** Configure the authoritative native-coordinate projection for this frame. */
  setMapGeometry(map: GameState['map']): void {
    this.projection = createMapGeometry(
      map.xsize ?? map.width,
      map.ysize ?? map.height,
      map.topology_id ?? 0
    );
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
