import type { DiplomacyManager } from '@game/managers/DiplomacyManager';

/**
 * Single authoritative interpretation of whether one player may perform a
 * hostile action against another. Combat is legal only while the persisted
 * bilateral diplomatic state is war.
 */
export class DiplomacyHostilityPolicy {
  constructor(private readonly diplomacyManager: DiplomacyManager) {}

  async canAttack(gameId: string, attackerPlayerId: string, defenderPlayerId: string) {
    if (attackerPlayerId === defenderPlayerId) return false;
    const hostilePlayers = await this.getHostilePlayerIds(gameId, attackerPlayerId);
    return hostilePlayers.has(defenderPlayerId);
  }

  async getHostilePlayerIds(gameId: string, playerId: string): Promise<Set<string>> {
    const snapshot = await this.diplomacyManager.getSnapshot(gameId, playerId);
    return new Set(
      snapshot.nations.filter(nation => nation.relation.state === 'war').map(nation => nation.id)
    );
  }
}
