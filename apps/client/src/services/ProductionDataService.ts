/**
 * ProductionDataService - Client-side service for production data
 *
 * Provides available production options and costs, referencing server constants
 * to maintain consistency with game rules.
 */

import type { ProductionOption } from '../types';

// Unit costs from server constants (sync with apps/server/src/game/constants/UnitConstants.ts)
const UNIT_COSTS: Record<string, number> = {
  warrior: 10,
  settler: 40,
  scout: 25,
  worker: 50,
  engineer: 100,
  archer: 50,
  spearman: 45,
  diplomat: 30,
  caravan: 50,
};

// Building costs from server constants (sync with apps/server/src/game/managers/CityManager.ts)
const BUILDING_COSTS: Record<string, number> = {
  granary: 60,
  barracks: 40,
  library: 80,
  marketplace: 80,
  temple: 40,
  walls: 80,
  factory: 140,
  palace: 200,
};

// Wonder costs (basic set)
const WONDER_COSTS: Record<string, number> = {
  pyramids: 200,
  lighthouse: 200,
  oracle: 300,
  colossus: 200,
  hanging_gardens: 200,
};

export class ProductionDataService {
  /**
   * Get all available production options
   * In a full implementation, this would check player tech, resources, etc.
   */
  static getAvailableProductions(): ProductionOption[] {
    const units: ProductionOption[] = Object.entries(UNIT_COSTS).map(([id, cost]) => ({
      id,
      name: this.getUnitDisplayName(id),
      type: 'unit',
      cost,
      available: true, // TODO: Check tech requirements
      description: this.getUnitDescription(id),
    }));

    const buildings: ProductionOption[] = Object.entries(BUILDING_COSTS).map(([id, cost]) => ({
      id,
      name: this.getBuildingDisplayName(id),
      type: 'building',
      cost,
      available: true, // TODO: Check tech requirements and existing buildings
      description: this.getBuildingDescription(id),
    }));

    const wonders: ProductionOption[] = Object.entries(WONDER_COSTS).map(([id, cost]) => ({
      id,
      name: this.getWonderDisplayName(id),
      type: 'wonder',
      cost,
      available: true, // TODO: Check tech requirements and world state
      description: this.getWonderDescription(id),
    }));

    return [...units, ...buildings, ...wonders];
  }

  /**
   * Get production cost by type and ID
   */
  static getProductionCost(id: string, type: 'unit' | 'building' | 'wonder'): number {
    switch (type) {
      case 'unit':
        return UNIT_COSTS[id] || 10;
      case 'building':
        return BUILDING_COSTS[id] || 40;
      case 'wonder':
        return WONDER_COSTS[id] || 100;
      default:
        return 10;
    }
  }

  /**
   * Get available units
   */
  static getAvailableUnits(): ProductionOption[] {
    return this.getAvailableProductions().filter(p => p.type === 'unit');
  }

  /**
   * Get available buildings
   */
  static getAvailableBuildings(): ProductionOption[] {
    return this.getAvailableProductions().filter(p => p.type === 'building');
  }

  /**
   * Get available wonders
   */
  static getAvailableWonders(): ProductionOption[] {
    return this.getAvailableProductions().filter(p => p.type === 'wonder');
  }

  // Display name helpers
  private static getUnitDisplayName(id: string): string {
    const names: Record<string, string> = {
      warrior: 'Warrior',
      settler: 'Settler',
      scout: 'Scout',
      worker: 'Worker',
      engineer: 'Engineer',
      archer: 'Archer',
      spearman: 'Spearman',
      diplomat: 'Diplomat',
      caravan: 'Caravan',
    };
    return names[id] || id.charAt(0).toUpperCase() + id.slice(1);
  }

  private static getBuildingDisplayName(id: string): string {
    const names: Record<string, string> = {
      granary: 'Granary',
      barracks: 'Barracks',
      library: 'Library',
      marketplace: 'Marketplace',
      temple: 'Temple',
      walls: 'City Walls',
      factory: 'Factory',
      palace: 'Palace',
    };
    return names[id] || id.charAt(0).toUpperCase() + id.slice(1);
  }

  private static getWonderDisplayName(id: string): string {
    const names: Record<string, string> = {
      pyramids: 'Pyramids',
      lighthouse: 'Lighthouse',
      oracle: 'Oracle',
      colossus: 'Colossus',
      hanging_gardens: 'Hanging Gardens',
    };
    return names[id] || id.charAt(0).toUpperCase() + id.slice(1);
  }

  // Description helpers
  private static getUnitDescription(id: string): string {
    const descriptions: Record<string, string> = {
      warrior: 'Basic military unit',
      settler: 'Founds new cities',
      scout: 'Fast exploration unit',
      worker: 'Builds terrain improvements',
      engineer: 'Advanced terrain improvements',
      archer: 'Ranged military unit',
      spearman: 'Defensive military unit',
      diplomat: 'Espionage and negotiation unit',
      caravan: 'Trade and wonder building unit',
    };
    return descriptions[id] || 'Military unit';
  }

  private static getBuildingDescription(id: string): string {
    const descriptions: Record<string, string> = {
      granary: 'Stores food and helps city growth',
      barracks: 'Trains veteran units',
      library: 'Increases science output',
      marketplace: 'Increases trade income',
      temple: 'Makes citizens happy',
      walls: 'Defends the city',
      factory: 'Increases shield production',
      palace: 'Seat of government',
    };
    return descriptions[id] || 'City building';
  }

  private static getWonderDescription(id: string): string {
    const descriptions: Record<string, string> = {
      pyramids: 'Granary effect in all cities',
      lighthouse: 'Safe sea travel for all ships',
      oracle: 'Temple effect in all cities',
      colossus: 'Trade bonus in city',
      hanging_gardens: 'City growth bonus',
    };
    return descriptions[id] || 'World wonder';
  }
}
