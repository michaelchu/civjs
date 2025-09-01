/**
 * Government Integration Manager - Coordinate all government-related systems
 * 
 * This manager coordinates between:
 * - GovernmentManager (government changes, revolution)
 * - EffectsManager (government effects calculation)
 * - PolicyManager (civic policies/multipliers)  
 * - CityManager (corruption, happiness integration)
 * - UnitSupportManager (unit support costs)
 * 
 * Ensures all government mechanics work together seamlessly.
 */

import { logger } from '../utils/logger';
import { GovernmentManager } from './GovernmentManager';
import { EffectsManager } from './EffectsManager';
import { PolicyManager } from './PolicyManager';
import { CityManager } from './CityManager';
import { UnitSupportManager, UnitSupportData } from './UnitSupportManager';

export interface GovernmentIntegrationConfig {
  gameId: string;
  effectsManager: EffectsManager;
  governmentManager: GovernmentManager;
  policyManager: PolicyManager;
  cityManager: CityManager;
  unitSupportManager: UnitSupportManager;
}

export interface PlayerGovernmentState {
  playerId: string;
  currentGovernment: string;
  revolutionTurns: number;
  requestedGovernment?: string;
  researchedTechs: Set<string>;
}

/**
 * Government Integration Manager - Central coordination for all government systems
 */
export class GovernmentIntegrationManager {
  private config: GovernmentIntegrationConfig;

  constructor(config: GovernmentIntegrationConfig) {
    this.config = config;
    this.setupIntegrations();
  }

  /**
   * Setup integrations between all government systems
   */
  private setupIntegrations(): void {
    // Connect CityManager with government systems
    this.config.cityManager.setGovernmentManager(this.config.governmentManager);
    
    logger.info(`Government integration setup complete for game ${this.config.gameId}`);
  }

  /**
   * Initialize government systems for a new player
   */
  public async initializePlayerGovernment(
    playerId: string,
    researchedTechs: Set<string>
  ): Promise<void> {
    await this.config.governmentManager.initializePlayerGovernment(playerId);
    await this.config.policyManager.initializePlayerPolicies(playerId);
    
    logger.info(`Initialized government systems for player ${playerId}`);
  }

  /**
   * Process government effects for all players at turn start
   */
  public async processGovernmentTurn(currentTurn: number): Promise<void> {
    // Process revolution turns for all players
    const playerGovernments = await this.getAllPlayerGovernments();
    
    for (const playerGov of playerGovernments) {
      const completedGovernment = await this.config.governmentManager.processRevolutionTurn(
        playerGov.playerId
      );
      
      if (completedGovernment) {
        logger.info(`Player ${playerGov.playerId} completed revolution to ${completedGovernment}`);
        
        // Apply new government effects to all player cities
        await this.applyGovernmentEffectsToPlayerCities(playerGov.playerId, completedGovernment);
      }
    }
  }

  /**
   * Handle government change request
   */
  public async requestGovernmentChange(
    playerId: string,
    requestedGovernment: string,
    currentTurn: number,
    playerResearchedTechs: Set<string>
  ): Promise<{ success: boolean; message?: string }> {
    const result = await this.config.governmentManager.startRevolution(
      playerId,
      requestedGovernment,
      playerResearchedTechs
    );

    if (result.success) {
      // Apply anarchy effects to all player cities
      await this.applyGovernmentEffectsToPlayerCities(playerId, 'anarchy');
      
      logger.info(`Player ${playerId} started revolution to ${requestedGovernment}`);
    }

    return result;
  }

  /**
   * Handle civic policy change request
   */
  public async requestPolicyChange(
    playerId: string,
    policyId: string,
    newValue: number,
    currentTurn: number,
    playerResearchedTechs: Set<string>
  ): Promise<{ success: boolean; message?: string }> {
    const result = await this.config.policyManager.changePolicyValue(
      playerId,
      policyId,
      newValue,
      currentTurn,
      playerResearchedTechs
    );

    if (result.success) {
      // Apply policy effects to all player cities  
      await this.applyGovernmentEffectsToPlayerCities(
        playerId, 
        await this.getPlayerCurrentGovernment(playerId)
      );
      
      logger.info(`Player ${playerId} changed policy ${policyId} to ${newValue}`);
    }

    return result;
  }

  /**
   * Apply government effects to all cities of a player
   */
  public async applyGovernmentEffectsToPlayerCities(
    playerId: string,
    currentGovernment: string
  ): Promise<void> {
    const playerCities = this.config.cityManager.getPlayerCities(playerId);
    
    for (const city of playerCities) {
      this.config.cityManager.refreshCityWithGovernmentEffects(city.id);
    }
    
    logger.debug(`Applied ${currentGovernment} effects to ${playerCities.length} cities for player ${playerId}`);
  }

  /**
   * Get comprehensive government information for a player
   */
  public async getPlayerGovernmentInfo(playerId: string): Promise<{
    currentGovernment: string;
    revolutionTurns: number;
    requestedGovernment?: string;
    availableGovernments: Array<{
      id: string;
      name: string;
      available: boolean;
      reason?: string;
    }>;
    currentPolicies: Array<{
      id: string;
      name: string;
      currentValue: number;
      canChange: boolean;
      reason?: string;
    }>;
  }> {
    const playerGov = this.config.governmentManager.getPlayerGovernment(playerId);
    if (!playerGov) {
      throw new Error(`Player government not found: ${playerId}`);
    }

    // Get available governments (requires tech checking)
    const playerTechs = new Set<string>(); // TODO: Get from ResearchManager
    const availableGovernments = this.config.governmentManager.getAvailableGovernments(playerTechs);
    
    // Get current policies
    const currentTurn = 0; // TODO: Get current turn from GameManager
    const currentPolicies = await this.config.policyManager.getAvailablePoliciesForPlayer(
      playerId,
      currentTurn,
      playerTechs
    );

    return {
      currentGovernment: playerGov.currentGovernment,
      revolutionTurns: playerGov.revolutionTurns,
      requestedGovernment: playerGov.requestedGovernment,
      availableGovernments: availableGovernments.map(gov => ({
        id: gov.id,
        name: gov.government.name,
        available: gov.available,
        reason: gov.reason
      })),
      currentPolicies: currentPolicies.map(policy => ({
        id: policy.policy.id,
        name: policy.policy.name,
        currentValue: policy.currentValue,
        canChange: policy.canChange,
        reason: policy.reason
      }))
    };
  }

  /**
   * Calculate unit support costs for all player cities
   */
  public calculatePlayerUnitSupport(
    playerId: string,
    currentGovernment: string,
    unitsData: UnitSupportData[]
  ): {
    totalCityUpkeepCosts: { food: number; shield: number; gold: number };
    totalNationalUpkeepCosts: { food: number; shield: number; gold: number };
    totalMilitaryUnhappiness: number;
  } {
    const playerCities = this.config.cityManager.getPlayerCities(playerId);
    
    // Group units by supporting city
    const unitsByCity = new Map<string, UnitSupportData[]>();
    for (const unit of unitsData) {
      const supportingCity = unit.homeCity;
      if (!unitsByCity.has(supportingCity)) {
        unitsByCity.set(supportingCity, []);
      }
      unitsByCity.get(supportingCity)!.push(unit);
    }

    // Calculate support for each city
    const citiesData = playerCities.map(city => ({
      cityId: city.id,
      population: city.population,
      unitsSupported: unitsByCity.get(city.id) || []
    }));

    return this.config.unitSupportManager.getPlayerUnitSupportSummary(
      playerId,
      currentGovernment,
      citiesData
    );
  }

  /**
   * Get all player government states
   */
  private async getAllPlayerGovernments(): Promise<PlayerGovernmentState[]> {
    // TODO: This would get all players from the game
    // For now, return empty array - will be implemented when integrated with GameManager
    return [];
  }

  /**
   * Get current government for a player
   */
  private async getPlayerCurrentGovernment(playerId: string): Promise<string> {
    const playerGov = this.config.governmentManager.getPlayerGovernment(playerId);
    return playerGov?.currentGovernment || 'despotism';
  }

  /**
   * Validate building construction against government requirements
   */
  public canBuildBuilding(
    playerId: string,
    buildingId: string,
    cityId: string,
    playerTechs: Set<string>
  ): { allowed: boolean; reason?: string } {
    const currentGovernment = this.config.governmentManager
      .getPlayerGovernment(playerId)?.currentGovernment || 'despotism';

    const result = this.config.effectsManager.canBuildWithGovernment(
      buildingId,
      currentGovernment,
      { playerId, cityId },
      playerTechs
    );

    return { allowed: result.satisfied, reason: result.reason };
  }

  /**
   * Get building effects under current government
   */
  public getBuildingEffects(
    playerId: string,
    buildingId: string,
    cityId: string
  ): Record<string, number> {
    const currentGovernment = this.config.governmentManager
      .getPlayerGovernment(playerId)?.currentGovernment || 'despotism';

    return this.config.effectsManager.getBuildingGovernmentEffects(
      buildingId,
      currentGovernment,
      { playerId, cityId }
    );
  }

  /**
   * Clean up all government systems
   */
  public cleanup(): void {
    this.config.policyManager.clearCache();
    this.config.effectsManager.clearCache();
    logger.info(`Government integration cleanup complete for game ${this.config.gameId}`);
  }
}