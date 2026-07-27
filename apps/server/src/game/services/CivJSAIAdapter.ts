import type { GameInstance } from '@game/managers/GameManager';
import type { DiplomacyManager } from '@game/managers/DiplomacyManager';
import type { Unit } from '@game/managers/UnitManager';
import { ActionType } from '@app-types/shared/actions';
import { logger } from '@utils/logger';

/**
 * Versioned compatibility contract for the intentionally bounded CivJS AI.
 *
 * CivJS does not claim parity with Freeciv's tightly coupled default AI. The
 * adapter makes deterministic baseline decisions through the same
 * authoritative managers used by human packet handlers. The explicit
 * exclusions keep that narrower promise inspectable and replaceable.
 */
export const CIVJS_AI_CONTRACT = {
  version: 1,
  supported: [
    'found a city when a ready city-founding unit is on a legal tile',
    'prioritize deficit-reducing city production, then expansion and defense',
    'select the cheapest available research target with an ID tie-break',
    'enable authoritative worker and exploration automation',
    'use legal caravan, city-join, home-city, and unit-upgrade outcomes',
    'resolve adjacent combat with a ready military unit',
    'accept peace and cease-fire proposals and reject alliances',
    'resume deterministically from manager state restored after a restart',
    'yield game completion to the authoritative conquest evaluator',
  ],
  deviations: [
    'no Freeciv default-AI want evaluation, advisor model, or difficulty levels',
    'no long-range military campaign, naval logistics, air planning, or nuclear planning',
    'no proactive treaty negotiation, technology trading, espionage planning, or government planning',
    'no attempt to optimize the full technology tree, city worklists, tax rates, or citizen allocation',
  ],
} as const;

/**
 * Deterministic baseline AI that delegates all mutations to authoritative
 * managers. A failed optional decision is isolated so one unsuitable unit or
 * city cannot abort turn processing for every AI player.
 */
export class CivJSAIAdapter {
  constructor(private readonly diplomacyManager: DiplomacyManager) {}

  async processTurn(gameId: string, game: GameInstance): Promise<number> {
    if (game.state !== 'active') return 0;

    let actions = 0;
    for (const player of game.players.values()) {
      if (!player.isAI) continue;
      const playerId = player.id;
      actions += await this.attempt('research', () => this.selectResearch(game, playerId));
      actions += await this.attempt('production', () => this.selectCityProduction(game, playerId));
      actions += await this.attempt('expansion', () => this.foundReadyCities(game, playerId));
      actions += await this.attempt('city unit actions', () =>
        this.executeCityUnitActions(game, playerId)
      );
      actions += await this.attempt('workers', () => this.automateWorkers(game, playerId));
      actions += await this.attempt('combat', () => this.attackAdjacentEnemies(game, playerId));
      actions += await this.attempt('exploration', () => this.automateExploration(game, playerId));
      actions += await this.attempt('diplomacy', () => this.respondToDiplomacy(gameId, playerId));
    }
    return actions;
  }

  private async attempt(label: string, decision: () => Promise<number>): Promise<number> {
    try {
      return await decision();
    } catch (error) {
      logger.warn('CivJS AI decision failed', {
        decision: label,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  private async selectResearch(game: GameInstance, playerId: string): Promise<number> {
    const research = game.researchManager.getPlayerResearch(playerId);
    if (research?.currentTech) return 0;
    const choice = game.researchManager
      .getAvailableTechnologies(playerId)
      .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0];
    if (!choice) return 0;
    await game.researchManager.setCurrentResearch(playerId, choice.id);
    return 1;
  }

  private async selectCityProduction(game: GameInstance, playerId: string): Promise<number> {
    let actions = 0;
    const cities = game.cityManager
      .getPlayerCities(playerId)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    const units = game.unitManager.getPlayerUnits(playerId);
    let expansionQueued = units.some(
      unit => game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity
    );

    for (const city of cities) {
      if (city.currentProduction) continue;

      let type: 'unit' | 'building' = 'unit';
      let id = 'warriors';
      if ((city.goldPerTurn ?? 0) < 0 && !city.buildings.includes('marketplace')) {
        type = 'building';
        id = 'marketplace';
      } else if (!expansionQueued) {
        id = 'settlers';
        expansionQueued = true;
      }

      await game.cityManager.setCityProduction(city.id, type, id, playerId);
      actions++;
    }
    return actions;
  }

  private async foundReadyCities(game: GameInstance, playerId: string): Promise<number> {
    let actions = 0;
    for (const unit of this.sortedUnits(game, playerId)) {
      if (
        unit.movementLeft <= 0 ||
        !game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity ||
        !game.unitManager.canUnitPerformAction(unit.id, ActionType.FOUND_CITY)
      ) {
        continue;
      }
      const result = await game.unitManager.executeUnitAction(
        unit.id,
        ActionType.FOUND_CITY,
        undefined,
        undefined,
        playerId
      );
      if (result.success) actions++;
    }
    return actions;
  }

  private async automateWorkers(game: GameInstance, playerId: string): Promise<number> {
    let actions = 0;
    for (const unit of this.sortedUnits(game, playerId)) {
      const type = game.unitManager.getUnitType(unit.unitTypeId);
      if (!type?.canBuildImprovements || unit.automation) continue;
      const result = await game.unitManager.executeUnitAction(
        unit.id,
        ActionType.AUTO_SETTLER,
        undefined,
        undefined,
        playerId
      );
      if (result.success) actions++;
    }
    return actions;
  }

  private async executeCityUnitActions(game: GameInstance, playerId: string): Promise<number> {
    const preferences = [
      ActionType.HELP_WONDER,
      ActionType.MARKETPLACE,
      ActionType.JOIN_CITY,
      ActionType.CHANGE_HOME_CITY,
      ActionType.UPGRADE_UNIT,
    ];
    let actions = 0;
    for (const unit of this.sortedUnits(game, playerId)) {
      if (!game.unitManager.getUnit(unit.id)) continue;
      if (!game.cityManager.getCityAt?.(unit.x, unit.y)) continue;
      for (const action of preferences) {
        const targetX = action === ActionType.UPGRADE_UNIT ? undefined : unit.x;
        const targetY = action === ActionType.UPGRADE_UNIT ? undefined : unit.y;
        if (!game.unitManager.canUnitPerformAction(unit.id, action, targetX, targetY)) continue;
        const result = await game.unitManager.executeUnitAction(
          unit.id,
          action,
          targetX,
          targetY,
          playerId
        );
        if (result.success) actions++;
        break;
      }
    }
    return actions;
  }

  private async attackAdjacentEnemies(game: GameInstance, playerId: string): Promise<number> {
    const enemies = Array.from(game.unitManager.getAllUnits().values())
      .filter(unit => unit.playerId !== playerId && !unit.transportedBy)
      .sort((a, b) => a.id.localeCompare(b.id));
    let actions = 0;

    for (const attacker of this.sortedUnits(game, playerId)) {
      const type = game.unitManager.getUnitType(attacker.unitTypeId);
      if (attacker.movementLeft <= 0 || (type?.attack ?? type?.combat ?? 0) <= 0) continue;
      const defender = enemies.find(
        target =>
          game.unitManager.getUnit(target.id) &&
          game.mapManager.getDistance(attacker.x, attacker.y, target.x, target.y) <=
            (type?.range ?? 1)
      );
      if (!defender) continue;
      if (type?.flags?.includes('Nuclear')) {
        await game.unitManager.executeUnitAction(
          attacker.id,
          ActionType.NUCLEAR_EXPLOSION,
          defender.x,
          defender.y,
          playerId
        );
      } else if (type?.rulesetUnitClassFlags?.includes('Missile')) {
        await game.unitManager.executeUnitAction(
          attacker.id,
          ActionType.SUICIDE_ATTACK,
          defender.x,
          defender.y,
          playerId
        );
      } else {
        await game.unitManager.attackUnit(attacker.id, defender.id);
      }
      actions++;
    }
    return actions;
  }

  private async automateExploration(game: GameInstance, playerId: string): Promise<number> {
    const unit = this.sortedUnits(game, playerId).find(candidate => {
      const type = game.unitManager.getUnitType(candidate.unitTypeId);
      return (
        candidate.movementLeft > 0 &&
        !candidate.automation &&
        !type?.canBuildImprovements &&
        (type?.attack ?? type?.combat ?? 0) <= 0 &&
        game.unitManager.canUnitPerformAction(candidate.id, ActionType.AUTO_EXPLORE)
      );
    });
    if (!unit) return 0;
    const result = await game.unitManager.executeUnitAction(
      unit.id,
      ActionType.AUTO_EXPLORE,
      undefined,
      undefined,
      playerId
    );
    return result.success ? 1 : 0;
  }

  private sortedUnits(game: GameInstance, playerId: string): Unit[] {
    return game.unitManager
      .getPlayerUnits(playerId)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private async respondToDiplomacy(gameId: string, playerId: string): Promise<number> {
    const snapshot = await this.diplomacyManager.getSnapshot(gameId, playerId);
    let actions = 0;
    for (const nation of snapshot.nations.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      const proposal = nation.relation.proposal;
      if (proposal?.status !== 'pending' || proposal.recipientId !== playerId) {
        continue;
      }
      const accepted = proposal.clauses.every(
        clause => clause.type === 'peace' || clause.type === 'ceasefire'
      );
      await this.diplomacyManager.respondToTreaty(
        gameId,
        playerId,
        nation.id,
        proposal.id,
        accepted
      );
      actions++;
    }
    return actions;
  }
}
