import {
  TerrainType,
  TerrainSelector,
  TerrainProperty,
  TerrainProperties,
  TemperatureType,
  WetnessCondition,
} from './MapTypes';

// Terrain property values (0-100) for each terrain type
const TERRAIN_PROPERTY_MAP: Record<TerrainType, TerrainProperties> = {
  // Water terrains
  ocean: {
    [TerrainProperty.OCEAN_DEPTH]: 0,
  },
  coast: {
    [TerrainProperty.OCEAN_DEPTH]: 32,
  },
  deep_ocean: {
    [TerrainProperty.OCEAN_DEPTH]: 87,
  },
  lake: {
    [TerrainProperty.WET]: 100,
  },
  // Land terrains
  desert: {
    [TerrainProperty.DRY]: 100,
    [TerrainProperty.TROPICAL]: 50,
    [TerrainProperty.TEMPERATE]: 20,
  },
  plains: {
    [TerrainProperty.COLD]: 20,
    [TerrainProperty.WET]: 20,
    [TerrainProperty.FOLIAGE]: 50,
    [TerrainProperty.TEMPERATE]: 50,
  },
  grassland: {
    [TerrainProperty.GREEN]: 50,
    [TerrainProperty.TEMPERATE]: 50,
  },
  forest: {
    [TerrainProperty.GREEN]: 50,
    [TerrainProperty.MOUNTAINOUS]: 30,
  },
  jungle: {
    [TerrainProperty.FOLIAGE]: 50,
    [TerrainProperty.TROPICAL]: 50,
    [TerrainProperty.WET]: 50,
  },
  hills: {
    [TerrainProperty.MOUNTAINOUS]: 70,
  },
  mountains: {
    [TerrainProperty.GREEN]: 50,
    [TerrainProperty.TEMPERATE]: 50,
  },
  swamp: {
    [TerrainProperty.WET]: 100,
    [TerrainProperty.TROPICAL]: 10,
    [TerrainProperty.TEMPERATE]: 10,
    [TerrainProperty.COLD]: 10,
  },
  tundra: {
    [TerrainProperty.COLD]: 50,
  },
};

// Terrain selection lists for different terrain categories (from freeciv reference)
const TERRAIN_SELECTORS: TerrainSelector[] = [
  // Forest terrains
  {
    terrain: 'forest',
    weight: 50,
    target: TerrainProperty.GREEN,
    prefer: TerrainProperty.FOLIAGE,
    avoid: TerrainProperty.DRY,
    tempCondition: TemperatureType.TEMPERATE,
    wetCondition: WetnessCondition.ALL,
  },
  {
    terrain: 'jungle',
    weight: 40,
    target: TerrainProperty.TROPICAL,
    prefer: TerrainProperty.WET,
    avoid: TerrainProperty.COLD,
    tempCondition: TemperatureType.TROPICAL,
    wetCondition: WetnessCondition.NDRY,
  },
  // Desert terrains
  {
    terrain: 'desert',
    weight: 60,
    target: TerrainProperty.DRY,
    prefer: TerrainProperty.TROPICAL,
    avoid: TerrainProperty.WET,
    tempCondition: TemperatureType.TROPICAL,
    wetCondition: WetnessCondition.DRY,
  },
  // Mountain terrains
  {
    terrain: 'mountains',
    weight: 30,
    target: TerrainProperty.MOUNTAINOUS,
    prefer: TerrainProperty.GREEN,
    avoid: TerrainProperty.WET,
    tempCondition: TemperatureType.TEMPERATE,
    wetCondition: WetnessCondition.ALL,
  },
  {
    terrain: 'hills',
    weight: 40,
    target: TerrainProperty.MOUNTAINOUS,
    prefer: TerrainProperty.GREEN,
    avoid: TerrainProperty.FROZEN,
    tempCondition: TemperatureType.TEMPERATE,
    wetCondition: WetnessCondition.ALL,
  },
  // Swamp terrains
  {
    terrain: 'swamp',
    weight: 25,
    target: TerrainProperty.WET,
    prefer: TerrainProperty.TROPICAL,
    avoid: TerrainProperty.FROZEN,
    tempCondition: TemperatureType.TROPICAL,
    wetCondition: WetnessCondition.NDRY,
  },
  // Grassland/plains
  {
    terrain: 'grassland',
    weight: 50,
    target: TerrainProperty.GREEN,
    prefer: TerrainProperty.TEMPERATE,
    avoid: TerrainProperty.DRY,
    tempCondition: TemperatureType.TEMPERATE,
    wetCondition: WetnessCondition.NDRY,
  },
  {
    terrain: 'plains',
    weight: 45,
    target: TerrainProperty.TEMPERATE,
    prefer: TerrainProperty.FOLIAGE,
    avoid: TerrainProperty.FROZEN,
    tempCondition: TemperatureType.TEMPERATE,
    wetCondition: WetnessCondition.ALL,
  },
  // Cold terrains
  {
    terrain: 'tundra',
    weight: 40,
    target: TerrainProperty.COLD,
    prefer: TerrainProperty.GREEN,
    avoid: TerrainProperty.TROPICAL,
    tempCondition: TemperatureType.COLD,
    wetCondition: WetnessCondition.ALL,
  },
  {
    terrain: 'tundra',
    weight: 30,
    target: TerrainProperty.FROZEN,
    prefer: TerrainProperty.COLD,
    avoid: TerrainProperty.TROPICAL,
    tempCondition: TemperatureType.FROZEN,
    wetCondition: WetnessCondition.ALL,
  },
];

export class TerrainSelectionEngine {
  private random: () => number;
  private shoreLevel: number;
  private mountainLevel: number;

  constructor(random: () => number, shoreLevel: number = 64, mountainLevel: number = 191) {
    this.random = random;
    this.shoreLevel = shoreLevel;
    this.mountainLevel = mountainLevel;
  }

  /**
   * Enhanced terrain selection using sophisticated climate-based algorithms
   * @reference freeciv/server/generator/mapgen.c:pickTerrain logic and terrain placement algorithms
   * Combines multiple freeciv approaches:
   * - Climate-based terrain selection (mapgen.c terrain placement)
   * - Property-based terrain fitness scoring
   * - Elevation and climate synergy bonuses
   */
  public pickTerrain(
    tileTemp: TemperatureType,
    tileWetness: number,
    elevation: number
  ): TerrainType {
    // Water terrains based on elevation using freeciv reference shore levels
    if (elevation < this.shoreLevel * 0.5) return 'deep_ocean';
    if (elevation < this.shoreLevel * 0.8) return 'ocean';
    if (elevation < this.shoreLevel) return 'coast';

    // Enhanced inland water placement with climate consideration
    if (elevation < this.shoreLevel * 1.2 && tileWetness > 80) {
      // Higher chance of lakes in temperate zones
      const lakeChance = tileTemp & TemperatureType.TEMPERATE ? 0.08 : 0.05;
      if (this.random() < lakeChance) {
        return 'lake';
      }
    }

    // Special climate-based terrain rules
    if (tileTemp & TemperatureType.FROZEN) {
      // Polar regions - tundra with some variation based on elevation and wetness
      if (elevation > 150 && this.random() < 0.3) {
        return 'hills'; // Some hills in frozen mountainous areas
      } else if (tileWetness > 70 && this.random() < 0.2) {
        return 'swamp'; // Frozen swamps/marshes
      } else {
        return 'tundra'; // Default for frozen areas
      }
    }

    // Find matching terrain selectors
    const candidates: Array<{ terrain: TerrainType; score: number }> = [];

    for (const selector of TERRAIN_SELECTORS) {
      // Check temperature condition match
      if (!(tileTemp & selector.tempCondition)) {
        continue;
      }

      // Check wetness condition
      const isDry = tileWetness < 30;
      if (selector.wetCondition === WetnessCondition.DRY && !isDry) continue;
      if (selector.wetCondition === WetnessCondition.NDRY && isDry) continue;

      // Enhanced terrain fitness scoring (Phase 3)
      const properties = TERRAIN_PROPERTY_MAP[selector.terrain];
      let score = selector.weight;

      // Temperature-climate matching bonus (stronger influence)
      if (tileTemp & selector.tempCondition) {
        score *= 1.3; // 30% bonus for matching temperature
      }

      // Target property bonus
      const targetValue = properties[selector.target] || 0;
      score += targetValue * 0.6; // Increased importance

      // Prefer property bonus
      const preferValue = properties[selector.prefer] || 0;
      score += preferValue * 0.4; // Increased importance

      // Avoid property penalty
      const avoidValue = properties[selector.avoid] || 0;
      score -= avoidValue * 0.5; // Stronger penalty

      // Climate-elevation synergy bonuses using freeciv reference mountain level
      if (selector.terrain === 'mountains' || selector.terrain === 'hills') {
        score += Math.max(0, elevation - this.mountainLevel) * 0.25;
        // Cold mountains get extra bonus
        if (tileTemp & (TemperatureType.COLD | TemperatureType.FROZEN)) {
          score *= 1.2;
        }
      }

      // Tropical wetness synergy
      if (
        tileTemp & TemperatureType.TROPICAL &&
        (selector.terrain === 'jungle' || selector.terrain === 'swamp')
      ) {
        if (tileWetness > 60) {
          score *= 1.4; // Strong synergy bonus
        }
      }

      // Desert-arid synergy
      if (selector.terrain === 'desert' && tileWetness < 30) {
        score *= 1.3;
      }

      // Forest placement enhancement
      if (selector.terrain === 'forest') {
        if (tileTemp & TemperatureType.TEMPERATE && tileWetness > 40 && tileWetness < 80) {
          score *= 1.25; // Optimal forest conditions
        }
      }

      if (score > 0) {
        candidates.push({ terrain: selector.terrain, score });
      }
    }

    // Weighted random selection
    if (candidates.length === 0) {
      // Fallback to simple terrain based on temperature and wetness
      if (tileTemp === TemperatureType.FROZEN) return 'tundra';
      if (tileTemp === TemperatureType.COLD) {
        // Cold: reasonable chance of tundra with natural variation
        return this.random() < 0.7 ? 'tundra' : 'plains';
      }
      if (tileWetness > 70) return 'grassland';
      if (tileWetness < 30) return 'desert';
      return 'plains';
    }

    const totalScore = candidates.reduce((sum, c) => sum + c.score, 0);
    let randomValue = this.random() * totalScore;

    for (const candidate of candidates) {
      randomValue -= candidate.score;
      if (randomValue <= 0) {
        return candidate.terrain;
      }
    }

    // Fallback
    return candidates[0].terrain;
  }
}
