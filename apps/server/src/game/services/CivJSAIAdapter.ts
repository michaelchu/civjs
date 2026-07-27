import type { GameInstance } from '@game/managers/GameManager';
import type { DiplomacyManager } from '@game/managers/DiplomacyManager';

/**
 * Deliberately small CivJS AI adapter.
 *
 * This is not a partial port of Freeciv's tightly-coupled default AI. It makes
 * deterministic baseline decisions through the same authoritative managers
 * used by human packet handlers, so the adapter can be replaced without
 * creating a second rules engine.
 */
export class CivJSAIAdapter {
  constructor(private readonly diplomacyManager: DiplomacyManager) {}

  async processTurn(gameId: string, game: GameInstance): Promise<number> {
    let actions = 0;
    for (const player of game.players.values()) {
      if (!player.isAI) continue;
      actions += await this.selectResearch(game, player.id);
      actions += await this.selectCityProduction(game, player.id);
      actions += await this.respondToDiplomacy(gameId, player.id);
    }
    return actions;
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
    for (const city of game.cityManager.getPlayerCities(playerId)) {
      if (city.currentProduction) continue;
      await game.cityManager.setCityProduction(city.id, 'unit', 'warriors', playerId);
      actions++;
    }
    return actions;
  }

  private async respondToDiplomacy(gameId: string, playerId: string): Promise<number> {
    const snapshot = await this.diplomacyManager.getSnapshot(gameId, playerId);
    let actions = 0;
    for (const nation of snapshot.nations) {
      const proposal = nation.relation.proposal;
      if (
        proposal?.status !== 'pending' ||
        proposal.recipientId !== playerId ||
        proposal.clauses.some(clause => clause.type === 'alliance')
      ) {
        continue;
      }
      await this.diplomacyManager.respondToTreaty(gameId, playerId, nation.id, proposal.id, true);
      actions++;
    }
    return actions;
  }
}
