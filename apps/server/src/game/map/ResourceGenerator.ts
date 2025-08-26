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
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (!this.isLandTile(tile.terrain) || this.random() > 0.15) {
          // 15% chance of resource
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

  /**
   * Get possible resources for a terrain type
   */
  private getResourcesForTerrain(terrain: TerrainType): ResourceType[] {
    const resourceMap: Record<TerrainType, ResourceType[]> = {
      ocean: ['fish'],
      coast: ['fish'],
      deep_ocean: ['fish'],
      lake: ['fish'],
      grassland: ['wheat', 'cattle', 'horses'],
      plains: ['horses', 'wheat', 'cattle'],
      desert: ['gold', 'gems', 'oil'],
      tundra: ['horses', 'iron', 'oil', 'uranium'],
      snow: ['oil', 'uranium'],
      glacier: ['oil', 'uranium'],
      forest: ['spices', 'silk'],
      jungle: ['spices', 'gems', 'gold'],
      swamp: ['spices', 'oil'],
      hills: ['iron', 'copper', 'gold', 'gems', 'horses'],
      mountains: ['iron', 'copper', 'gold', 'gems', 'uranium'],
    };

    return resourceMap[terrain] || [];
  }

  /**
   * Check if terrain type is land (not water)
   */
  private isLandTile(terrain: TerrainType): boolean {
    return !['ocean', 'coast', 'deep_ocean', 'lake'].includes(terrain);
  }
}
