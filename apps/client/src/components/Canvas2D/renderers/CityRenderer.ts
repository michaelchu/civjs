import type { City, MapViewport } from '../../../types';
import { BaseRenderer, type RenderState } from './BaseRenderer';

export class CityRenderer extends BaseRenderer {
  // Sprite scaling factors for visual size control
  private cityScale = 0.8; // Make cities 20% smaller

  /**
   * Render all cities visible in the viewport.
   */
  renderCities(state: RenderState): void {
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
        // Scale and center the sprite
        const scaledWidth = sprite.width * this.cityScale;
        const scaledHeight = sprite.height * this.cityScale;
        const offsetX = (this.tileWidth - scaledWidth) / 2;
        const offsetY = (this.tileHeight - scaledHeight) / 2;

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
   * @reference freeciv-web city sprite selection logic
   */
  private getCitySprites(city: City): Array<{ key: string; offset_x?: number; offset_y?: number }> {
    const sprites: Array<{ key: string; offset_x?: number; offset_y?: number }> = [];

    // Determine city style based on nation (simplified - could be expanded)
    const cityStyle = this.getCityStyle(city.playerId);

    // Map city population to sprite index (population 1-5+ maps to sprites 0-4)
    const sizeIndex = Math.min(Math.max(city.size - 1, 0), 4);

    // Check if city has walls (simplified - could check actual buildings)
    const hasWalls = this.cityHasWalls(city);

    // Generate sprite key
    const spriteType = hasWalls ? 'wall' : 'city';
    const spriteKey = `city.${cityStyle}_${spriteType}_${sizeIndex}`;

    sprites.push({
      key: spriteKey,
      offset_x: 0,
      offset_y: 0,
    });

    return sprites;
  }

  /**
   * Get city style based on player/nation
   * For now, alternates between european and celtic based on player ID
   * Could be expanded to use actual nation data
   */
  private getCityStyle(playerId: string): string {
    // Simple alternating logic - could be improved with actual nation data
    const playerNum = parseInt(playerId.replace(/\D/g, '')) || 0;
    return playerNum % 2 === 0 ? 'european' : 'celtic';
  }

  /**
   * Check if city has walls by looking at buildings array
   */
  private cityHasWalls(city: City): boolean {
    // Check if city has walls building
    return city.buildings.includes('walls') || city.buildings.includes('city_walls');
  }

  /**
   * Render fallback colored rectangle if sprites not available
   */
  private renderCityFallback(city: City, screenPos: { x: number; y: number }): void {
    const scaledWidth = (this.tileWidth - 10) * this.cityScale;
    const scaledHeight = (this.tileHeight - 10) * this.cityScale;
    const offsetX = (this.tileWidth - 10 - scaledWidth) / 2;
    const offsetY = (this.tileHeight - 10 - scaledHeight) / 2;

    this.ctx.fillStyle = this.getPlayerColor(city.playerId);
    this.ctx.fillRect(
      screenPos.x + 5 + offsetX,
      screenPos.y + 5 + offsetY,
      scaledWidth,
      scaledHeight
    );
  }

  /**
   * Render city name and population text
   */
  private renderCityText(city: City, screenPos: { x: number; y: number }): void {
    this.ctx.fillStyle = 'white';
    this.ctx.strokeStyle = 'black';
    this.ctx.lineWidth = 2;
    this.ctx.font = `${Math.floor(10 * this.cityScale)}px Arial, sans-serif`;
    this.ctx.textAlign = 'center';

    // City name with outline for better visibility
    const nameY = screenPos.y - 5;
    this.ctx.strokeText(city.name, screenPos.x + this.tileWidth / 2, nameY);
    this.ctx.fillText(city.name, screenPos.x + this.tileWidth / 2, nameY);

    // City size with outline
    const sizeY = screenPos.y + this.tileHeight + 15;
    const sizeText = city.size.toString();
    this.ctx.strokeText(sizeText, screenPos.x + this.tileWidth / 2, sizeY);
    this.ctx.fillText(sizeText, screenPos.x + this.tileWidth / 2, sizeY);
  }
}
