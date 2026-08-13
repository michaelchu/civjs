/**
 * @module client/components/Canvas2D/renderers/CityRenderer
 * Implements the City Renderer canvas rendering stage.
 */
import type { City, MapViewport, Tile } from '../../../types';
import { BaseRenderer, type RenderState } from './BaseRenderer';
import type { CityStyle, GraphicDefinition, NationStyle } from '../../../services/RulesetService';
import { resolveCityGraphic } from '../../../services/PresentationResolver';
import { sortMapPointsInPainterOrder } from '../mapTopologyGeometry';

export interface CityRenderEntry {
  state: RenderState;
  tile: Tile;
}

/**
 * CityRenderer - Authentic Freeciv-compliant city sprite rendering
 *
 * This implementation ports the city sprite system directly from Freeciv to ensure
 * visual and behavioral compatibility with the reference implementation.
 *
 * City Sprite System Reference:
 * - freeciv/data/civ2civ3/styles.ruleset: Defines all city styles and their graphics
 * - freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js: get_city_sprite() function
 * - freeciv/client/tilespec.c: get_city_sprite() and city sprite loading system
 *
 * Supported City Styles (from styles.ruleset):
 * 1. European - Default western style
 * 2. Classical - Roman/Greek architecture
 * 3. Tropical - Warm climate architecture
 * 4. Asian - Eastern architectural style
 * 5. Babylonian - Ancient middle eastern
 * 6. Celtic - Northern European tribal
 * 7. Industrial - Unlocked with Railroad tech
 * 8. ElectricAge - Unlocked with Automobile tech
 * 9. Modern - Unlocked with Rocketry tech
 * 10. PostModern - Most advanced architectural style
 *
 * City Size Thresholds (from freeciv-web):
 * - Size 0: Population 1-3 (smallest cities)
 * - Size 1: Population 4-7 (small cities)
 * - Size 2: Population 8-11 (medium cities)
 * - Size 3: Population 12-15 (large cities)
 * - Size 4: Population 16+ (largest cities)
 *
 * Sprite Format: "{graphic}_{type}_{size}" where:
 * - graphic: city.european, city.classical, etc.
 * - type: "city" for normal cities, "wall" for cities with walls
 * - size: 0-4 based on population thresholds
 *
 * Examples: "city.european_city_0", "city.asian_wall_3", etc.
 */
export class CityRenderer extends BaseRenderer {
  private static readonly CITY_SPRITE_OFFSET = { offset_x: -4, offset_y: -24 };
  private static readonly CITYBAR_OFFSET = { x: 45, y: 55 };
  private cityStyles: Record<string, CityStyle> = {};
  private nationStyleDefinitions: Record<string, NationStyle> = {};
  private nationStyles: Record<string, string> = {};
  private unitGraphics: Record<string, GraphicDefinition> = {};
  private buildingGraphics: Record<string, GraphicDefinition> = {};

  /**
   * Initialize city styles from ruleset
   */
  setCityStyles(
    cityStyles: Record<string, CityStyle>,
    nationStyleDefinitions: Record<string, NationStyle>,
    nationStyles: Record<string, string>
  ): void {
    this.cityStyles = cityStyles;
    this.nationStyleDefinitions = nationStyleDefinitions;
    this.nationStyles = nationStyles;
  }

  /** Supply the same ruleset graphic catalogue used by Freeciv's city bar. */
  setProductionGraphics(
    units: Record<string, GraphicDefinition>,
    buildings: Record<string, GraphicDefinition>
  ): void {
    this.unitGraphics = units;
    this.buildingGraphics = buildings;
  }

  /**
   * Render all cities visible in the viewport.
   * After initialization, this is synchronous for better performance.
   */
  renderCities(state: RenderState, visibleTiles?: Tile[]): void {
    this.renderCityEntries(
      this.getOrderedVisibleTiles(state, visibleTiles).map(tile => ({ state, tile }))
    );
  }

  /** Paint CITY1 for one globally ordered tile/copy walk. */
  renderCityEntries(entries: readonly CityRenderEntry[]): void {
    const first = entries[0];
    if (!first) return;
    const cityByPosition = this.indexCities(first.state);

    for (const { state, tile } of entries) {
      if (!tile.known || !this.isInViewport(tile.x, tile.y, state.viewport)) continue;
      const city = cityByPosition.get(`${tile.x},${tile.y}`);
      if (city) this.renderCitySprite(city, state.viewport, state);
    }
  }

  /** Paint city-bar and worked-tile presentation on the reference CITYBAR layer. */
  renderCityOverlays(state: RenderState, visibleTiles?: Tile[]): void {
    this.renderCityOverlayEntries(
      this.getOrderedVisibleTiles(state, visibleTiles).map(tile => ({ state, tile }))
    );
  }

  /** Paint CITYBAR for one globally ordered tile/copy walk. */
  renderCityOverlayEntries(entries: readonly CityRenderEntry[]): void {
    const first = entries[0];
    if (!first) return;
    const selectedCity = first.state.selectedCityId
      ? first.state.cities[first.state.selectedCityId]
      : undefined;
    const workableByPosition = new Map(
      (selectedCity?.workableTiles ?? []).map(tile => [`${tile.x},${tile.y}`, tile] as const)
    );
    const cityByPosition = this.indexCities(first.state);

    for (const { state, tile } of entries) {
      if (!tile.known || !this.isInViewport(tile.x, tile.y, state.viewport)) continue;

      const city = cityByPosition.get(`${tile.x},${tile.y}`);
      if (city) {
        this.renderCityBar(city, this.mapToScreen(city.x, city.y, state.viewport), state);
      }

      const workable = workableByPosition.get(`${tile.x},${tile.y}`);
      if (workable) {
        this.renderWorkedTileOutput(workable, state.viewport);
      }
    }
  }

  private getOrderedVisibleTiles(state: RenderState, visibleTiles?: Tile[]): Tile[] {
    return (
      visibleTiles ??
      sortMapPointsInPainterOrder(Object.values(state.map.tiles), state.map.topology_id ?? 0)
    );
  }

  private indexCities(state: RenderState): Map<string, City> {
    return new Map(Object.values(state.cities).map(city => [`${city.x},${city.y}`, city] as const));
  }

  private renderCitySprite(city: City, viewport: MapViewport, state: RenderState): void {
    const screenPos = this.mapToScreen(city.x, city.y, viewport);

    // Get city sprite based on size and nation
    const citySprites = this.getCitySprites(city, state);
    let spriteRendered = false;

    // Draw every atlas entry at native size and at its source offset.
    for (const spriteInfo of citySprites) {
      const sprite = this.tilesetLoader.getSprite(spriteInfo.key);
      if (sprite) {
        this.ctx.drawImage(
          sprite,
          screenPos.x + (spriteInfo.offset_x ?? CityRenderer.CITY_SPRITE_OFFSET.offset_x),
          screenPos.y + (spriteInfo.offset_y ?? CityRenderer.CITY_SPRITE_OFFSET.offset_y)
        );
        spriteRendered = true;
      }
    }

    // The fallback is diagnostic only; the canonical atlas always contains
    // each ruleset-resolved city sprite.
    if (!spriteRendered) {
      this.renderCityFallback(city, screenPos);
    }
  }

  private renderWorkedTileOutput(
    tile: NonNullable<City['workableTiles']>[number],
    viewport: MapViewport
  ): void {
    const screen = this.mapToScreen(tile.x, tile.y, viewport);
    if (tile.isBlocked && !tile.isWorked) {
      const unavailable = this.tilesetLoader.getSprite('grid.unavailable');
      if (unavailable) this.ctx.drawImage(unavailable, screen.x, screen.y);
      return;
    }
    if (!tile.isWorked) return;

    const outputSprites = [
      `city.t_food_${this.encodeOutput(tile.outputs.food)}`,
      `city.t_shields_${this.encodeOutput(tile.outputs.shields)}`,
      `city.t_trade_${this.encodeOutput(tile.outputs.trade)}`,
    ];
    for (const key of outputSprites) {
      const sprite = this.tilesetLoader.getSprite(key);
      if (sprite) {
        this.ctx.drawImage(sprite, screen.x + this.tileWidth / 4, screen.y - this.tileHeight / 4);
      }
    }
  }

  private encodeOutput(value: number): string {
    return Math.max(0, Math.floor(value)).toString(36).toUpperCase();
  }

  /**
   * Get city sprites based on city properties
   * Reference: freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js get_city_sprite()
   * Reference: freeciv/data/civ2civ3/styles.ruleset citystyle definitions
   */
  private getCitySprites(
    city: City,
    state: RenderState
  ): Array<{ key: string; offset_x?: number; offset_y?: number }> {
    const sprites: Array<{ key: string; offset_x?: number; offset_y?: number }> = [];

    // Get authentic Freeciv city style based on player's nation and tech
    const cityStyleGraphic = city.presentation?.graphic ?? this.getCityStyleGraphic(city, state);

    // Use authentic Freeciv size mapping
    // Reference: freeciv-web tilespec.js:get_city_sprite() size calculation
    const sizeIndex = city.cityImage ?? this.getCitySizeIndex(city.size);

    // Check if city has walls - use authentic walls system
    const hasWalls =
      city.presentation?.hasWalls ?? ((city.walls ?? 0) > 0 || this.cityHasWalls(city));
    const spriteType = hasWalls ? 'wall' : 'city';

    // Generate authentic Freeciv sprite key format
    let spriteKey = `${cityStyleGraphic}_${spriteType}_${sizeIndex}`;
    if (!this.tilesetLoader.getSprite(spriteKey) && city.presentation?.graphicAlt) {
      spriteKey = `${city.presentation.graphicAlt}_${spriteType}_${sizeIndex}`;
    }

    const overlays = city.presentation?.overlays ?? [];
    for (const key of overlays.filter(key => key.endsWith('_underlay'))) {
      sprites.push({ key, ...CityRenderer.CITY_SPRITE_OFFSET });
    }
    sprites.push({
      key: spriteKey,
      ...CityRenderer.CITY_SPRITE_OFFSET,
    });
    for (const key of overlays.filter(key => !key.endsWith('_underlay'))) {
      sprites.push({ key, ...CityRenderer.CITY_SPRITE_OFFSET });
    }
    if (city.granaryTurns === -1) {
      sprites.push({ key: 'city.starve', ...CityRenderer.CITY_SPRITE_OFFSET });
    }
    if (city.disorder) {
      sprites.push({ key: 'city.disorder', ...CityRenderer.CITY_SPRITE_OFFSET });
    }

    return sprites;
  }

  /**
   * Get authentic Freeciv city style graphic based on player's nation and tech level
   * Uses ruleset data instead of hardcoded values
   * Reference: freeciv/data/civ2civ3/styles.ruleset citystyle definitions
   * Reference: freeciv-web client/player.js city style logic
   */
  private getCityStyleGraphic(city: City, state: RenderState): string {
    // Get available city styles from ruleset
    const styleNames = Object.keys(this.cityStyles);
    if (styleNames.length === 0) {
      return 'city.european'; // Fallback
    }

    const nationId = state.players[city.playerId]?.nation;
    const nationStyle = nationId ? this.nationStyles[nationId] : undefined;
    const researchedTechs =
      city.playerId === state.currentPlayerId ? state.researchedTechs : new Set<string>();
    return resolveCityGraphic({
      requestedNationStyle: nationStyle,
      nationStyles: this.nationStyleDefinitions,
      cityStyles: this.cityStyles,
      researchedTechs,
    });
  }

  /**
   * Get authentic Freeciv city size index based on population
   * Reference: freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js get_city_sprite()
   */
  private getCitySizeIndex(population: number): number {
    // Authentic Freeciv size thresholds
    if (population >= 16) {
      return 4; // Largest cities
    } else if (population >= 12) {
      return 3; // Large cities
    } else if (population >= 8) {
      return 2; // Medium cities
    } else if (population >= 4) {
      return 1; // Small cities
    } else {
      return 0; // Smallest cities (1-3 population)
    }
  }

  /**
   * Check if city has walls by looking at buildings array
   * Reference: freeciv-web city walls detection system
   */
  private cityHasWalls(city: City): boolean {
    return city.buildings.some(
      building => (typeof building === 'string' ? building : building.id) === 'city_walls'
    );
  }

  /**
   * Render fallback colored rectangle if sprites not available
   */
  private renderCityFallback(city: City, screenPos: { x: number; y: number }): void {
    const scaledWidth = this.tileWidth - 10;
    const scaledHeight = this.tileHeight - 10;
    const offsetX = (this.tileWidth - scaledWidth) / 2;
    const offsetY = -14;

    this.ctx.fillStyle = this.getPlayerColor(city.playerId);
    this.ctx.fillRect(screenPos.x + offsetX, screenPos.y + offsetY, scaledWidth, scaledHeight);
  }

  /**
   * Paint Freeciv-web's atlas-backed city bar at the configured tile origin.
   * This is part of the map compositor, not CivJS's custom HUD.
   *
   * @reference apps/client/public/js/2dcanvas/mapview.js:473-683
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:276-348
   */
  private renderCityBar(city: City, screenPos: { x: number; y: number }, state: RenderState): void {
    const canvasX = screenPos.x + CityRenderer.CITYBAR_OFFSET.x;
    const canvasY = screenPos.y + CityRenderer.CITYBAR_OFFSET.y;
    const text = this.decodeCityName(city.name).toUpperCase();
    const size = String(city.size);
    const player = state.players[city.playerId];
    const playerColor = player?.color ?? this.getPlayerColor(city.playerId);

    this.ctx.font = '16px Georgia, serif';
    this.ctx.textAlign = 'start';
    this.ctx.textBaseline = 'alphabetic';
    const textWidth = this.ctx.measureText(text).width;
    const sizeWidth = this.ctx.measureText(size).width;
    const textHalfWidth = Math.floor(textWidth / 2);
    const hasProduction = Boolean(city.production);

    this.ctx.globalAlpha = 0.7;
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillRect(canvasX - textHalfWidth - 14, canvasY - 17, textWidth + 20, 20);

    this.ctx.fillStyle = playerColor;
    this.ctx.fillRect(
      canvasX + textHalfWidth + 5,
      canvasY - 19,
      sizeWidth + (hasProduction ? 35 : 8),
      24
    );

    const flag = this.getCityFlagSprite(player);
    if (flag) {
      this.ctx.drawImage(flag, canvasX - textHalfWidth - 45, canvasY - 17);
    }
    const occupancy = this.getCityOccupancySprite(city, state);
    if (occupancy) {
      this.ctx.drawImage(occupancy, canvasX - textHalfWidth - 12, canvasY - 16);
    }

    this.ctx.strokeStyle = playerColor;
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(canvasX - textHalfWidth - 46, canvasY - 18);
    this.ctx.lineTo(canvasX + textHalfWidth + sizeWidth + 13, canvasY - 18);
    this.ctx.moveTo(canvasX + textHalfWidth + sizeWidth + 13, canvasY + 4);
    this.ctx.lineTo(canvasX - textHalfWidth - 46, canvasY + 4);
    this.ctx.lineTo(canvasX - textHalfWidth - 46, canvasY - 18);
    this.ctx.moveTo(canvasX - textHalfWidth - 15, canvasY - 17);
    this.ctx.lineTo(canvasX - textHalfWidth - 15, canvasY + 3);
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;

    const production = this.getProductionSprite(city);
    if (production) {
      this.ctx.drawImage(
        production,
        canvasX + textHalfWidth + sizeWidth + 13,
        canvasY - 19,
        28,
        24
      );
    }

    this.ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    this.ctx.fillText(size, canvasX + textHalfWidth + 10, canvasY + 1);

    this.ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    this.ctx.fillText(text, canvasX - textHalfWidth - 2, canvasY - 1);
    this.ctx.fillText(size, canvasX + textHalfWidth + 8, canvasY - 1);
  }

  private decodeCityName(name: string): string {
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  }

  private getCityFlagSprite(
    player: RenderState['players'][string] | undefined
  ): HTMLCanvasElement | null {
    for (const graphic of [player?.nationGraphic, player?.nation]) {
      if (!graphic) continue;
      const sprite = this.tilesetLoader.getSprite(`f.${graphic}`);
      if (sprite) return sprite;
    }
    return null;
  }

  private getCityOccupancySprite(city: City, state: RenderState): HTMLCanvasElement | null {
    const visibleUnitCount = Object.values(state.units ?? {}).filter(
      unit => unit.x === city.x && unit.y === city.y
    ).length;
    const isForeign = Boolean(state.currentPlayerId && city.playerId !== state.currentPlayerId);
    const key =
      isForeign && city.occupied
        ? 'citybar.occupied'
        : `citybar.occupancy_${Math.min(20, visibleUnitCount)}`;
    return this.tilesetLoader.getSprite(key);
  }

  private getProductionSprite(city: City): HTMLCanvasElement | null {
    const production = city.production;
    if (!production) return null;
    const catalogue = production.type === 'unit' ? this.unitGraphics : this.buildingGraphics;
    const definition = catalogue[production.target];
    for (const key of [definition?.graphic, definition?.graphic_alt, definition?.graphic_alt2]) {
      if (!key || key === '-') continue;
      const sprite = this.tilesetLoader.getSprite(key);
      if (sprite) return sprite;
    }
    return null;
  }
}
