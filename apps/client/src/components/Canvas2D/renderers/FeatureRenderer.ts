import type { Tile, MapViewport } from '../../../types';
import { BaseRenderer, type RenderState } from './BaseRenderer';

export class FeatureRenderer extends BaseRenderer {
  // Sprite scaling factors for visual size control
  private resourceScale = 0.7; // Make resources 30% smaller

  /**
   * Render all map features (rivers, resources) for visible tiles.
   */
  renderFeatures(state: RenderState, visibleTiles: Tile[]): void {
    for (const tile of visibleTiles) {
      this.renderTileFeatures(tile, state.viewport);
    }
  }

  private renderTileFeatures(tile: Tile, viewport: MapViewport): void {
    const screenPos = this.mapToScreen(tile.x, tile.y, viewport);

    // ADD: River rendering layer (matches freeciv-web LAYER_SPECIAL1)
    const riverSprite = this.getTileRiverSprite(tile);
    if (riverSprite) {
      const sprite = this.tilesetLoader.getSprite(riverSprite.key);
      if (sprite) {
        this.ctx.drawImage(sprite, screenPos.x, screenPos.y);
        if (import.meta.env.DEV) {
          console.debug(
            `River sprite rendered: ${riverSprite.key} at (${screenPos.x},${screenPos.y})`
          );
        }
      } else {
        if (import.meta.env.DEV) {
          console.warn(`River sprite not found: ${riverSprite.key}`);
        }
      }
    }

    // ADD: Resource rendering layer (matches freeciv-web LAYER_SPECIAL2)
    const resourceSprite = this.getTileResourceSprite(tile);
    if (resourceSprite) {
      const sprite = this.tilesetLoader.getSprite(resourceSprite.key);
      if (sprite) {
        // Apply resource scaling and center the scaled sprite on the tile
        const scaledWidth = sprite.width * this.resourceScale;
        const scaledHeight = sprite.height * this.resourceScale;
        const offsetX = (sprite.width - scaledWidth) / 2;
        const offsetY = (sprite.height - scaledHeight) / 2;

        this.ctx.drawImage(
          sprite,
          screenPos.x + offsetX,
          screenPos.y + offsetY,
          scaledWidth,
          scaledHeight
        );
        if (import.meta.env.DEV) {
          console.debug(
            `Resource sprite rendered: ${resourceSprite.key} at (${screenPos.x},${screenPos.y}) scale=${this.resourceScale}`
          );
        }
      } else {
        if (import.meta.env.DEV) {
          console.warn(`Resource sprite not found: ${resourceSprite.key}`);
        }
      }
    }
  }

  /**
   * Calculate river sprite for a tile based on its riverMask connections.
   * Port of freeciv-web's get_tile_river_sprite() function.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:get_tile_river_sprite()
   * @param tile - The tile to calculate river sprite for
   * @returns Sprite info with key for river rendering, or null if no river
   */
  private getTileRiverSprite(tile: Tile): { key: string } | null {
    if (!tile.riverMask) return null;

    // Convert riverMask bitfield to directional string like freeciv-web
    // Our bitfield: N=1, E=2, S=4, W=8
    // freeciv-web format: "n1e0s1w0" etc.
    let riverStr = '';
    riverStr += tile.riverMask & 1 ? 'n1' : 'n0'; // North
    riverStr += tile.riverMask & 2 ? 'e1' : 'e0'; // East
    riverStr += tile.riverMask & 4 ? 's1' : 's0'; // South
    riverStr += tile.riverMask & 8 ? 'w1' : 'w0'; // West

    const spriteKey = `road.river_s_${riverStr}:0`;

    // Debug logging for river sprite generation
    if (import.meta.env.DEV) {
      console.debug(
        `River sprite requested: tile(${tile.x},${tile.y}) mask=${tile.riverMask} -> ${spriteKey}`
      );
    }

    // Return sprite key following freeciv-web's road.river_s_XXXX:0 pattern
    return { key: spriteKey };
  }

  /**
   * Calculate resource sprite for a tile based on its resource type.
   * Port of freeciv-web's resource rendering functionality.
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js (resource handling)
   * @param tile - The tile to calculate resource sprite for
   * @returns Sprite info with key for resource rendering, or null if no resource
   */
  private getTileResourceSprite(tile: Tile): { key: string } | null {
    if (!tile.resource) return null;

    // Map resource types to sprite keys following freeciv tileset patterns
    const resourceSpriteMap: Record<string, string> = {
      // Food resources
      wheat: 'ts.wheat:0',
      buffalo: 'ts.buffalo:0',
      cattle: 'ts.buffalo:0', // Map cattle to buffalo sprite
      fish: 'ts.fish:0',
      fruit: 'ts.fruit:0',
      horses: 'ts.horses:0',
      pheasant: 'ts.pheasant:0',

      // Luxury resources
      gold: 'ts.gold:0',
      gems: 'ts.gems:0',
      silk: 'ts.silk:0',
      spice: 'ts.spice:0',
      spices: 'ts.spice:0', // Alternative spelling
      wine: 'ts.wine:0',
      furs: 'ts.furs:0',

      // Strategic resources
      iron: 'ts.iron:0',
      coal: 'ts.coal:0',
      oil: 'ts.oil:0',
      // Note: copper and uranium sprites not available in tileset, will be skipped

      // Desert resources
      oasis: 'ts.oasis:0',

      // Arctic resources
      seals: 'ts.seals:0',
      whales: 'ts.whales:0',
      arctic_ivory: 'ts.arctic_ivory:0',
      arctic_oil: 'ts.arctic_oil:0',

      // Tundra resources
      tundra_game: 'ts.tundra_game:0',
      peat: 'ts.peat:0',

      // River/grassland resources
      grassland_resources: 'ts.grassland_resources:0',
      river_resources: 'ts.river_resources:0',
    };

    const spriteKey = resourceSpriteMap[tile.resource];

    if (!spriteKey) {
      // Skip rendering resources without sprite mappings (copper, uranium, etc.)
      if (import.meta.env.DEV) {
        console.debug(
          `Skipping rendering for unmapped resource '${tile.resource}' at (${tile.x},${tile.y})`
        );
      }
      return null;
    }

    // Debug logging for resource sprite generation
    if (import.meta.env.DEV) {
      console.debug(
        `Resource sprite requested: tile(${tile.x},${tile.y}) resource=${tile.resource} -> ${spriteKey}`
      );
    }

    // Return sprite key following freeciv-web's s.RESOURCE:0 pattern
    return { key: spriteKey };
  }

  /**
   * Set the scaling factors for feature sprites
   * @param resourceScale - Scale factor for resource sprites (0.1 to 2.0)
   */
  setResourceScale(resourceScale?: number): void {
    if (resourceScale !== undefined && resourceScale >= 0.1 && resourceScale <= 2.0) {
      this.resourceScale = resourceScale;
    }
  }

  /**
   * Get current resource scaling factor
   */
  getResourceScale(): number {
    return this.resourceScale;
  }
}
