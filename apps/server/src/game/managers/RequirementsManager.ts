/**
 * Requirements Manager - Handles requirement evaluation including culture requirements
 *
 * Implements the freeciv requirements system with focus on VUT_MINCULTURE
 * Direct port of requirement evaluation logic from freeciv/common/requirements.c
 *
 * Reference files:
 * - /reference/freeciv/common/requirements.c (VUT_MINCULTURE handling)
 * - /reference/freeciv-web/javascript/fc_types.js (VUT_MINCULTURE = 29)
 * - /reference/freeciv-web/javascript/requirements.js (requirement evaluation)
 */

import { logger } from '@utils/logger';
import { CultureManager } from './CultureManager';
import type { EffectContext } from './EffectsManager';
import type { BuildingCultureRequirement } from '@shared/data/rulesets/schemas';

// Vulnerability/Requirement types from freeciv fc_types.js and requirements.c
export enum VulnerabilityType {
  VUT_NONE = 0,
  VUT_ADVANCE = 1,
  VUT_GOVERNMENT = 2,
  VUT_IMPROVEMENT = 3,
  VUT_TERRAIN = 4,
  VUT_NATION = 5,
  VUT_UTYPE = 6,
  VUT_UTFLAG = 7,
  VUT_UCLASS = 8,
  VUT_UCFLAG = 9,
  VUT_OTYPE = 10,
  VUT_SPECIALIST = 11,
  VUT_MINSIZE = 12,
  VUT_AI_LEVEL = 13,
  VUT_TERRAINCLASS = 14,
  VUT_MINYEAR = 15,
  VUT_TERRAINALTER = 16,
  VUT_CITYTILE = 17,
  VUT_GOOD = 18,
  VUT_TERRFLAG = 19,
  VUT_NATIONALITY = 20,
  VUT_BASEFLAG = 21,
  VUT_ROADFLAG = 22,
  VUT_EXTRA = 23,
  VUT_TECHFLAG = 24,
  VUT_ACHIEVEMENT = 25,
  VUT_DIPLREL = 26,
  VUT_MAXTILEUNITS = 27,
  VUT_STYLE = 28,
  VUT_MINCULTURE = 29, // Culture requirement type
  VUT_UNITSTATE = 30,
  VUT_MINMOVES = 31,
  VUT_MINVETERAN = 32,
  VUT_MINHP = 33,
  VUT_AGE = 34,
  VUT_NATIONGROUP = 35,
  VUT_TOPO = 36,
  VUT_IMPR_GENUS = 37,
  VUT_ACTION = 38,
  VUT_MINTECHS = 39,
  VUT_EXTRAFLAG = 40,
  VUT_MINCALFRAG = 41,
  VUT_SERVERSETTING = 42,
  VUT_COUNT = 43,
}

// Requirement range types from freeciv requirements.c
export enum RequirementRange {
  REQ_RANGE_LOCAL = 0,
  REQ_RANGE_CADJACENT = 1,
  REQ_RANGE_ADJACENT = 2,
  REQ_RANGE_CITY = 3,
  REQ_RANGE_TRADEROUTE = 4,
  REQ_RANGE_CONTINENT = 5,
  REQ_RANGE_PLAYER = 6,
  REQ_RANGE_TEAM = 7,
  REQ_RANGE_ALLIANCE = 8,
  REQ_RANGE_WORLD = 9,
  REQ_RANGE_COUNT = 10,
}

// Requirement interface matching freeciv structure
export interface Requirement {
  type: VulnerabilityType;
  name?: string; // For named requirements (techs, buildings, etc.)
  value?: number; // For numeric requirements (minculture, minsize, etc.)
  range: RequirementRange;
  present: boolean; // true = must be present, false = must NOT be present
}

// Culture-specific requirement interface
export interface CultureRequirement extends Requirement {
  type: VulnerabilityType.VUT_MINCULTURE;
  value: number; // Minimum culture required
  range:
    | RequirementRange.REQ_RANGE_CITY
    | RequirementRange.REQ_RANGE_TRADEROUTE
    | RequirementRange.REQ_RANGE_PLAYER;
}

// Requirement evaluation result
export interface RequirementResult {
  satisfied: boolean;
  reason?: string;
}

// Tri-state result for requirement evaluation (from freeciv)
enum TriState {
  TRI_NO = 0,
  TRI_MAYBE = 1,
  TRI_YES = 2,
}

/**
 * RequirementsManager - Evaluates requirements for buildings, units, effects
 *
 * Direct port of freeciv requirement system with focus on culture requirements.
 * Handles VUT_MINCULTURE requirements for buildings and other game elements.
 */
export class RequirementsManager {
  private cultureManager: CultureManager;

  constructor(cultureManager: CultureManager) {
    this.cultureManager = cultureManager;
  }

  /**
   * Evaluate a single requirement
   *
   * Direct port of freeciv is_req_active() from requirements.c
   * Reference: /reference/freeciv/common/requirements.c
   */
  public async evaluateRequirement(
    requirement: Requirement,
    context: EffectContext
  ): Promise<RequirementResult> {
    try {
      let result: TriState = TriState.TRI_NO;

      switch (requirement.type) {
        case VulnerabilityType.VUT_NONE:
          result = TriState.TRI_YES;
          break;

        case VulnerabilityType.VUT_MINCULTURE:
          result = await this.evaluateMinCultureRequirement(
            requirement as CultureRequirement,
            context
          );
          break;

        case VulnerabilityType.VUT_GOVERNMENT:
          result = this.evaluateGovernmentRequirement(requirement, context);
          break;

        case VulnerabilityType.VUT_ADVANCE:
          result = this.evaluateTechRequirement(requirement, context);
          break;

        case VulnerabilityType.VUT_IMPROVEMENT:
          result = this.evaluateBuildingRequirement(requirement, context);
          break;

        case VulnerabilityType.VUT_MINSIZE:
          result = this.evaluateMinSizeRequirement(requirement, context);
          break;

        default:
          logger.warn(`Unimplemented requirement type: ${requirement.type}`);
          result = TriState.TRI_MAYBE; // Unknown requirements default to maybe
          break;
      }

      // Convert tri-state result to boolean based on present flag
      const satisfied = requirement.present
        ? result === TriState.TRI_YES
        : result === TriState.TRI_NO;

      return {
        satisfied,
        reason: satisfied ? undefined : this.getRequirementFailureReason(requirement, result),
      };
    } catch (error) {
      logger.error('Error evaluating requirement:', { requirement, error });
      return {
        satisfied: false,
        reason: `Requirement evaluation failed: ${error}`,
      };
    }
  }

  /**
   * Evaluate multiple requirements (all must be satisfied)
   *
   * Direct port of freeciv are_reqs_active() from requirements.c
   */
  public async evaluateRequirements(
    requirements: Requirement[],
    context: EffectContext
  ): Promise<RequirementResult> {
    for (const requirement of requirements) {
      const result = await this.evaluateRequirement(requirement, context);
      if (!result.satisfied) {
        return result;
      }
    }

    return { satisfied: true };
  }

  /**
   * Evaluate minimum culture requirement
   *
   * Direct port of freeciv is_minculture_req_active() from requirements.c
   * Reference: /reference/freeciv/common/requirements.c (VUT_MINCULTURE case)
   */
  private async evaluateMinCultureRequirement(
    requirement: CultureRequirement,
    context: EffectContext
  ): Promise<TriState> {
    const minCulture = requirement.value;

    try {
      let actualCulture = 0;

      switch (requirement.range) {
        case RequirementRange.REQ_RANGE_CITY: {
          if (!context.cityId) {
            logger.warn('MINCULTURE requirement with CITY range but no city context');
            return TriState.TRI_MAYBE;
          }

          // Get city culture
          const cityCultureInfo = await this.cultureManager.getCityCultureInfo(context.cityId);
          actualCulture = cityCultureInfo.culture;
          break;
        }

        case RequirementRange.REQ_RANGE_PLAYER: {
          if (!context.playerId) {
            logger.warn('MINCULTURE requirement with PLAYER range but no player context');
            return TriState.TRI_MAYBE;
          }

          // Get total player culture
          const playerCultureInfo = await this.cultureManager.getPlayerCultureInfo(
            context.playerId,
            context.cityId ? 'unknown' : 'unknown' // TODO: Get gameId from context
          );
          actualCulture = playerCultureInfo.totalCulture;
          break;
        }

        case RequirementRange.REQ_RANGE_TRADEROUTE:
          // For trade route culture requirements, we'd need to check partner city culture
          // This is an advanced feature - for now, return MAYBE
          logger.debug('MINCULTURE with TRADEROUTE range not fully implemented');
          return TriState.TRI_MAYBE;

        default:
          logger.warn(`Invalid range ${requirement.range} for MINCULTURE requirement`);
          return TriState.TRI_NO;
      }

      const satisfied = actualCulture >= minCulture;

      logger.debug('MINCULTURE requirement evaluation:', {
        required: minCulture,
        actual: actualCulture,
        satisfied,
        range: requirement.range,
        context: { cityId: context.cityId, playerId: context.playerId },
      });

      return satisfied ? TriState.TRI_YES : TriState.TRI_NO;
    } catch (error) {
      logger.error('Error evaluating MINCULTURE requirement:', error);
      return TriState.TRI_MAYBE;
    }
  }

  /**
   * Evaluate government requirement
   */
  private evaluateGovernmentRequirement(
    requirement: Requirement,
    context: EffectContext
  ): TriState {
    if (!context.government || !requirement.name) {
      return TriState.TRI_MAYBE;
    }

    const matches = context.government === requirement.name;
    return matches ? TriState.TRI_YES : TriState.TRI_NO;
  }

  /**
   * Evaluate technology requirement
   */
  private evaluateTechRequirement(requirement: Requirement, context: EffectContext): TriState {
    if (!context.playerTechs || !requirement.name) {
      return TriState.TRI_MAYBE;
    }

    // Map requirement name to tech ID (similar to EffectsManager)
    const techNameMap: Record<string, string> = {
      'Code of Laws': 'code_of_laws',
      Monarchy: 'monarchy',
      'The Republic': 'the_republic',
      Democracy: 'democracy',
      Communism: 'communism',
      Mysticism: 'mysticism',
      'Ceremonial Burial': 'ceremonial_burial',
    };

    const techId =
      techNameMap[requirement.name] || requirement.name.toLowerCase().replace(/\s+/g, '_');
    const hasTech = context.playerTechs.has(techId);

    return hasTech ? TriState.TRI_YES : TriState.TRI_NO;
  }

  /**
   * Evaluate building requirement
   */
  private evaluateBuildingRequirement(requirement: Requirement, context: EffectContext): TriState {
    if (!context.cityBuildings || !requirement.name) {
      return TriState.TRI_MAYBE;
    }

    const hasBuilding = context.cityBuildings.has(requirement.name);
    return hasBuilding ? TriState.TRI_YES : TriState.TRI_NO;
  }

  /**
   * Evaluate minimum size requirement
   */
  private evaluateMinSizeRequirement(_requirement: Requirement, _context: EffectContext): TriState {
    // This would need city size from context - not implemented yet
    return TriState.TRI_MAYBE;
  }

  /**
   * Generate human-readable reason for requirement failure
   */
  private getRequirementFailureReason(requirement: Requirement, _result: TriState): string {
    const presentText = requirement.present ? 'requires' : 'blocked by';

    switch (requirement.type) {
      case VulnerabilityType.VUT_MINCULTURE:
        return `${presentText} minimum ${requirement.value} culture`;

      case VulnerabilityType.VUT_GOVERNMENT:
        return `${presentText} ${requirement.name} government`;

      case VulnerabilityType.VUT_ADVANCE:
        return `${presentText} ${requirement.name} technology`;

      case VulnerabilityType.VUT_IMPROVEMENT:
        return `${presentText} ${requirement.name} building`;

      case VulnerabilityType.VUT_MINSIZE:
        return `${presentText} city size ${requirement.value}`;

      default:
        return `${presentText} unknown requirement type ${requirement.type}`;
    }
  }

  /**
   * Check if a building can be built based on its culture requirements
   * Convenience method for building validation
   */
  public async canBuildWithCulture(
    _buildingId: string,
    requirements: CultureRequirement[],
    context: EffectContext
  ): Promise<RequirementResult> {
    const cultureRequirements = requirements.filter(
      req => req.type === VulnerabilityType.VUT_MINCULTURE
    );

    if (cultureRequirements.length === 0) {
      return { satisfied: true };
    }

    return this.evaluateRequirements(cultureRequirements, context);
  }

  public async evaluateRulesetCultureRequirements(
    requirements: BuildingCultureRequirement[],
    context: EffectContext
  ): Promise<RequirementResult> {
    return this.canBuildWithCulture(
      'ruleset-building',
      requirements.map(requirement => ({
        type: VulnerabilityType.VUT_MINCULTURE,
        value: requirement.value,
        range:
          requirement.range === 'City'
            ? RequirementRange.REQ_RANGE_CITY
            : RequirementRange.REQ_RANGE_PLAYER,
        present: requirement.present,
      })),
      context
    );
  }
}
