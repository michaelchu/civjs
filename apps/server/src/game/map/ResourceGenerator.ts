/**
 * @module server/game/map/ResourceGenerator
 * Implements Resource Generator map behavior.
 */
import { MapTile, TerrainType, ResourceType } from './MapTypes';

export class ResourceGenerator {
  private width: number;
  private height: number;
  private random: () => number;

  constructor(width: number, height: number, random: () => number) {
    this.width = width;
    this.height = height;
    this.random = random;
  }

  /**
   * Generate resources across the map
   */
  public async generateResources(tiles: MapTile[][]): Promise<void> {
    return this.generateResourcesAtRichness(tiles, 250);
  }

  public async generateResourcesAtRichness(
    tiles: MapTile[][],
    richnessPerThousand: number
  ): Promise<void> {
    const probability = Math.max(0, Math.min(1000, richnessPerThousand)) / 1000;
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (this.random() > probability) {
          continue;
        }

        // Assign resource based on terrain
        const possibleResources = this.getResourcesForTerrain(tile.terrain);
        if (possibleResources.length > 0) {
          const resourceIndex = Math.floor(this.random() * possibleResources.length);
          tile.resource = possibleResources[resourceIndex];
        }
      }
    }
  }

  public async generateHuts(tiles: MapTile[][], densityPerThousand: number): Promise<void> {
    const probability = Math.max(0, Math.min(1000, densityPerThousand)) / 1000;
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (
          probability > 0 &&
          !['ocean', 'coast', 'deep_ocean', 'lake', 'inaccessible'].includes(tile.terrain) &&
          this.random() < probability &&
          !tile.improvements.includes('hut')
        ) {
          tile.improvements.push('hut');
        }
      }
    }
  }

  /**
   * Get possible resources for a terrain type
   */
  private getResourcesForTerrain(terrain: TerrainType): ResourceType[] {
    const resourceMap: Record<TerrainType, ResourceType[]> = {
      ocean: ['fish', 'whales'],
      coast: ['fish', 'whales'],
      deep_ocean: [],
      lake: ['fish'],
      inaccessible: [],
      glacier: ['ivory', 'oil'],
      grassland: ['resources'],
      plains: ['buffalo', 'wheat'],
      desert: ['oasis', 'oil'],
      tundra: ['game', 'furs'],
      forest: ['pheasant', 'silk'],
      jungle: ['gems', 'fruit'],
      swamp: ['peat', 'spice'],
      hills: ['coal', 'wine'],
      mountains: ['gold', 'iron'],
    };

    return resourceMap[terrain] || [];
  }
}
