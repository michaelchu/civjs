/**
 * @module server/game/ai/AIPlayerController
 * Implements AIPlayer Controller decision logic for AI-controlled players.
 */
import { FreecivAICityController } from '@game/ai/AICityController';
import { FreecivAIDiplomacyController } from '@game/ai/AIDiplomacyController';
import { FreecivAIDomesticController } from '@game/ai/AIDomesticController';
import type { FreecivAIState } from '@game/ai/AIStateStore';
import { FreecivAIUnitController } from '@game/ai/AIUnitController';
import { FreecivAITransportController } from '@game/ai/AITransportController';
import { FreecivAISpecialUnitController } from '@game/ai/AISpecialUnitController';
import type { DiplomacyManager } from '@game/managers/DiplomacyManager';
import type { GameInstance } from '@game/runtime/GameTypes';
import { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';

export type AIDecisionRunner = (label: string, decision: () => Promise<number>) => Promise<number>;

/**
 * Preserves Freeciv's per-player phase order while delegating decisions to
 * controllers that share the authoritative game managers.
 */
export class FreecivAIPlayerController {
  private readonly city: FreecivAICityController;
  private readonly diplomacy: FreecivAIDiplomacyController;
  private readonly domestic: FreecivAIDomesticController;
  private readonly specialUnits: FreecivAISpecialUnitController;
  private readonly transport: FreecivAITransportController;
  private readonly units: FreecivAIUnitController;

  constructor(diplomacyManager: DiplomacyManager, hostilityPolicy?: DiplomacyHostilityPolicy) {
    const hostility = hostilityPolicy ?? new DiplomacyHostilityPolicy(diplomacyManager);
    this.city = new FreecivAICityController(hostility);
    this.diplomacy = new FreecivAIDiplomacyController(diplomacyManager);
    this.domestic = new FreecivAIDomesticController(hostility);
    this.specialUnits = new FreecivAISpecialUnitController(hostility);
    this.transport = new FreecivAITransportController();
    this.units = new FreecivAIUnitController(hostility);
  }

  async processPlayer(
    gameId: string,
    game: GameInstance,
    playerId: string,
    state: FreecivAIState,
    run: AIDecisionRunner
  ): Promise<number> {
    let actions = 0;
    const player = game.players.get(playerId);
    if (player?.nation === 'barbarian' || player?.civilization?.startsWith('barbarian')) {
      return run('barbarian units', () => this.units.manageBarbarians(game, playerId, state));
    }
    state.techWants = {};
    actions += await run('government', () => this.domestic.manageGovernment(game, playerId, state));
    actions += await run('economy', () => this.domestic.manageEconomy(game, playerId, state));
    actions += await run('citizens', () => this.city.manageCitizens(game, playerId));
    actions += await run('production', () => this.city.selectProduction(game, playerId, state));
    actions += await run('research', () => this.domestic.selectResearch(game, playerId, state));
    actions += await run('expansion', () => this.units.foundReadyCities(game, playerId, state));
    actions += await run('caravan trade', () =>
      this.city.manageCaravanTrade(game, playerId, state)
    );
    actions += await run('city unit actions', () =>
      this.city.executeUnitActions(game, playerId, state)
    );
    actions += await run('wonder helpers', () =>
      this.city.manageWonderHelpers(game, playerId, state)
    );
    actions += await run('workers', () => this.units.automateWorkers(game, playerId, state));
    actions += await run('ferries', () => this.transport.manageFerries(game, playerId, state));
    actions += await run('recovery', () =>
      this.units.manageMilitaryRecovery(game, playerId, state)
    );
    actions += await run('defender airlift', () =>
      this.units.manageDefenderAirlifts(game, playerId, state)
    );
    actions += await run('guards', () => this.units.manageCityGuards(game, playerId, state));
    actions += await run('diplomats', () =>
      this.specialUnits.manageDiplomatUnits(gameId, game, playerId, state)
    );
    actions += await run('air', () =>
      this.specialUnits.manageAirAndParadrops(gameId, game, playerId, state)
    );
    actions += await run('hunters', () => this.units.manageHunters(gameId, game, playerId, state));
    actions += await run('combat', () =>
      this.units.attackAdjacentEnemies(gameId, game, playerId, state)
    );
    actions += await run('exploration', () =>
      this.units.automateExploration(game, playerId, state)
    );
    actions += await run('diplomacy', () =>
      this.diplomacy.processPlayer(gameId, game, playerId, state)
    );
    return actions;
  }
}
