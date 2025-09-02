/**
 * Policy Manager - Civic Policies System (Multipliers)
 * Direct port of freeciv multipliers system from common/multipliers.c
 *
 * In freeciv, "multipliers" represent civic policies that players can adjust
 * to affect various game mechanics. Examples include:
 * - Tax rates (luxury/science/gold)
 * - Military policies affecting unit costs
 * - Economic policies affecting trade and production
 *
 * Reference: /reference/freeciv/common/multipliers.c, multipliers.h
 */

// import { db } from '../database';
// import { players as playersTable } from '../database/schema';
// import { eq, and } from 'drizzle-orm';
import { logger } from '../utils/logger';
import type { Requirement } from '../shared/data/rulesets/schemas';
// import { EffectsManager, EffectContext } from './EffectsManager';

// Policy definition - direct port of freeciv struct multiplier
export interface Policy {
  id: string;
  name: string;
  ruleditDisabled?: boolean; // Does not really exist - hole in multipliers array
  start: number; // Minimum value (display units)
  stop: number; // Maximum value (display units)
  step: number; // Step size for adjustments (display units)
  default: number; // Default value (display units)
  offset: number; // Formula: (ui_value + offset) * (factor/100) = effect_value
  factor: number; // Formula factor (usually 100 for 1:1 mapping)
  minimumTurns: number; // How often multiplier can be changed
  reqs?: Requirement[]; // Requirements for adjusting this policy
  helptext?: string; // Help text description
}

// Player policy value - port of freeciv struct multiplier_value
export interface PlayerPolicyValue {
  value: number; // Value currently in force
  targetValue: number; // Value player wants to change to
  changedTurn: number; // Turn when last changed (for minimum_turns check)
}

// Player policy state
export interface PlayerPolicies {
  playerId: string;
  policies: Map<string, PlayerPolicyValue>;
}

/**
 * PolicyManager - Civic Policies System
 * Direct port of freeciv multipliers architecture
 */
export class PolicyManager {
  private playerPolicies = new Map<string, PlayerPolicies>();
  private availablePolicies: Map<string, Policy> = new Map();

  constructor(_gameId: string, _effectsManager: any) {
    this.initializePolicies();
  }

  /**
   * Initialize available policies
   * In the full implementation, this would load from rulesets
   * For now, we'll define basic tax rate policies like freeciv
   */
  private initializePolicies(): void {
    // Basic tax rate policy (luxury/science/gold split)
    // This is conceptual - in freeciv this is handled differently
    // but demonstrates the multiplier system structure

    const taxRatePolicy: Policy = {
      id: 'tax_rates',
      name: 'Tax Allocation',
      start: 0,
      stop: 100,
      step: 10,
      default: 50,
      offset: 0,
      factor: 100,
      minimumTurns: 1, // Can change every turn
      helptext: 'Controls allocation of tax revenue between luxury, science, and gold',
    };

    // Economic focus policy
    const economicPolicy: Policy = {
      id: 'economic_focus',
      name: 'Economic Focus',
      start: 0,
      stop: 200,
      step: 25,
      default: 100,
      offset: -100,
      factor: 100,
      minimumTurns: 3, // Must wait 3 turns between changes
      helptext: 'Adjusts economic output vs military efficiency tradeoff',
    };

    this.availablePolicies.set(taxRatePolicy.id, taxRatePolicy);
    this.availablePolicies.set(economicPolicy.id, economicPolicy);

    logger.info(`Initialized ${this.availablePolicies.size} policies`);
  }

  /**
   * Initialize player policies
   * Reference: freeciv multipliers_init() and player initialization
   */
  public async initializePlayerPolicies(playerId: string): Promise<void> {
    const playerPolicies: PlayerPolicies = {
      playerId,
      policies: new Map(),
    };

    // Initialize each policy to default value
    for (const [policyId, policy] of this.availablePolicies) {
      playerPolicies.policies.set(policyId, {
        value: policy.default,
        targetValue: policy.default,
        changedTurn: 0,
      });
    }

    this.playerPolicies.set(playerId, playerPolicies);

    // TODO: Persist to database when we add policy persistence
    logger.info(`Initialized policies for player ${playerId}`);
  }

  /**
   * Get player's current policy value
   * Reference: freeciv player_multiplier_value()
   */
  public getPlayerPolicyValue(playerId: string, policyId: string): number {
    const playerPolicies = this.playerPolicies.get(playerId);
    if (!playerPolicies) {
      logger.warn(`No policies found for player ${playerId}`);
      return 0;
    }

    const policyValue = playerPolicies.policies.get(policyId);
    if (!policyValue) {
      const policy = this.availablePolicies.get(policyId);
      return policy?.default || 0;
    }

    return policyValue.value;
  }

  /**
   * Get player's target policy value (what they want to change to)
   * Reference: freeciv player_multiplier_target_value()
   */
  public getPlayerPolicyTargetValue(playerId: string, policyId: string): number {
    const playerPolicies = this.playerPolicies.get(playerId);
    if (!playerPolicies) {
      return this.getPlayerPolicyValue(playerId, policyId);
    }

    const policyValue = playerPolicies.policies.get(policyId);
    return policyValue?.targetValue || this.getPlayerPolicyValue(playerId, policyId);
  }

  /**
   * Get effective policy value for effects calculations
   * Reference: freeciv player_multiplier_effect_value()
   */
  public getPlayerPolicyEffectValue(playerId: string, policyId: string): number {
    const policy = this.availablePolicies.get(policyId);
    if (!policy) {
      logger.warn(`Policy ${policyId} not found`);
      return 100; // Default neutral multiplier
    }

    const value = this.getPlayerPolicyValue(playerId, policyId);

    // Formula from freeciv: (value + offset) * factor
    // Result is multiplied by 100 (caller should divide down)
    return (value + policy.offset) * policy.factor;
  }

  /**
   * Attempt to change a policy value
   * Reference: freeciv multiplier_can_be_changed() and related functions
   */
  public async changePolicyValue(
    playerId: string,
    policyId: string,
    newValue: number,
    currentTurn: number,
    playerResearchedTechs: Set<string>
  ): Promise<{ success: boolean; message?: string }> {
    const policy = this.availablePolicies.get(policyId);
    if (!policy) {
      return { success: false, message: 'Policy not found' };
    }

    const playerPolicies = this.playerPolicies.get(playerId);
    if (!playerPolicies) {
      return { success: false, message: 'Player policies not initialized' };
    }

    // Validate new value is within range
    if (newValue < policy.start || newValue > policy.stop) {
      return {
        success: false,
        message: `Value must be between ${policy.start} and ${policy.stop}`,
      };
    }

    // Validate step size
    if ((newValue - policy.start) % policy.step !== 0) {
      return {
        success: false,
        message: `Value must be in steps of ${policy.step}`,
      };
    }

    const currentPolicyValue = playerPolicies.policies.get(policyId);
    if (!currentPolicyValue) {
      return { success: false, message: 'Policy value not found' };
    }

    // Check minimum turns requirement
    const turnsSinceLastChange = currentTurn - currentPolicyValue.changedTurn;
    if (turnsSinceLastChange < policy.minimumTurns) {
      const turnsRemaining = policy.minimumTurns - turnsSinceLastChange;
      return {
        success: false,
        message: `Must wait ${turnsRemaining} more turns before changing this policy`,
      };
    }

    // Check requirements
    if (policy.reqs) {
      const canChange = await this.checkPolicyRequirements(
        playerId,
        policy.reqs,
        playerResearchedTechs
      );
      if (!canChange.allowed) {
        return { success: false, message: canChange.reason };
      }
    }

    // Apply the change
    currentPolicyValue.value = newValue;
    currentPolicyValue.targetValue = newValue;
    currentPolicyValue.changedTurn = currentTurn;

    // TODO: Persist to database

    logger.info(`Player ${playerId} changed policy ${policyId} to ${newValue}`);
    return {
      success: true,
      message: `Policy ${policy.name} changed to ${newValue}`,
    };
  }

  /**
   * Check if player can change a policy
   * Reference: freeciv multiplier_can_be_changed()
   */
  public async canChangePolicyValue(
    playerId: string,
    policyId: string,
    currentTurn: number,
    playerResearchedTechs: Set<string>
  ): Promise<{ allowed: boolean; reason?: string }> {
    const policy = this.availablePolicies.get(policyId);
    if (!policy) {
      return { allowed: false, reason: 'Policy not found' };
    }

    const playerPolicies = this.playerPolicies.get(playerId);
    if (!playerPolicies) {
      return { allowed: false, reason: 'Player policies not initialized' };
    }

    const currentPolicyValue = playerPolicies.policies.get(policyId);
    if (!currentPolicyValue) {
      return { allowed: false, reason: 'Policy value not found' };
    }

    // Check minimum turns requirement
    const turnsSinceLastChange = currentTurn - currentPolicyValue.changedTurn;
    if (turnsSinceLastChange < policy.minimumTurns) {
      const turnsRemaining = policy.minimumTurns - turnsSinceLastChange;
      return {
        allowed: false,
        reason: `Must wait ${turnsRemaining} more turns`,
      };
    }

    // Check requirements
    if (policy.reqs) {
      return await this.checkPolicyRequirements(playerId, policy.reqs, playerResearchedTechs);
    }

    return { allowed: true };
  }

  /**
   * Get all available policies
   */
  public getAvailablePolicies(): Map<string, Policy> {
    return new Map(this.availablePolicies);
  }

  /**
   * Get all player policies with current values
   */
  public getPlayerPolicies(playerId: string): Map<string, PlayerPolicyValue> | null {
    const playerPolicies = this.playerPolicies.get(playerId);
    return playerPolicies ? new Map(playerPolicies.policies) : null;
  }

  /**
   * Get policies available to a specific player
   * Filters by requirements the player can meet
   */
  public async getAvailablePoliciesForPlayer(
    playerId: string,
    currentTurn: number,
    playerResearchedTechs: Set<string>
  ): Promise<
    Array<{
      policy: Policy;
      currentValue: number;
      targetValue: number;
      canChange: boolean;
      reason?: string;
    }>
  > {
    const result = [];

    for (const [policyId, policy] of this.availablePolicies) {
      const currentValue = this.getPlayerPolicyValue(playerId, policyId);
      const targetValue = this.getPlayerPolicyTargetValue(playerId, policyId);
      const changeCheck = await this.canChangePolicyValue(
        playerId,
        policyId,
        currentTurn,
        playerResearchedTechs
      );

      result.push({
        policy,
        currentValue,
        targetValue,
        canChange: changeCheck.allowed,
        reason: changeCheck.reason,
      });
    }

    return result;
  }

  /**
   * Load player policies from database
   */
  public async loadPlayerPoliciesFromDb(playerId: string): Promise<void> {
    // TODO: Implement database loading when we add persistence
    // For now, just initialize to defaults
    await this.initializePlayerPolicies(playerId);
  }

  /**
   * Check policy requirements
   * Reference: freeciv requirements evaluation system
   */
  private async checkPolicyRequirements(
    _playerId: string,
    requirements: Requirement[],
    playerResearchedTechs: Set<string>
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Use effects manager to evaluate requirements
    // This ensures consistent requirement evaluation across all systems
    for (const req of requirements) {
      switch (req.type) {
        case 'Tech':
          if (!playerResearchedTechs.has(req.name)) {
            return {
              allowed: false,
              reason: `Requires technology: ${req.name}`,
            };
          }
          break;

        case 'Gov':
        case 'Government':
          // TODO: Check government when integrated
          break;

        // Add more requirement types as needed
        default:
          logger.warn(`Unsupported requirement type for policies: ${req.type}`);
          break;
      }
    }

    return { allowed: true };
  }

  /**
   * Clear policies cache (for testing)
   */
  public clearCache(): void {
    this.playerPolicies.clear();
  }
}

// Export types (already exported above)
// export { Policy, PlayerPolicyValue, PlayerPolicies };
