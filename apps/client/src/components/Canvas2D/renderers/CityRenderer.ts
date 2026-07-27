import type { City, MapViewport } from '../../../types';
import { BaseRenderer, type RenderState } from './BaseRenderer';
import type { CityStyle, NationStyle } from '../../../services/RulesetService';
import { resolveCityGraphic } from '../../../services/PresentationResolver';

/**
 * CityRenderer - Authentic Freeciv-compliant city sprite rendering
 *
 * This implementation ports the city sprite system directly from Freeciv to ensure
 * visual and behavioral compatibility with the reference implementation.
 *
 * City Sprite System Reference:
 * - freeciv/data/classic/styles.ruleset: Defines all city styles and their graphics
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
  // Sprite scaling factors for visual size control
  private cityScale = 1.0; // Normal size cities
  private cityStyles: Record<string, CityStyle> = {};
  private nationStyleDefinitions: Record<string, NationStyle> = {};
  private nationStyles: Record<string, string> = {};

  // Text rendering constants
  private static readonly BASE_FONT_SIZE = 10; // Base font size in pixels before scaling

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

  /**
   * Render all cities visible in the viewport.
   * After initialization, this is synchronous for better performance.
   */
  renderCities(state: RenderState): void {
    Object.values(state.cities).forEach(city => {
      if (this.isInViewport(city.x, city.y, state.viewport)) {
        this.renderCity(city, state.viewport, state);
      }
    });
  }

  private renderCity(city: City, viewport: MapViewport, state: RenderState): void {
    const screenPos = this.mapToScreen(city.x, city.y, viewport);

    // Get city sprite based on size and nation
    const citySprites = this.getCitySprites(city, state);
    let spriteRendered = false;

    // Render city sprites (main city + walls if applicable)
    for (const spriteInfo of citySprites) {
      const sprite = this.tilesetLoader.getSprite(spriteInfo.key);
      if (sprite) {
        // Scale and position the sprite
        const scaledWidth = sprite.width * this.cityScale;
        const scaledHeight = sprite.height * this.cityScale;
        const offsetX = (this.tileWidth - scaledWidth) / 2;
        // Use authentic Freeciv city positioning: center + unit_offset_y
        // Cities use offset_y: -unit_offset_y (-14), which moves them UP by 14 pixels from center
        const offsetY = (this.tileHeight - scaledHeight) / 2 + -14;

        this.ctx.drawImage(
          sprite,
          screenPos.x + offsetX + (spriteInfo.offset_x || 0),
          screenPos.y + offsetY + (spriteInfo.offset_y || 0),
          scaledWidth,
          scaledHeight
        );
        spriteRendered = true;
      }
    }

    // Fallback to colored rectangle if no sprites found
    if (!spriteRendered) {
      this.renderCityFallback(city, screenPos);
    }

    // Render city name and population
    this.renderCityText(city, screenPos, state);
  }

  /**
   * Set the scaling factor for city sprites
   * @param cityScale - Scale factor for city sprites (0.1 to 2.0)
   */
  setCityScale(cityScale?: number): void {
    if (cityScale !== undefined && cityScale >= 0.1 && cityScale <= 2.0) {
      this.cityScale = cityScale;
    }
  }

  /**
   * Get current city scaling factor
   */
  getCityScale(): number {
    return this.cityScale;
  }

  /**
   * Get city sprites based on city properties
   * Reference: freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js get_city_sprite()
   * Reference: freeciv/data/classic/styles.ruleset citystyle definitions
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
    const sizeIndex = this.getCitySizeIndex(city.size);

    // Check if city has walls - use authentic walls system
    const hasWalls = city.presentation?.hasWalls ?? this.cityHasWalls(city);
    const spriteType = hasWalls ? 'wall' : 'city';

    // Generate authentic Freeciv sprite key format
    let spriteKey = `${cityStyleGraphic}_${spriteType}_${sizeIndex}`;
    if (!this.tilesetLoader.getSprite(spriteKey) && city.presentation?.graphicAlt) {
      spriteKey = `${city.presentation.graphicAlt}_${spriteType}_${sizeIndex}`;
    }

    const overlays = city.presentation?.overlays ?? [];
    for (const key of overlays.filter(key => key.endsWith('_underlay'))) {
      sprites.push({ key });
    }
    sprites.push({
      key: spriteKey,
      offset_x: 0,
      offset_y: 0, // Could add unit_offset_y for authentic positioning
    });
    for (const key of overlays.filter(key => !key.endsWith('_underlay'))) {
      sprites.push({ key });
    }
    if (city.granaryTurns === -1) {
      sprites.push({ key: 'city.starve' });
    }
    if (city.disorder) {
      sprites.push({ key: 'city.disorder' });
    }

    return sprites;
  }

  /**
   * Get authentic Freeciv city style graphic based on player's nation and tech level
   * Uses ruleset data instead of hardcoded values
   * Reference: freeciv/data/classic/styles.ruleset citystyle definitions
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
      building => (typeof building === 'string' ? building : building.id) === 'walls'
    );
  }

  /**
   * Render fallback colored rectangle if sprites not available
   */
  private renderCityFallback(city: City, screenPos: { x: number; y: number }): void {
    const scaledWidth = (this.tileWidth - 10) * this.cityScale;
    const scaledHeight = (this.tileHeight - 10) * this.cityScale;
    const offsetX = (this.tileWidth - scaledWidth) / 2;
    // Use authentic Freeciv city positioning: center + unit_offset_y
    const offsetY = (this.tileHeight - scaledHeight) / 2 + -14;

    this.ctx.fillStyle = this.getPlayerColor(city.playerId);
    this.ctx.fillRect(screenPos.x + offsetX, screenPos.y + offsetY, scaledWidth, scaledHeight);
  }

  /**
   * Render city label with population highlight and two-row layout
   * Format: [POP] | CITY NAME
   *               | PRODUCTION (empty for now)
   */
  private renderCityText(
    city: City,
    screenPos: { x: number; y: number },
    state: RenderState
  ): void {
    const centerX = screenPos.x + this.tileWidth / 2;
    const bannerY = screenPos.y + this.tileHeight - 2;

    // Prepare text content
    const cityName = city.name.toUpperCase();
    const cityPop = city.size.toString();
    const labelScale = 1.2;
    const fontSize = Math.floor(CityRenderer.BASE_FONT_SIZE * this.cityScale * labelScale);
    this.ctx.font = `${fontSize}px Arial, sans-serif`;

    // Measure text dimensions
    const nameMetrics = this.ctx.measureText(cityName);

    // Layout constants
    const popSquareSize = fontSize + 8; // Square size for population
    const textPadding = 6;
    const rowHeight = fontSize + 4;
    const rightSectionWidth = Math.max(nameMetrics.width, 80) + textPadding * 2; // Min width for production
    const totalWidth = popSquareSize + rightSectionWidth;
    const totalHeight = rowHeight * 2;

    // Calculate positions
    const bannerX = centerX - totalWidth / 2;
    const popSquareX = bannerX;
    const rightSectionX = bannerX + popSquareSize;

    // Draw main background (dark teal/green like in reference)
    this.ctx.fillStyle = 'rgba(40, 80, 80, 0.9)';
    this.ctx.fillRect(bannerX, bannerY, totalWidth, totalHeight);

    // Draw highlighted population square using player's actual nation color
    const player = state.players[city.playerId];
    const playerColor = player?.color || this.getPlayerColor(city.playerId); // Fallback to BaseRenderer method
    this.ctx.fillStyle = playerColor;
    this.ctx.fillRect(popSquareX, bannerY, popSquareSize, totalHeight);

    // Draw border around entire label
    this.ctx.strokeStyle = 'rgba(120, 140, 120, 0.8)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(bannerX, bannerY, totalWidth, totalHeight);

    // Draw horizontal separator between rows
    this.ctx.strokeStyle = 'rgba(120, 140, 120, 0.6)';
    this.ctx.beginPath();
    this.ctx.moveTo(rightSectionX, bannerY + rowHeight);
    this.ctx.lineTo(bannerX + totalWidth, bannerY + rowHeight);
    this.ctx.stroke();

    // Draw vertical separator between population and text
    this.ctx.beginPath();
    this.ctx.moveTo(rightSectionX, bannerY);
    this.ctx.lineTo(rightSectionX, bannerY + totalHeight);
    this.ctx.stroke();

    // Draw population number (centered in colored square)
    const popCenterX = popSquareX + popSquareSize / 2;
    const popCenterY = bannerY + totalHeight / 2;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    // Population shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    this.ctx.fillText(cityPop, popCenterX + 1, popCenterY + 1);

    // Main population text (contrasting color for readability)
    this.ctx.fillStyle = 'white';
    this.ctx.fillText(cityPop, popCenterX, popCenterY);

    // Draw city name (top right section)
    const nameX = rightSectionX + textPadding;
    const nameY = bannerY + fontSize;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'alphabetic';

    // Name shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillText(cityName, nameX + 1, nameY + 1);

    // Main name text (white)
    this.ctx.fillStyle = 'white';
    this.ctx.fillText(cityName, nameX, nameY);

    // Bottom right section is reserved for production (empty for now)
    // When implemented, production text would go at:
    // const productionY = bannerY + rowHeight + fontSize;
    // this.ctx.fillText(production, nameX, productionY);
  }
}
