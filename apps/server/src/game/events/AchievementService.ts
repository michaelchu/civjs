import type { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import { logger } from '@utils/logger';
import {
  GameEventType,
  type Achievement,
  type GameEvent,
  type GameEventData,
  type PlayerEventStats,
} from './GameEventTypes';

/** Evaluates and publishes achievements after their triggering event is durable. */
export class AchievementService {
  private readonly achievements = new Map<string, Achievement>();
  private readonly unlockedByPlayer = new Map<string, Set<string>>();
  private playerStatsProvider?: (playerId: string) => PlayerEventStats;

  constructor(
    private readonly gameId: string,
    private readonly broadcastManager: GameBroadcastManager,
    private readonly emitEvent: (type: GameEventType, data: Partial<GameEventData>) => string
  ) {
    for (const achievement of builtInAchievements()) {
      this.achievements.set(achievement.id, achievement);
    }
  }

  setPlayerStatsProvider(provider: (playerId: string) => PlayerEventStats): void {
    this.playerStatsProvider = provider;
  }

  async check(event: GameEvent): Promise<number> {
    const playerId = event.data.playerId;
    if (!playerId) return 0;

    let unlocked = this.unlockedByPlayer.get(playerId);
    if (!unlocked) {
      unlocked = new Set();
      this.unlockedByPlayer.set(playerId, unlocked);
    }

    let count = 0;
    for (const achievement of this.achievements.values()) {
      if (await this.tryUnlock(event, playerId, unlocked, achievement)) count++;
    }
    return count;
  }

  add(achievement: Achievement): void {
    this.achievements.set(achievement.id, achievement);
  }

  get(achievementId: string): Achievement | undefined {
    return this.achievements.get(achievementId);
  }

  getPlayerAchievements(playerId: string): string[] {
    return [...(this.unlockedByPlayer.get(playerId) ?? [])];
  }

  get count(): number {
    return this.achievements.size;
  }

  private async tryUnlock(
    event: GameEvent,
    playerId: string,
    unlocked: Set<string>,
    achievement: Achievement
  ): Promise<boolean> {
    if (
      !achievement.enabled ||
      !achievement.trigger.includes(event.type) ||
      (achievement.oneTime && unlocked.has(achievement.id))
    )
      return false;

    try {
      if (!achievement.condition(event, this.playerStats(playerId))) return false;
      unlocked.add(achievement.id);
      this.emitEvent(GameEventType.ACHIEVEMENT_UNLOCKED, {
        playerId,
        achievementId: achievement.id,
        achievementName: achievement.name,
        triggerEvent: event.id,
      });
      this.broadcastManager.broadcastToPlayer(playerId, 'achievement_unlocked', {
        achievement: {
          id: achievement.id,
          name: achievement.name,
          description: achievement.description,
          category: achievement.category,
        },
      });
      logger.info('Achievement unlocked', {
        gameId: this.gameId,
        playerId,
        achievementId: achievement.id,
        triggerEvent: event.id,
      });
      return true;
    } catch (error) {
      logger.error('Error checking achievement', {
        gameId: this.gameId,
        achievementId: achievement.id,
        playerId,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  private playerStats(playerId: string): PlayerEventStats {
    return (
      this.playerStatsProvider?.(playerId) ?? {
        playerId,
        citiesCount: 0,
        unitsCount: 0,
        technologiesCount: 0,
        score: 0,
        turn: 0,
      }
    );
  }
}

function builtInAchievements(): Achievement[] {
  return [
    {
      id: 'first_city',
      name: 'City Founder',
      description: 'Found your first city',
      category: 'civilization',
      trigger: [GameEventType.CITY_FOUNDED],
      condition: (event, stats) => event.data.playerId === stats.playerId,
      oneTime: true,
      enabled: true,
    },
    {
      id: 'first_unit',
      name: 'Military Commander',
      description: 'Create your first unit',
      category: 'military',
      trigger: [GameEventType.UNIT_CREATED],
      condition: (event, stats) => event.data.playerId === stats.playerId,
      oneTime: true,
      enabled: true,
    },
    {
      id: 'first_tech',
      name: 'Researcher',
      description: 'Research your first technology',
      category: 'science',
      trigger: [GameEventType.TECH_RESEARCHED],
      condition: (event, stats) => event.data.playerId === stats.playerId,
      oneTime: true,
      enabled: true,
    },
    {
      id: 'turn_10',
      name: 'Survivor',
      description: 'Survive 10 turns',
      category: 'survival',
      trigger: [GameEventType.TURN_BEGIN],
      condition: event => event.data.turn >= 10,
      oneTime: true,
      enabled: true,
    },
  ];
}
