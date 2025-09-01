import { db } from '../database';
import { players as playersTable } from '../database/schema';
import { eq, and } from 'drizzle-orm';
import { rulesetLoader } from '../shared/data/rulesets/RulesetLoader';
import type { GovernmentRuleset } from '../shared/data/rulesets/schemas';

// Re-export types from schema for backwards compatibility
export type GovernmentRequirement = import('../shared/data/rulesets/schemas').GovernmentRequirement;
export type Government = GovernmentRuleset;

export interface PlayerGovernment {
  playerId: string;
  currentGovernment: string;
  revolutionTurns: number; // 0 = not in revolution, >0 = turns remaining in anarchy
  requestedGovernment?: string; // Government requested after revolution
}

// Load governments from ruleset system
export function getGovernments(rulesetName: string = 'classic'): Record<string, Government> {
  return rulesetLoader.getGovernments(rulesetName);
}

// Get individual government
export function getGovernment(governmentId: string, rulesetName: string = 'classic'): Government {
  return rulesetLoader.getGovernment(governmentId, rulesetName);
}

// Get revolution government type
export function getRevolutionGovernment(rulesetName: string = 'classic'): string {
  return rulesetLoader.getRevolutionGovernment(rulesetName);
}

export class GovernmentManager {
  private playerGovernments: Map<string, PlayerGovernment> = new Map();
  private gameId: string;

  constructor(gameId: string) {
    this.gameId = gameId;
  }

  public async initializePlayerGovernment(playerId: string): Promise<void> {
    const government: PlayerGovernment = {
      playerId,
      currentGovernment: 'despotism', // Start with Despotism as default
      revolutionTurns: 0,
    };

    this.playerGovernments.set(playerId, government);

    // Update player record in database with initial government
    await db
      .update(playersTable)
      .set({
        government: 'despotism',
        revolutionTurns: 0,
      })
      .where(and(eq(playersTable.gameId, this.gameId), eq(playersTable.id, playerId)));
  }

  public async startRevolution(
    playerId: string,
    requestedGovernment: string,
    playerResearchedTechs: Set<string>
  ): Promise<{ success: boolean; message?: string }> {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov) {
      return { success: false, message: 'Player government not initialized' };
    }

    // Check if already in revolution
    if (playerGov.revolutionTurns > 0) {
      return { success: false, message: 'Already in revolution' };
    }

    // Check if requesting current government
    if (requestedGovernment === playerGov.currentGovernment) {
      return { success: false, message: 'Already using this government' };
    }

    // Validate requested government exists
    try {
      getGovernment(requestedGovernment);
    } catch {
      return { success: false, message: 'Invalid government type' };
    }

    // Check requirements
    const canChange = this.canPlayerUseGovernment(requestedGovernment, playerResearchedTechs);
    if (!canChange.allowed) {
      return { success: false, message: canChange.reason };
    }

    // Start revolution - 3 turns of anarchy for most government changes
    const anarchyTurns = this.getRevolutionTurns(playerGov.currentGovernment, requestedGovernment);

    playerGov.currentGovernment = 'anarchy';
    playerGov.revolutionTurns = anarchyTurns;
    playerGov.requestedGovernment = requestedGovernment;

    // Update database
    await db
      .update(playersTable)
      .set({
        government: 'anarchy',
        revolutionTurns: anarchyTurns,
      })
      .where(and(eq(playersTable.gameId, this.gameId), eq(playersTable.id, playerId)));

    return {
      success: true,
      message: `Revolution started. ${anarchyTurns} turns of Anarchy remaining.`,
    };
  }

  public async processRevolutionTurn(playerId: string): Promise<string | null> {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov || playerGov.revolutionTurns <= 0) {
      return null;
    }

    playerGov.revolutionTurns--;

    // Check if revolution is complete
    if (playerGov.revolutionTurns === 0 && playerGov.requestedGovernment) {
      const newGovernment = playerGov.requestedGovernment;
      playerGov.currentGovernment = newGovernment;
      playerGov.requestedGovernment = undefined;

      // Update database
      await db
        .update(playersTable)
        .set({
          government: newGovernment,
          revolutionTurns: 0,
        })
        .where(and(eq(playersTable.gameId, this.gameId), eq(playersTable.id, playerId)));

      return newGovernment;
    } else {
      // Update remaining turns in database
      await db
        .update(playersTable)
        .set({
          revolutionTurns: playerGov.revolutionTurns,
        })
        .where(and(eq(playersTable.gameId, this.gameId), eq(playersTable.id, playerId)));
    }

    return null;
  }

  public canPlayerUseGovernment(
    governmentId: string,
    playerResearchedTechs: Set<string>
  ): { allowed: boolean; reason?: string } {
    let government: Government;
    try {
      government = getGovernment(governmentId);
    } catch {
      return { allowed: false, reason: 'Government does not exist' };
    }

    // Anarchy and Despotism have no requirements
    if (governmentId === 'anarchy' || governmentId === 'despotism') {
      return { allowed: true };
    }

    // Check technology requirements
    if (government.reqs) {
      for (const req of government.reqs) {
        if (req.type === 'tech') {
          const techId = this.getTechIdFromName(req.name);
          if (!techId || !playerResearchedTechs.has(techId)) {
            return { allowed: false, reason: `Requires ${req.name} technology` };
          }
        }
      }
    }

    return { allowed: true };
  }

  public getPlayerGovernment(playerId: string): PlayerGovernment | null {
    return this.playerGovernments.get(playerId) || null;
  }

  public getRulerTitle(playerId: string, playerName: string, isFemalLeader?: boolean): string {
    const playerGov = this.playerGovernments.get(playerId);
    if (!playerGov) {
      return playerName;
    }

    let government: Government;
    try {
      government = getGovernment(playerGov.currentGovernment);
    } catch {
      return playerName;
    }

    const titleTemplate = isFemalLeader
      ? government.ruler_female_title
      : government.ruler_male_title;

    return titleTemplate.replace('%s', playerName);
  }

  public getAvailableGovernments(playerResearchedTechs: Set<string>): {
    id: string;
    government: Government;
    available: boolean;
    reason?: string;
  }[] {
    const governments = getGovernments();
    return Object.entries(governments).map(([id, government]) => {
      const check = this.canPlayerUseGovernment(id, playerResearchedTechs);
      return {
        id,
        government,
        available: check.allowed,
        reason: check.reason,
      };
    });
  }

  private getRevolutionTurns(fromGovernment: string, toGovernment: string): number {
    // Special cases for quicker transitions
    if (fromGovernment === 'anarchy' || toGovernment === 'anarchy') {
      return 1; // Quick transition to/from anarchy
    }

    if (fromGovernment === 'despotism' && toGovernment === 'monarchy') {
      return 2; // Easier transition from despotism to monarchy
    }

    // Standard revolution time
    return 3;
  }

  private getTechIdFromName(techName: string): string | null {
    // Map government requirement names to our tech IDs
    const techNameMap: Record<string, string> = {
      Monarchy: 'monarchy',
      'The Republic': 'the_republic',
      Communism: 'communism',
      Democracy: 'democracy',
    };

    return techNameMap[techName] || null;
  }

  public getAllGovernments(): Record<string, Government> {
    return getGovernments();
  }

  public getGovernmentById(governmentId: string): Government | null {
    try {
      return getGovernment(governmentId);
    } catch {
      return null;
    }
  }

  public async loadPlayerGovernmentFromDb(playerId: string): Promise<void> {
    const result = await db
      .select({
        government: playersTable.government,
        revolutionTurns: playersTable.revolutionTurns,
      })
      .from(playersTable)
      .where(and(eq(playersTable.gameId, this.gameId), eq(playersTable.id, playerId)));

    if (result.length > 0) {
      const { government, revolutionTurns } = result[0];

      const playerGov: PlayerGovernment = {
        playerId,
        currentGovernment: government || 'despotism',
        revolutionTurns: revolutionTurns || 0,
      };

      this.playerGovernments.set(playerId, playerGov);
    }
  }
}
