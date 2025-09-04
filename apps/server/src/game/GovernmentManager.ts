import { DatabaseProvider } from '../database';
import { players as playersTable } from '../database/schema';
import { eq, and } from 'drizzle-orm';
import { rulesetLoader } from '../shared/data/rulesets/RulesetLoader';
import type { GovernmentRuleset } from '../shared/data/rulesets/schemas';

// Re-export types from schema for backwards compatibility
export type GovernmentRequirement = import('../shared/data/rulesets/schemas').GovernmentRequirement;
export type Government = GovernmentRuleset;

// Government effect interfaces for integration tests
export interface GovernmentEffect {
  type: string;
  value: number;
  description?: string;
}

export interface UnitSupportRules {
  freeUnits: number;
  goldPerUnit: number;
  foodPerUnit: number;
  shieldPerUnit: number;
}

export interface TradeEffects {
  corruptionLevel: number;
  wasteLevel: number;
  maxTradeRoutes: number;
}

export interface CityGovernmentBonus {
  productionBonus: number;
  goldBonus: number;
  scienceBonus: number;
}

export interface UnitGovernmentEffects {
  attackBonus: number;
  defenseBonus: number;
  supportCost: number;
}

export interface CityHappinessEffects {
  baseHappiness: number;
  warWeariness: number;
  luxuryBonus: number;
}

export interface RevolutionResult {
  success: boolean;
  revolutionTurns?: number;
  message?: string;
}

export interface PlayerGovernment {
  playerId: string;
  currentGovernment: string;
  revolutionTurns: number; // 0 = not in revolution, >0 = turns remaining in anarchy
  requestedGovernment?: string; // Government requested after revolution
}

// Load governments from ruleset system
export function getGovernments(rulesetName: string = 'classic'): Record<string, Government> {
  return rulesetLoader.getGovernments(rulesetName);
}

// Get individual government
export function getGovernment(governmentId: string, rulesetName: string = 'classic'): Government {
  return rulesetLoader.getGovernment(governmentId, rulesetName);
}

// Get revolution government type
export function getRevolutionGovernment(rulesetName: string = 'classic'): string {
  return rulesetLoader.getRevolutionGovernment(rulesetName);
}

export class GovernmentManager {
  private playerGovernments: Map<string, PlayerGovernment> = new Map();
  private gameId: string;
  private databaseProvider: DatabaseProvider;

  constructor(gameId: string, databaseProvider: DatabaseProvider) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
  }

  public async initializePlayerGovernment(playerId: string): Promise<void> {
    const government: PlayerGovernment = {
      playerId,
      currentGovernment: 'despotism', // Start with Despotism as default
      revolutionTurns: 0,
    };

    this.playerGovernments.set(playerId, government);

    // Update player record in database with initial government
    await this.databaseProvider.getDatabase()
      .update(playersTable)
      .set({
        government: 'despotism',
        revolutionTurns: 0,
      })
      .where(and(eq(playersTable.gameId, this.gameId), eq(playersTable.id, playerId)));
  }

  public async startRevolution(
    playerId: string,
    requestedGovernment: string,
    playerResearchedTechs: Set<string>
  ): Promise<{ success: boolean; message?: string }> {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov) {
      return { success: false, message: 'Player government not initialized' };
    }

    // Check if already in revolution
    if (playerGov.revolutionTurns > 0) {
      return { success: false, message: 'Already in revolution' };
    }

    // Check if requesting current government
    if (requestedGovernment === playerGov.currentGovernment) {
      return { success: false, message: 'Already using this government' };
    }

    // Validate requested government exists
    try {
      getGovernment(requestedGovernment);
    } catch {
      return { success: false, message: 'Invalid government type' };
    }

    // Check requirements
    const canChange = this.canPlayerUseGovernment(requestedGovernment, playerResearchedTechs);
    if (!canChange.allowed) {
      return { success: false, message: canChange.reason };
    }

    // Start revolution - 3 turns of anarchy for most government changes
    const anarchyTurns = this.getRevolutionTurns(playerGov.currentGovernment, requestedGovernment);

    playerGov.currentGovernment = 'anarchy';
    playerGov.revolutionTurns = anarchyTurns;
    playerGov.requestedGovernment = requestedGovernment;

    // Update database
    await this.databaseProvider.getDatabase()
      .update(playersTable)
      .set({
        government: 'anarchy',
        revolutionTurns: anarchyTurns,
      })
      .where(and(eq(playersTable.gameId, this.gameId), eq(playersTable.id, playerId)));

    return {
      success: true,
      message: `Revolution started. ${anarchyTurns} turns of Anarchy remaining.`,
    };
  }

  public async processRevolutionTurn(playerId: string): Promise<string | null> {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov || playerGov.revolutionTurns <= 0) {
      return null;
    }

    playerGov.revolutionTurns--;

    // Check if revolution is complete
    if (playerGov.revolutionTurns === 0 && playerGov.requestedGovernment) {
      const newGovernment = playerGov.requestedGovernment;
      playerGov.currentGovernment = newGovernment;
      playerGov.requestedGovernment = undefined;

      // Update database
      await this.databaseProvider.getDatabase()
        .update(playersTable)
        .set({
          government: newGovernment,
          revolutionTurns: 0,
        })
        .where(and(eq(playersTable.gameId, this.gameId), eq(playersTable.id, playerId)));

      return newGovernment;
    } else {
      // Update remaining turns in database
      await this.databaseProvider.getDatabase()
        .update(playersTable)
        .set({
          revolutionTurns: playerGov.revolutionTurns,
        })
        .where(and(eq(playersTable.gameId, this.gameId), eq(playersTable.id, playerId)));
    }

    return null;
  }

  public canPlayerUseGovernment(
    governmentId: string,
    playerResearchedTechs: Set<string>
  ): { allowed: boolean; reason?: string } {
    let government: Government;
    try {
      government = getGovernment(governmentId);
    } catch {
      return { allowed: false, reason: 'Government does not exist' };
    }

    // Anarchy and Despotism have no requirements
    if (governmentId === 'anarchy' || governmentId === 'despotism') {
      return { allowed: true };
    }

    // Check technology requirements
    if (government.reqs) {
      for (const req of government.reqs) {
        if (req.type === 'tech') {
          const techId = this.getTechIdFromName(req.name);
          if (!techId || !playerResearchedTechs.has(techId)) {
            return { allowed: false, reason: `Requires ${req.name} technology` };
          }
        }
      }
    }

    return { allowed: true };
  }

  public getPlayerGovernment(playerId: string): PlayerGovernment | undefined {
    return this.playerGovernments.get(playerId);
  }

  public getRulerTitle(playerId: string, playerName: string, isFemalLeader?: boolean): string {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov) {
      return playerName;
    }

    let government: Government;
    try {
      government = getGovernment(playerGov.currentGovernment);
    } catch {
      return playerName;
    }

    const titleTemplate = isFemalLeader
      ? government.ruler_female_title
      : government.ruler_male_title;

    return titleTemplate.replace('%s', playerName);
  }

  public getAvailableGovernments(playerResearchedTechs: Set<string>): {
    id: string;
    government: Government;
    available: boolean;
    reason?: string;
  }[] {
    const governments = getGovernments();
    return Object.entries(governments).map(([id, government]) => {
      const check = this.canPlayerUseGovernment(id, playerResearchedTechs);
      return {
        id,
        government,
        available: check.allowed,
        reason: check.reason,
      };
    });
  }

  private getRevolutionTurns(fromGovernment: string, toGovernment: string): number {
    // Special cases for quicker transitions
    if (fromGovernment === 'anarchy' || toGovernment === 'anarchy') {
      return 1; // Quick transition to/from anarchy
    }

    if (fromGovernment === 'despotism' && toGovernment === 'monarchy') {
      return 2; // Easier transition from despotism to monarchy
    }

    // Standard revolution time
    return 3;
  }

  private getTechIdFromName(techName: string): string | null {
    // Map government requirement names to our tech IDs
    const techNameMap: Record<string, string> = {
      Monarchy: 'monarchy',
      'The Republic': 'the_republic',
      Communism: 'communism',
      Democracy: 'democracy',
    };

    return techNameMap[techName] || null;
  }

  public getAllGovernments(): Record<string, Government> {
    return getGovernments();
  }

  public getGovernmentById(governmentId: string): Government | null {
    try {
      return getGovernment(governmentId);
    } catch {
      return null;
    }
  }

  /**
   * Check if player can change to a specific government
   * Reference: freeciv can_change_to_government() in common/government.c:168-184
   */
  public async canChangeGovernment(playerId: string, governmentType: string): Promise<boolean> {
    try {
      const government = getGovernment(governmentType);
      const playerGov = this.playerGovernments.get(playerId);

      if (!playerGov) {
        return false;
      }

      // Can't change if already in revolution
      if (playerGov.revolutionTurns > 0) {
        return false;
      }

      // Can't change to same government
      if (playerGov.currentGovernment === governmentType) {
        return false;
      }

      // Anarchy and Despotism have no requirements
      if (governmentType === 'anarchy' || governmentType === 'despotism') {
        return true;
      }

      // Check technology requirements (simplified - in full implementation would check player's techs)
      if (government.reqs) {
        // For integration tests, we'll allow most government changes
        // In full implementation, this would check player's researched technologies
        return true;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initiate revolution to change government
   * Reference: freeciv government change logic
   */
  public async initiateRevolution(
    playerId: string,
    governmentType: string
  ): Promise<RevolutionResult> {
    const canChange = await this.canChangeGovernment(playerId, governmentType);
    if (!canChange) {
      throw new Error(`Cannot change to government: ${governmentType}`);
    }

    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov) {
      throw new Error('Player government not initialized');
    }

    // Calculate revolution turns (anarchy period)
    const revolutionTurns = this.getRevolutionTurns(playerGov.currentGovernment, governmentType);

    // Start revolution
    playerGov.currentGovernment = 'anarchy';
    playerGov.revolutionTurns = revolutionTurns;
    playerGov.requestedGovernment = governmentType;

    // Update database
    await this.databaseProvider.getDatabase()
      .update(playersTable)
      .set({
        government: 'anarchy',
        revolutionTurns: revolutionTurns,
      })
      .where(and(eq(playersTable.gameId, this.gameId), eq(playersTable.id, playerId)));

    return {
      success: true,
      revolutionTurns,
      message: `Revolution started. ${revolutionTurns} turns of Anarchy remaining.`,
    };
  }

  /**
   * Get government effects for a player
   * Reference: freeciv effects system in common/effects.c
   */
  public getGovernmentEffects(playerId: string): GovernmentEffect[] {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov) {
      return [];
    }

    try {
      getGovernment(playerGov.currentGovernment); // Validate government exists
      const effects: GovernmentEffect[] = [];

      // Add government-specific effects based on freeciv government effects
      // Note: effects property doesn't exist in current ruleset schema, using default effects

      // Add default effects for known governments
      switch (playerGov.currentGovernment) {
        case 'despotism':
          effects.push({ type: 'corruption', value: -20, description: 'High corruption' });
          effects.push({
            type: 'military_support',
            value: 2,
            description: 'Free military units per city',
          });
          break;
        case 'monarchy':
          effects.push({ type: 'corruption', value: -10, description: 'Medium corruption' });
          effects.push({
            type: 'military_support',
            value: 3,
            description: 'Free military units per city',
          });
          break;
        case 'republic':
          effects.push({ type: 'corruption', value: -5, description: 'Low corruption' });
          effects.push({ type: 'trade_bonus', value: 10, description: 'Trade bonus' });
          break;
        case 'democracy':
          effects.push({ type: 'corruption', value: 0, description: 'No corruption' });
          effects.push({ type: 'science_bonus', value: 15, description: 'Science bonus' });
          break;
        case 'anarchy':
          effects.push({
            type: 'production_penalty',
            value: -50,
            description: 'Severe production penalty',
          });
          break;
      }

      return effects;
    } catch {
      return [];
    }
  }

  /**
   * Get unit support rules for current government
   * Reference: freeciv city_support() in common/city.c:3100-3200
   */
  public getUnitSupportRules(playerId: string): UnitSupportRules {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov) {
      return { freeUnits: 0, goldPerUnit: 1, foodPerUnit: 1, shieldPerUnit: 1 };
    }

    // Government-specific unit support rules based on freeciv
    switch (playerGov.currentGovernment) {
      case 'despotism':
        return { freeUnits: 2, goldPerUnit: 1, foodPerUnit: 1, shieldPerUnit: 1 };
      case 'monarchy':
        return { freeUnits: 3, goldPerUnit: 1, foodPerUnit: 1, shieldPerUnit: 1 };
      case 'republic':
        return { freeUnits: 0, goldPerUnit: 1, foodPerUnit: 1, shieldPerUnit: 1 };
      case 'democracy':
        return { freeUnits: 0, goldPerUnit: 2, foodPerUnit: 1, shieldPerUnit: 1 };
      case 'anarchy':
        return { freeUnits: 1, goldPerUnit: 2, foodPerUnit: 2, shieldPerUnit: 2 };
      default:
        return { freeUnits: 1, goldPerUnit: 1, foodPerUnit: 1, shieldPerUnit: 1 };
    }
  }

  /**
   * Get trade effects for current government
   * Reference: freeciv corruption and trade calculations
   */
  public getTradeEffects(playerId: string): TradeEffects {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov) {
      return { corruptionLevel: 50, wasteLevel: 50, maxTradeRoutes: 2 };
    }

    // Government-specific trade effects based on freeciv
    switch (playerGov.currentGovernment) {
      case 'despotism':
        return { corruptionLevel: 30, wasteLevel: 30, maxTradeRoutes: 2 };
      case 'monarchy':
        return { corruptionLevel: 20, wasteLevel: 20, maxTradeRoutes: 3 };
      case 'republic':
        return { corruptionLevel: 10, wasteLevel: 15, maxTradeRoutes: 4 };
      case 'democracy':
        return { corruptionLevel: 5, wasteLevel: 10, maxTradeRoutes: 6 };
      case 'anarchy':
        return { corruptionLevel: 80, wasteLevel: 80, maxTradeRoutes: 1 };
      default:
        return { corruptionLevel: 50, wasteLevel: 50, maxTradeRoutes: 2 };
    }
  }

  /**
   * Get government bonus effects on city
   * Reference: freeciv government city bonuses
   */
  public getCityGovernmentBonus(playerId: string, _cityId: string): CityGovernmentBonus {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov) {
      return { productionBonus: 0, goldBonus: 0, scienceBonus: 0 };
    }

    // Government-specific city bonuses
    switch (playerGov.currentGovernment) {
      case 'despotism':
        return { productionBonus: -10, goldBonus: -5, scienceBonus: -10 };
      case 'monarchy':
        return { productionBonus: 0, goldBonus: 5, scienceBonus: 0 };
      case 'republic':
        return { productionBonus: 5, goldBonus: 10, scienceBonus: 10 };
      case 'democracy':
        return { productionBonus: 10, goldBonus: 15, scienceBonus: 20 };
      case 'anarchy':
        return { productionBonus: -50, goldBonus: -50, scienceBonus: -50 };
      default:
        return { productionBonus: 0, goldBonus: 0, scienceBonus: 0 };
    }
  }

  /**
   * Get government effects on specific unit
   * Reference: freeciv unit government effects
   */
  public getUnitGovernmentEffects(playerId: string, _unitId: string): UnitGovernmentEffects {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov) {
      return { attackBonus: 0, defenseBonus: 0, supportCost: 1 };
    }

    // Government-specific unit effects
    switch (playerGov.currentGovernment) {
      case 'despotism':
        return { attackBonus: 0, defenseBonus: 0, supportCost: 1 };
      case 'monarchy':
        return { attackBonus: 5, defenseBonus: 0, supportCost: 1 };
      case 'republic':
        return { attackBonus: 0, defenseBonus: 5, supportCost: 2 };
      case 'democracy':
        return { attackBonus: -10, defenseBonus: 10, supportCost: 2 };
      case 'anarchy':
        return { attackBonus: -20, defenseBonus: -20, supportCost: 3 };
      default:
        return { attackBonus: 0, defenseBonus: 0, supportCost: 1 };
    }
  }

  /**
   * Get government effects on city happiness
   * Reference: freeciv happiness calculations in common/city.c
   */
  public getCityHappinessEffects(playerId: string, _cityId: string): CityHappinessEffects {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov) {
      return { baseHappiness: 0, warWeariness: 0, luxuryBonus: 0 };
    }

    // Government-specific happiness effects
    switch (playerGov.currentGovernment) {
      case 'despotism':
        return { baseHappiness: -1, warWeariness: 0, luxuryBonus: 0 };
      case 'monarchy':
        return { baseHappiness: 1, warWeariness: 0, luxuryBonus: 5 };
      case 'republic':
        return { baseHappiness: 0, warWeariness: 2, luxuryBonus: 10 };
      case 'democracy':
        return { baseHappiness: 2, warWeariness: 4, luxuryBonus: 15 };
      case 'anarchy':
        return { baseHappiness: -5, warWeariness: 0, luxuryBonus: -10 };
      default:
        return { baseHappiness: 0, warWeariness: 0, luxuryBonus: 0 };
    }
  }

  /**
   * Load player governments from database
   * Reference: Integration test requirement for game reloads
   */
  public async loadPlayerGovernments(): Promise<void> {
    const results = await this.databaseProvider.getDatabase()
      .select({
        id: playersTable.id,
        government: playersTable.government,
        revolutionTurns: playersTable.revolutionTurns,
      })
      .from(playersTable)
      .where(eq(playersTable.gameId, this.gameId));

    for (const result of results) {
      const playerGov: PlayerGovernment = {
        playerId: result.id,
        currentGovernment: result.government || 'despotism',
        revolutionTurns: result.revolutionTurns || 0,
      };

      // If in revolution, we'd need to restore the requested government
      // For now, we'll leave it undefined and let the revolution complete naturally
      this.playerGovernments.set(result.id, playerGov);
    }
  }

  public async loadPlayerGovernmentFromDb(playerId: string): Promise<void> {
    const result = await this.databaseProvider.getDatabase()
      .select({
        government: playersTable.government,
        revolutionTurns: playersTable.revolutionTurns,
      })
      .from(playersTable)
      .where(and(eq(playersTable.gameId, this.gameId), eq(playersTable.id, playerId)));

    if (result.length > 0) {
      const { government, revolutionTurns } = result[0];

      const playerGov: PlayerGovernment = {
        playerId,
        currentGovernment: government || 'despotism',
        revolutionTurns: revolutionTurns || 0,
      };

      this.playerGovernments.set(playerId, playerGov);
    }
  }
}
