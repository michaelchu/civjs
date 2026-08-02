/**
 * @module server/game/units/UnitMovementCostService
 * Defines Unit Movement Cost Service unit behavior and contracts.
 */
import {
  getRulesetMoveFragments,
  getTerrainMovementCost,
  MovementType,
  type MovementRulesetLookup,
} from '@game/constants/MovementConstants';
import { EffectType, type EffectsManager } from '@game/managers/EffectsManager';
import type { TerrainType } from '@game/map/MapTypes';
import { rulesetUnitsService, type UnitType } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { Unit } from './UnitTypes';
import { getVeteranLevel } from './UnitVeterancy';

interface InfrastructureTile {
  hasRoad?: boolean;
  hasRailroad?: boolean;
}

export class UnitMovementCostService {
  constructor(
    private readonly unitTypes: Record<string, UnitType>,
    private readonly effectsManager: EffectsManager,
    private readonly getRulesetName: () => string,
    private readonly getTerrainAt: (x: number, y: number) => TerrainType,
    private readonly getTile: (x: number, y: number) => InfrastructureTile | undefined,
    private readonly getPlayerTechs: (playerId: string) => Set<string>,
    private readonly getPlayerBuildings: (playerId: string) => string[]
  ) {}

  calculateTerrainCost(unit: Unit, fromX: number, fromY: number, toX: number, toY: number): number {
    const destinationTerrain = this.getTerrainAt(toX, toY);
    const unitType = this.unitTypes[unit.unitTypeId];
    const rulesetName = this.getRulesetName();
    const fragments = getRulesetMoveFragments(rulesetName);
    let movementCost = getTerrainMovementCost(
      destinationTerrain,
      unit.unitTypeId,
      this.movementRulesetLookup(rulesetName)
    );

    if (movementCost < 0 && unitType) {
      const terrain = rulesetLoader.getTerrain(destinationTerrain, rulesetName);
      const isWater = ['ocean', 'deep_ocean', 'coast', 'lake'].includes(destinationTerrain);
      const isSeaUnit = ['Sea', 'Trireme'].includes(unitType.rulesetUnitClass ?? '');
      const isAirUnit = unitType.rulesetUnitClass === 'Air';
      if ((isSeaUnit && isWater) || (isAirUnit && !isWater) || (!isSeaUnit && !isWater)) {
        movementCost = isAirUnit ? fragments : (terrain.moveCost ?? 1) * fragments;
      }
    }
    if (movementCost < 0 || this.isTriremeBlocked(unitType, destinationTerrain)) {
      return -1;
    }

    return (
      this.getInfrastructureCost(unitType, this.getTile(fromX, fromY), this.getTile(toX, toY)) ??
      movementCost
    );
  }

  getMaximumMovement(playerId: string, unitType: UnitType, veteranLevel = 0, health = 100): number {
    const effectBonus = this.effectsManager.calculateEffect(EffectType.MOVE_BONUS, {
      playerId,
      unitType: unitType.id,
      unitClass: unitType.rulesetUnitClass,
      unitClassFlags: new Set(unitType.rulesetUnitClassFlags ?? []),
      unitTypeFlags: new Set(unitType.flags ?? []),
      playerTechs: this.getPlayerTechs(playerId),
      playerBuildings: new Set(this.getPlayerBuildings(playerId)),
    }).value;
    // veteran_move_bonus is already expressed in Freeciv movement fragments,
    // while UnitType.movement is expressed in whole moves.
    // @reference reference/freeciv/data/civ2civ3/units.ruleset:85-88
    const fragments = getRulesetMoveFragments(this.getRulesetName());
    const baseMovement = Math.max(
      0,
      unitType.movement * fragments + getVeteranLevel(unitType, veteranLevel).moveBonus
    );
    const unitClass = rulesetLoader.loadUnitsRuleset(this.getRulesetName()).unit_classes[
      unitType.rulesetUnitClass ?? ''
    ];
    const slowedMovement = unitClass?.flags.includes('DamageSlows')
      ? Math.floor((baseMovement * Math.max(0, Math.min(100, health))) / 100)
      : baseMovement;
    const minimumSpeed = Math.min(unitClass?.min_speed ?? 0, baseMovement);
    return Math.max(minimumSpeed, slowedMovement + Math.max(0, effectBonus) * fragments);
  }

  canEnterTerrain(terrain: TerrainType, unitTypeId: string): boolean {
    const rulesetName = this.getRulesetName();
    return (
      getTerrainMovementCost(terrain, unitTypeId, this.movementRulesetLookup(rulesetName)) >= 0
    );
  }

  private movementRulesetLookup(rulesetName: string): MovementRulesetLookup {
    return {
      getTerrainMoveCost: terrain => rulesetLoader.getTerrain(terrain, rulesetName).moveCost,
      getUnitMovementType: unitTypeId =>
        rulesetUnitsService.getMovementType(unitTypeId, rulesetName) as MovementType | undefined,
      getMoveFragments: () => getRulesetMoveFragments(rulesetName),
    };
  }

  private isTriremeBlocked(unitType: UnitType | undefined, terrain: TerrainType): boolean {
    return unitType?.rulesetUnitClass === 'Trireme' && terrain === 'deep_ocean';
  }

  private getInfrastructureCost(
    unitType: UnitType | undefined,
    fromTile: InfrastructureTile | undefined,
    destinationTile: InfrastructureTile | undefined
  ): number | undefined {
    if (unitType?.rulesetUnitClass !== 'Land') {
      return unitType?.flags?.includes('IgTer') ? 1 : undefined;
    }
    if (fromTile?.hasRailroad && destinationTile?.hasRailroad) return 0;
    if (fromTile?.hasRoad && destinationTile?.hasRoad) return 1;
    return unitType.flags?.includes('IgTer') ? 1 : undefined;
  }
}
