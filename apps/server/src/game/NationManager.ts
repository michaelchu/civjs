/**
 * Nation Manager for CivJS Server
 * 
 * Manages all nation-related functionality including:
 * - Loading nation data from JSON files
 * - Nation selection validation and conflict resolution
 * - Nation sets and groups management
 * - AI trait assignment
 * - Nation customization support
 * 
 * Based on freeciv nation system design with full compatibility.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { 
  Nation, 
  NationSet, 
  NationGroupDefinition, 
  NationCustomization,
  AITraits,
  CulturalStyle,
  NationGroup
} from '../../../shared/src/types/nations';

interface NationData {
  metadata: {
    convertedAt: string;
    totalNations: number;
    playableNations: number;
    source: string;
  };
  nations: Record<string, Nation>;
}

interface NationSetsData {
  sets: NationSet[];
  groups: NationGroupDefinition[];
}

export class NationManager {
  private nations: Map<string, Nation> = new Map();
  private nationSets: Map<string, NationSet> = new Map();
  private nationGroups: Map<string, NationGroupDefinition> = new Map();
  private loaded: boolean = false;

  /**
   * Load all nation data from JSON files at server startup
   */
  async loadNationData(): Promise<void> {
    if (this.loaded) {
      return;
    }

    console.log('🌍 Loading nation data...');

    try {
      // Load main nations data
      const nationsPath = join(__dirname, '../../../shared/src/data/nations.json');
      const nationsData: NationData = JSON.parse(readFileSync(nationsPath, 'utf8'));

      // Load nation sets and groups
      const setsPath = join(__dirname, '../../../shared/src/data/nation-sets.json');
      const setsData: NationSetsData = JSON.parse(readFileSync(setsPath, 'utf8'));

      // Store nations in map for efficient lookup
      for (const [id, nation] of Object.entries(nationsData.nations)) {
        this.nations.set(id, nation);
      }

      // Store sets and groups
      for (const set of setsData.sets) {
        this.nationSets.set(set.ruleName, set);
      }

      for (const group of setsData.groups) {
        this.nationGroups.set(group.name.toLowerCase(), group);
      }

      console.log(`✅ Loaded ${this.nations.size} nations, ${this.nationSets.size} sets, ${this.nationGroups.size} groups`);
      console.log(`📊 Playable nations: ${nationsData.metadata.playableNations}`);
      
      this.loaded = true;
    } catch (error) {
      console.error('❌ Failed to load nation data:', error);
      throw new Error('Failed to initialize nation system');
    }
  }

  /**
   * Get all nations (optionally filtered by playable status)
   */
  getAllNations(playableOnly: boolean = false): Nation[] {
    this.ensureLoaded();
    
    const nations = Array.from(this.nations.values());
    return playableOnly ? nations.filter(n => n.isPlayable) : nations;
  }

  /**
   * Get nation by ID
   */
  getNation(nationId: string): Nation | null {
    this.ensureLoaded();
    return this.nations.get(nationId) || null;
  }

  /**
   * Get nations for specific set (core/extended/all)
   */
  getNationsForSet(setName: string): Nation[] {
    this.ensureLoaded();
    
    const set = this.nationSets.get(setName);
    if (!set) {
      console.warn(`Unknown nation set: ${setName}`);
      return [];
    }

    return set.nations
      .map(id => this.nations.get(id))
      .filter((nation): nation is Nation => nation !== undefined);
  }

  /**
   * Get nations for specific group (Ancient, European, etc.)
   */
  getNationsForGroup(groupName: string): Nation[] {
    this.ensureLoaded();
    
    const group = this.nationGroups.get(groupName.toLowerCase());
    if (!group) {
      console.warn(`Unknown nation group: ${groupName}`);
      return [];
    }

    return group.nations
      .map(id => this.nations.get(id))
      .filter((nation): nation is Nation => nation !== undefined);
  }

  /**
   * Get available nations for a game, excluding conflicts and already selected nations
   */
  getAvailableNations(
    gameId: string, 
    selectedNations: string[] = [],
    setName: string = 'core'
  ): Nation[] {
    this.ensureLoaded();
    
    const setNations = this.getNationsForSet(setName);
    const available: Nation[] = [];

    for (const nation of setNations) {
      if (this.isNationAvailable(nation, selectedNations)) {
        available.push(nation);
      }
    }

    return available;
  }

  /**
   * Check if a nation can be selected given current game state
   */
  isNationAvailable(nation: Nation, selectedNations: string[]): boolean {
    // Already selected
    if (selectedNations.includes(nation.id)) {
      return false;
    }

    // Not playable (e.g., barbarian nations)
    if (!nation.isPlayable) {
      return false;
    }

    // Check conflicts with already selected nations
    for (const selectedId of selectedNations) {
      const selectedNation = this.nations.get(selectedId);
      if (!selectedNation) continue;

      // Direct conflict
      if (nation.conflictsWith.includes(selectedId) || 
          selectedNation.conflictsWith.includes(nation.id)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate nation selection and return any conflicts
   */
  validateNationSelection(
    nationId: string, 
    selectedNations: string[]
  ): { valid: boolean; conflicts: string[]; reason?: string } {
    this.ensureLoaded();
    
    const nation = this.nations.get(nationId);
    
    if (!nation) {
      return { valid: false, conflicts: [], reason: 'Nation not found' };
    }

    if (!nation.isPlayable) {
      return { valid: false, conflicts: [], reason: 'Nation is not playable' };
    }

    if (selectedNations.includes(nationId)) {
      return { valid: false, conflicts: [], reason: 'Nation already selected' };
    }

    const conflicts: string[] = [];

    // Check for conflicts with selected nations
    for (const selectedId of selectedNations) {
      const selectedNation = this.nations.get(selectedId);
      if (!selectedNation) continue;

      if (nation.conflictsWith.includes(selectedId) || 
          selectedNation.conflictsWith.includes(nation.id)) {
        conflicts.push(selectedId);
      }
    }

    if (conflicts.length > 0) {
      return { 
        valid: false, 
        conflicts, 
        reason: `Conflicts with: ${conflicts.join(', ')}` 
      };
    }

    return { valid: true, conflicts: [] };
  }

  /**
   * Get random nation from a specific group or set
   */
  getRandomNation(
    criteria: {
      set?: string;
      group?: NationGroup;
      excludeNations?: string[];
      playableOnly?: boolean;
    } = {}
  ): Nation | null {
    this.ensureLoaded();
    
    let candidates: Nation[];

    if (criteria.set) {
      candidates = this.getNationsForSet(criteria.set);
    } else if (criteria.group) {
      candidates = this.getNationsForGroup(criteria.group);
    } else {
      candidates = this.getAllNations(criteria.playableOnly);
    }

    // Filter out excluded nations
    if (criteria.excludeNations) {
      candidates = candidates.filter(n => !criteria.excludeNations!.includes(n.id));
    }

    // Filter by playable status
    if (criteria.playableOnly) {
      candidates = candidates.filter(n => n.isPlayable);
    }

    if (candidates.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
  }

  /**
   * Get suggested nations for balanced team assignment
   * Uses nation groups and AI match preferences
   */
  getSuggestedNationsForTeam(
    teamSize: number,
    setName: string = 'core',
    preferredGroups: NationGroup[] = []
  ): Nation[] {
    this.ensureLoaded();
    
    const suggestions: Nation[] = [];
    const availableNations = this.getNationsForSet(setName);
    const usedNations = new Set<string>();

    // If preferred groups specified, try to match them first
    for (const group of preferredGroups) {
      const groupNations = this.getNationsForGroup(group)
        .filter(n => availableNations.includes(n) && !usedNations.has(n.id));
      
      if (groupNations.length > 0 && suggestions.length < teamSize) {
        const randomNation = groupNations[Math.floor(Math.random() * groupNations.length)];
        suggestions.push(randomNation);
        usedNations.add(randomNation.id);
      }
    }

    // Fill remaining slots with compatible nations
    while (suggestions.length < teamSize) {
      const remaining = availableNations.filter(n => 
        !usedNations.has(n.id) && 
        this.isNationAvailable(n, Array.from(usedNations))
      );

      if (remaining.length === 0) break;

      const randomNation = remaining[Math.floor(Math.random() * remaining.length)];
      suggestions.push(randomNation);
      usedNations.add(randomNation.id);
    }

    return suggestions;
  }

  /**
   * Apply nation customization (custom names, leaders, etc.)
   */
  customizeNation(
    playerId: string, 
    nationId: string, 
    customization: NationCustomization
  ): Nation | null {
    this.ensureLoaded();
    
    const baseNation = this.nations.get(nationId);
    if (!baseNation) {
      return null;
    }

    // Create customized copy (don't modify original)
    const customizedNation: Nation = {
      ...baseNation,
      name: customization.customName || baseNation.name,
      plural: customization.customPlural || baseNation.plural,
      leaders: customization.customLeader 
        ? [customization.customLeader, ...baseNation.leaders]
        : baseNation.leaders
    };

    return customizedNation;
  }

  /**
   * Get AI traits for a nation (with fallback to defaults)
   */
  getAITraitsForNation(nationId: string): AITraits {
    this.ensureLoaded();
    
    const nation = this.nations.get(nationId);
    
    // Use nation-specific traits if available
    if (nation?.traits) {
      return nation.traits;
    }

    // Fallback to defaults based on nation characteristics
    const defaults: AITraits = {
      expansionist: 50,
      trader: 50,
      aggressive: 50,
      builder: 50
    };

    if (nation) {
      // Adjust defaults based on nation groups
      if (nation.groups.includes('Ancient')) {
        defaults.aggressive = 60;
        defaults.expansionist = 60;
      }
      
      if (nation.groups.includes('Modern')) {
        defaults.trader = 60;
        defaults.builder = 60;
      }
      
      if (nation.groups.includes('Barbarian')) {
        defaults.aggressive = 80;
        defaults.expansionist = 70;
        defaults.trader = 20;
        defaults.builder = 30;
      }
    }

    return defaults;
  }

  /**
   * Get cultural style information for theming
   */
  getCulturalStyleInfo(style: CulturalStyle): { 
    themeColor: string; 
    buildingPrefix: string; 
    musicTheme?: string 
  } {
    const styleMap = {
      'European': { themeColor: '#4a5568', buildingPrefix: 'european', musicTheme: 'classical' },
      'Classical': { themeColor: '#744210', buildingPrefix: 'classical', musicTheme: 'ancient' },
      'Asian': { themeColor: '#e53e3e', buildingPrefix: 'asian', musicTheme: 'oriental' },
      'Tropical': { themeColor: '#38a169', buildingPrefix: 'tropical', musicTheme: 'tribal' },
      'Babylonian': { themeColor: '#d69e2e', buildingPrefix: 'babylonian', musicTheme: 'ancient' },
      'Celtic': { themeColor: '#319795', buildingPrefix: 'celtic', musicTheme: 'folk' }
    };

    return styleMap[style] || styleMap['European'];
  }

  /**
   * Get nation statistics for admin/debug purposes
   */
  getStatistics(): {
    total: number;
    playable: number;
    barbarian: number;
    byGroup: Record<string, number>;
    byStyle: Record<string, number>;
  } {
    this.ensureLoaded();
    
    const stats = {
      total: this.nations.size,
      playable: 0,
      barbarian: 0,
      byGroup: {} as Record<string, number>,
      byStyle: {} as Record<string, number>
    };

    for (const nation of this.nations.values()) {
      if (nation.isPlayable) stats.playable++;
      if (nation.barbarianType) stats.barbarian++;

      // Count by groups
      for (const group of nation.groups) {
        stats.byGroup[group] = (stats.byGroup[group] || 0) + 1;
      }

      // Count by style
      stats.byStyle[nation.style] = (stats.byStyle[nation.style] || 0) + 1;
    }

    return stats;
  }

  /**
   * Ensure nation data is loaded before operations
   */
  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('Nation data not loaded. Call loadNationData() first.');
    }
  }

  /**
   * Get all available nation sets
   */
  getNationSets(): NationSet[] {
    this.ensureLoaded();
    return Array.from(this.nationSets.values());
  }

  /**
   * Get all nation groups
   */
  getNationGroups(includeHidden: boolean = false): NationGroupDefinition[] {
    this.ensureLoaded();
    const groups = Array.from(this.nationGroups.values());
    return includeHidden ? groups : groups.filter(g => !g.hidden);
  }
}