import type { City, MapViewport } from '../../../types';
import { BaseRenderer, type RenderState } from './BaseRenderer';
import { rulesetService, type CityStyle } from '../../../services/RulesetService';

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
  private stylesLoaded = false;

  // Text rendering constants
  private static readonly BASE_FONT_SIZE = 10; // Base font size in pixels before scaling

  /**
   * Initialize city styles from ruleset
   */
  private async initializeCityStyles(): Promise<void> {
    if (!this.stylesLoaded) {
      this.cityStyles = await rulesetService.getCityStyles('classic');
      this.stylesLoaded = true;
    }
  }

  /**
   * Render all cities visible in the viewport.
   * After initialization, this is synchronous for better performance.
   */
  renderCities(state: RenderState): void {
    // If styles aren't loaded yet, skip rendering cities this frame
    // They will be rendered on the next frame after initialization completes
    if (!this.stylesLoaded) {
      this.initializeCityStyles(); // Start async loading in background
      return;
    }

    Object.values(state.cities).forEach(city => {
      if (this.isInViewport(city.x, city.y, state.viewport)) {
        this.renderCity(city, state.viewport);
      }
    });
  }

  private renderCity(city: City, viewport: MapViewport): void {
    const screenPos = this.mapToScreen(city.x, city.y, viewport);

    // Get city sprite based on size and nation
    const citySprites = this.getCitySprites(city);
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
    this.renderCityText(city, screenPos);
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
  private getCitySprites(city: City): Array<{ key: string; offset_x?: number; offset_y?: number }> {
    const sprites: Array<{ key: string; offset_x?: number; offset_y?: number }> = [];

    // Get authentic Freeciv city style based on player's nation and tech
    const cityStyleGraphic = this.getCityStyleGraphic(city);

    // Use authentic Freeciv size mapping
    // Reference: freeciv-web tilespec.js:get_city_sprite() size calculation
    const sizeIndex = this.getCitySizeIndex(city.size);

    // Check if city has walls - use authentic walls system
    const hasWalls = this.cityHasWalls(city);
    const spriteType = hasWalls ? 'wall' : 'city';

    // Generate authentic Freeciv sprite key format
    const spriteKey = `${cityStyleGraphic}_${spriteType}_${sizeIndex}`;

    sprites.push({
      key: spriteKey,
      offset_x: 0,
      offset_y: 0, // Could add unit_offset_y for authentic positioning
    });

    return sprites;
  }

  /**
   * Get authentic Freeciv city style graphic based on player's nation and tech level
   * Uses ruleset data instead of hardcoded values
   * Reference: freeciv/data/classic/styles.ruleset citystyle definitions
   * Reference: freeciv-web client/player.js city style logic
   */
  private getCityStyleGraphic(city: City): string {
    // Get available city styles from ruleset
    const styleNames = Object.keys(this.cityStyles);
    if (styleNames.length === 0) {
      return 'city.european'; // Fallback
    }

    // Default style graphic based on player ID (simulating different nations)
    const playerNum = parseInt(city.playerId.replace(/\D/g, '')) || 0;

    // Filter to classic/base styles (no tech requirements)
    const baseStyles = styleNames.filter(styleName => !this.cityStyles[styleName].techreq);

    if (baseStyles.length === 0) {
      return 'city.european'; // Fallback
    }

    // Use modulo to distribute players across available base styles
    const styleIndex = playerNum % baseStyles.length;
    const selectedStyleName = baseStyles[styleIndex];

    return this.cityStyles[selectedStyleName].graphic;

    // TODO: Add tech-based evolution:
    // - Check player's tech level against techreq field
    // - Use replaced_by field for style upgrades
    // - Industrial style when player has Railroad tech
    // - Electric Age style when player has Automobile tech
    // - Modern style when player has Rocketry tech
    // - PostModern style for advanced tech
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
    // Check for various wall building types that Freeciv recognizes
    const wallBuildings = [
      'walls', // Basic walls
      'city_walls', // City walls
      'coastal_defense', // Coastal defense
      'fortress', // Fortress-like structures
      'castle', // Castle
      'citadel', // Citadel
    ];

    return wallBuildings.some(building => city.buildings.includes(building));
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
   * Render city name and population as a styled overlay banner
   */
  private renderCityText(city: City, screenPos: { x: number; y: number }): void {
    const centerX = screenPos.x + this.tileWidth / 2;
    const bannerY = screenPos.y + this.tileHeight - 2;

    // Prepare text content with larger scaling
    const cityText = `${city.name.toUpperCase()} ${city.size}`;
    const labelScale = 1.2; // Scale up the entire label
    const fontSize = Math.floor(CityRenderer.BASE_FONT_SIZE * this.cityScale * labelScale);
    this.ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    this.ctx.textAlign = 'center';

    // Measure text to size the banner with better padding
    const textMetrics = this.ctx.measureText(cityText);
    const textWidth = textMetrics.width;
    const horizontalPadding = 10;
    const verticalPadding = 4; // More padding above and below text
    const bannerWidth = textWidth + horizontalPadding * 2;
    const bannerHeight = fontSize + verticalPadding * 2;

    // Draw banner background (dark green with slight transparency)
    this.ctx.fillStyle = 'rgba(34, 70, 34, 0.9)';
    this.ctx.fillRect(centerX - bannerWidth / 2, bannerY - 2, bannerWidth, bannerHeight);

    // Draw banner border (lighter green)
    this.ctx.strokeStyle = 'rgba(80, 120, 80, 0.8)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(centerX - bannerWidth / 2, bannerY - 2, bannerWidth, bannerHeight);

    // Draw text (white with subtle shadow) - properly centered in banner
    const textY = bannerY + verticalPadding + fontSize - 2;

    // Text shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillText(cityText, centerX + 1, textY + 1);

    // Main text
    this.ctx.fillStyle = 'white';
    this.ctx.fillText(cityText, centerX, textY);
  }
}
