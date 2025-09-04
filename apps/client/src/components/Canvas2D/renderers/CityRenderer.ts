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

    // Apply city scaling for smaller visual representation
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

    this.ctx.fillStyle = 'white';
    this.ctx.font = `${Math.floor(10 * this.cityScale)}px Arial`; // Scale font size too
    this.ctx.textAlign = 'center';
    this.ctx.fillText(city.name, screenPos.x + this.tileWidth / 2, screenPos.y - 5);

    this.ctx.fillText(
      city.size.toString(),
      screenPos.x + this.tileWidth / 2,
      screenPos.y + this.tileHeight / 2
    );
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
}
