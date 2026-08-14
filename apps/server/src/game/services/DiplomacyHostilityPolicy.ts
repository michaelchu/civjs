/**
 * @module server/game/services/DiplomacyHostilityPolicy
 * Provides the server-side Diplomacy Hostility Policy service.
 */
import type { DiplomacyManager, DiplomacySnapshot } from '@game/managers/DiplomacyManager';

/**
 * Single authoritative interpretation of whether one player may perform a
 * hostile action against another. Combat is legal only while the persisted
 * bilateral diplomatic state is war.
 */
export class DiplomacyHostilityPolicy {
  private readonly scopedSnapshots = new Map<string, Promise<DiplomacySnapshot> | null>();

  constructor(private readonly diplomacyManager: DiplomacyManager) {}

  /**
   * Reuse one authoritative diplomacy snapshot while an AI player plans its
   * turn. Freeciv reads bilateral relations from player memory during this
   * phase; repeatedly loading the same unchanged rows between advisor passes
   * adds database latency without changing any decision.
   *
   * @reference reference/freeciv/ai/default/daiplayer.c
   * @reference reference/freeciv/common/player.h
   */
  async withSnapshotScope<T>(gameId: string, playerId: string, operation: () => Promise<T>) {
    const key = this.snapshotKey(gameId, playerId);
    if (this.scopedSnapshots.has(key)) return operation();

    this.scopedSnapshots.set(key, null);
    try {
      return await operation();
    } finally {
      this.scopedSnapshots.delete(key);
    }
  }

  async canAttack(gameId: string, attackerPlayerId: string, defenderPlayerId: string) {
    if (attackerPlayerId === defenderPlayerId) return false;
    const hostilePlayers = await this.getHostilePlayerIds(gameId, attackerPlayerId);
    return hostilePlayers.has(defenderPlayerId);
  }

  async getHostilePlayerIds(gameId: string, playerId: string): Promise<Set<string>> {
    return (await this.getRelationPlayerIds(gameId, playerId)).hostile;
  }

  async getDiplomacySnapshot(gameId: string, playerId: string) {
    const key = this.snapshotKey(gameId, playerId);
    if (!this.scopedSnapshots.has(key)) {
      return this.diplomacyManager.getSnapshot(gameId, playerId);
    }

    const existing = this.scopedSnapshots.get(key);
    if (existing) return existing;

    const pending = this.diplomacyManager.getSnapshot(gameId, playerId);
    this.scopedSnapshots.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.scopedSnapshots.get(key) === pending) this.scopedSnapshots.set(key, null);
      throw error;
    }
  }

  async getRelationPlayerIds(
    gameId: string,
    playerId: string
  ): Promise<{
    hostile: Set<string>;
    allied: Set<string>;
    unknown: Set<string>;
  }> {
    const snapshot = await this.getDiplomacySnapshot(gameId, playerId);
    return {
      hostile: new Set(
        snapshot.nations.filter(nation => nation.relation.state === 'war').map(nation => nation.id)
      ),
      allied: new Set(
        snapshot.nations
          .filter(
            nation => nation.relation.state === 'alliance' || nation.relation.state === 'team'
          )
          .map(nation => nation.id)
      ),
      unknown: new Set(
        snapshot.nations.filter(nation => nation.known === false).map(nation => nation.id)
      ),
    };
  }

  private snapshotKey(gameId: string, playerId: string): string {
    return `${gameId}:${playerId}`;
  }
}
