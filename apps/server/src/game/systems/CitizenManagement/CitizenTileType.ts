/**
 * @module server/game/systems/CitizenManagement/CitizenTileType
 * CitizenTileType - Represents unique combinations of tile outputs for optimization
 * @reference freeciv/common/aicore/cm.c - struct cm_tile_type
 *
 * Groups tiles with identical output into types to reduce search space
 */

import { OutputType } from '@game/constants/GameConstants';
import { SpecialistType } from '@game/constants/SpecialistDefinitions';

/**
 * Represents a unique tile output combination or specialist type
 * Multiple actual tiles/specialists may map to the same type
 */
export interface CitizenTileType {
  /** Unique identifier for this tile type */
  id: string;

  /** Production output for each type (food, shields, trade, etc.) */
  production: Record<OutputType, number>;

  /** Estimated fitness value (weighted sum of production) */
  estimated_fitness: number;

  /** Whether this represents a specialist rather than a tile */
  is_specialist: boolean;

  /** Specialist type (only valid if is_specialist = true) */
  specialist_type?: SpecialistType;

  /** List of actual tile indices that have this output pattern */
  tile_indices: number[];

  /** Available count (number of tiles/specialists of this type available) */
  available_count: number;

  /** Index in the optimization lattice */
  lattice_index: number;

  /** Depth in the lattice (sum of counts of all better types) */
  lattice_depth: number;

  /** References to tile types that are strictly better */
  better_types: CitizenTileType[];

  /** References to tile types that are strictly worse */
  worse_types: CitizenTileType[];
}

/**
 * Factory for creating CitizenTileType instances
 */
export class CitizenTileTypeFactory {
  /**
   * Create a tile type from a production pattern
   */
  static createFromTileOutput(
    id: string,
    production: Record<OutputType, number>,
    tileIndices: number[]
  ): CitizenTileType {
    return {
      id,
      production: { ...production },
      estimated_fitness: 0, // Will be calculated later
      is_specialist: false,
      tile_indices: [...tileIndices],
      available_count: tileIndices.length,
      lattice_index: -1,
      lattice_depth: 0,
      better_types: [],
      worse_types: [],
    };
  }

  /**
   * Create a tile type for a specialist
   */
  static createFromSpecialist(
    specialistType: SpecialistType,
    production: Record<OutputType, number>,
    availableCount: number
  ): CitizenTileType {
    return {
      id: `specialist_${specialistType}`,
      production: { ...production },
      estimated_fitness: 0, // Will be calculated later
      is_specialist: true,
      specialist_type: specialistType,
      tile_indices: [],
      available_count: availableCount,
      lattice_index: -1,
      lattice_depth: 0,
      better_types: [],
      worse_types: [],
    };
  }

  /**
   * Create the "idle citizen" type (represents unassigned citizens)
   */
  static createIdle(): CitizenTileType {
    return {
      id: 'idle',
      production: {
        [OutputType.FOOD]: 0,
        [OutputType.SHIELD]: 0,
        [OutputType.TRADE]: 0,
        [OutputType.GOLD]: 0,
        [OutputType.LUXURY]: 0,
        [OutputType.SCIENCE]: 0,
      },
      estimated_fitness: 0,
      is_specialist: true,
      specialist_type: SpecialistType.WORKER, // Idle workers
      tile_indices: [],
      available_count: Number.MAX_SAFE_INTEGER, // Unlimited idle slots
      lattice_index: -1,
      lattice_depth: 0,
      better_types: [],
      worse_types: [],
    };
  }
}

/**
 * Utility functions for CitizenTileType manipulation and analysis
 */
export class CitizenTileTypeUtils {
  /**
   * Calculate estimated fitness using weighted factors
   */
  static calculateFitness(tileType: CitizenTileType, factors: Record<OutputType, number>): number {
    let fitness = 0;
    for (const [outputType, amount] of Object.entries(tileType.production)) {
      fitness += amount * factors[outputType as OutputType];
    }
    return fitness;
  }

  /**
   * Update fitness for a tile type using given factors
   */
  static updateFitness(tileType: CitizenTileType, factors: Record<OutputType, number>): void {
    tileType.estimated_fitness = this.calculateFitness(tileType, factors);
  }

  /**
   * Compare two tile types for dominance
   * Returns true if type1 is strictly better than type2 (dominates in all outputs)
   */
  static dominates(type1: CitizenTileType, type2: CitizenTileType): boolean {
    let strictlyBetter = false;

    for (const outputType of Object.values(OutputType)) {
      const prod1 = type1.production[outputType];
      const prod2 = type2.production[outputType];

      if (prod1 < prod2) {
        return false; // type1 is worse in this output
      }

      if (prod1 > prod2) {
        strictlyBetter = true;
      }
    }

    return strictlyBetter;
  }

  /**
   * Build dominance relationships between tile types
   */
  static buildDominanceRelationships(tileTypes: CitizenTileType[]): void {
    // Clear existing relationships
    for (const tileType of tileTypes) {
      tileType.better_types = [];
      tileType.worse_types = [];
    }

    // Build dominance graph
    for (let i = 0; i < tileTypes.length; i++) {
      for (let j = 0; j < tileTypes.length; j++) {
        if (i !== j) {
          if (this.dominates(tileTypes[i], tileTypes[j])) {
            tileTypes[i].worse_types.push(tileTypes[j]);
            tileTypes[j].better_types.push(tileTypes[i]);
          }
        }
      }
    }
  }

  /**
   * Sort tile types by fitness (best first)
   */
  static sortByFitness(tileTypes: CitizenTileType[]): CitizenTileType[] {
    return [...tileTypes].sort((a, b) => b.estimated_fitness - a.estimated_fitness);
  }

  /**
   * Generate a unique string key for a production pattern
   */
  static getProductionKey(production: Record<OutputType, number>): string {
    const values = Object.values(OutputType).map(type => production[type]);
    return values.join(',');
  }

  /**
   * Group tiles by their production output to create tile types
   */
  static groupTilesByProduction(
    tiles: Array<{ index: number; production: Record<OutputType, number> }>
  ): CitizenTileType[] {
    const productionGroups = new Map<string, number[]>();

    // Group tiles by production pattern
    for (const tile of tiles) {
      const key = this.getProductionKey(tile.production);
      if (!productionGroups.has(key)) {
        productionGroups.set(key, []);
      }
      productionGroups.get(key)!.push(tile.index);
    }

    // Create tile types from groups
    const tileTypes: CitizenTileType[] = [];
    let typeIndex = 0;

    for (const [_productionKey, tileIndices] of productionGroups.entries()) {
      // Reconstruct production from first tile in group
      const firstTile = tiles.find(t => t.index === tileIndices[0])!;

      const tileType = CitizenTileTypeFactory.createFromTileOutput(
        `tiles_${typeIndex++}`,
        firstTile.production,
        tileIndices
      );

      tileTypes.push(tileType);
    }

    return tileTypes;
  }

  /**
   * Create a human-readable description of a tile type
   */
  static describe(tileType: CitizenTileType): string {
    const outputs = Object.entries(tileType.production)
      .filter(([, amount]) => amount > 0)
      .map(([type, amount]) => `${amount} ${type}`)
      .join(', ');

    const prefix = tileType.is_specialist
      ? `${tileType.specialist_type} specialist`
      : `Tile (${tileType.available_count} available)`;

    return `${prefix}: ${outputs || 'no output'} (fitness: ${tileType.estimated_fitness.toFixed(1)})`;
  }
}
