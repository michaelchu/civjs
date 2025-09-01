/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from '../database';
import { players as playersTable } from '../database/schema';
import { eq, and } from 'drizzle-orm';
import governmentData from '../shared/data/rulesets/classic/governments.json';

export interface GovernmentRequirement {
  type: string;
  name: string;
  range: string;
}

export interface Government {
  id: string;
  name: string;
  reqs?: GovernmentRequirement[];
  graphic: string;
  graphic_alt: string;
  sound: string;
  sound_alt: string;
  sound_alt2: string;
  ai_better?: string;
  ruler_male_title: string;
  ruler_female_title: string;
  helptext: string;
}

export interface PlayerGovernment {
  playerId: string;
  currentGovernment: string;
  revolutionTurns: number; // 0 = not in revolution, >0 = turns remaining in anarchy
  requestedGovernment?: string; // Government requested after revolution
}

// Load governments from JSON ruleset
export const GOVERNMENTS: Record<string, Government> = governmentData.governments.types as any;

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
    const targetGov = GOVERNMENTS[requestedGovernment];
    if (!targetGov) {
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
    const government = GOVERNMENTS[governmentId];
    if (!government) {
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

    const government = GOVERNMENTS[playerGov.currentGovernment];
    if (!government) {
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
    return Object.entries(GOVERNMENTS).map(([id, government]) => {
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
    return GOVERNMENTS;
  }

  public getGovernment(governmentId: string): Government | null {
    return GOVERNMENTS[governmentId] || null;
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
