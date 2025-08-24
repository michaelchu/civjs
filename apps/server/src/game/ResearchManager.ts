/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from '../database';
import { research as researchTable, playerTechs } from '../database/schema';
import { eq, and } from 'drizzle-orm';

export interface Technology {
  id: string;
  name: string;
  cost: number;
  requirements: string[]; // Required tech IDs
  rootRequirement?: string; // Root requirement that can't be bypassed
  flags: string[];
  description?: string;
}

export interface PlayerResearch {
  playerId: string;
  currentTech?: string;
  techGoal?: string;
  bulbsAccumulated: number;
  bulbsLastTurn: number;
  researchedTechs: Set<string>;
}

// Following Freeciv's classic technology tree
export const TECHNOLOGIES: Record<string, Technology> = {
  // Starting technologies
  alphabet: {
    id: 'alphabet',
    name: 'Alphabet',
    cost: 10,
    requirements: [],
    flags: [],
    description: 'Enables writing and record keeping',
  },

  pottery: {
    id: 'pottery',
    name: 'Pottery',
    cost: 10,
    requirements: [],
    flags: [],
    description: 'Enables granary construction and food storage',
  },

  // Tier 1 technologies
  mysticism: {
    id: 'mysticism',
    name: 'Mysticism',
    cost: 20,
    requirements: ['alphabet'],
    flags: [],
    description: 'Enables temples and spiritual buildings',
  },

  mathematics: {
    id: 'mathematics',
    name: 'Mathematics',
    cost: 20,
    requirements: ['alphabet'],
    flags: [],
    description: 'Foundation for advanced sciences',
  },

  bronze_working: {
    id: 'bronze_working',
    name: 'Bronze Working',
    cost: 20,
    requirements: ['pottery'],
    flags: [],
    description: 'Enables bronze tools and weapons',
  },

  animal_husbandry: {
    id: 'animal_husbandry',
    name: 'Animal Husbandry',
    cost: 20,
    requirements: ['pottery'],
    flags: [],
    description: 'Enables domestication of animals',
  },

  // Tier 2 technologies
  astronomy: {
    id: 'astronomy',
    name: 'Astronomy',
    cost: 40,
    requirements: ['mysticism', 'mathematics'],
    flags: [],
    description: 'Enables navigation and calendar systems',
  },

  iron_working: {
    id: 'iron_working',
    name: 'Iron Working',
    cost: 40,
    requirements: ['bronze_working'],
    flags: [],
    description: 'Enables iron tools and advanced weapons',
  },

  currency: {
    id: 'currency',
    name: 'Currency',
    cost: 40,
    requirements: ['bronze_working'],
    flags: [],
    description: 'Enables trade and marketplace buildings',
  },

  writing: {
    id: 'writing',
    name: 'Writing',
    cost: 40,
    requirements: ['alphabet'],
    flags: [],
    description: 'Enables libraries and advanced record keeping',
  },

  // Advanced technologies
  philosophy: {
    id: 'philosophy',
    name: 'Philosophy',
    cost: 80,
    requirements: ['writing', 'mysticism'],
    flags: ['bonus_tech'],
    description: 'First civilization to discover Philosophy gets a free technology',
  },

  literature: {
    id: 'literature',
    name: 'Literature',
    cost: 80,
    requirements: ['writing'],
    flags: [],
    description: 'Enables great works and cultural advancement',
  },

  engineering: {
    id: 'engineering',
    name: 'Engineering',
    cost: 80,
    requirements: ['mathematics', 'iron_working'],
    flags: ['bridge'],
    description: 'Enables construction of bridges and aqueducts',
  },
};

export class ResearchManager {
  private playerResearch: Map<string, PlayerResearch> = new Map();
  private gameId: string;

  constructor(gameId: string) {
    this.gameId = gameId;
  }

  public async initializePlayerResearch(playerId: string): Promise<void> {
    const research: PlayerResearch = {
      playerId,
      bulbsAccumulated: 0,
      bulbsLastTurn: 0,
      researchedTechs: new Set(['alphabet']), // Start with alphabet
    };

    this.playerResearch.set(playerId, research);

    // Save to database
    await db.insert(playerTechs).values({
      gameId: this.gameId,
      playerId,
      techId: 'alphabet',
      researchedTurn: 1,
    });
  }

  public async setCurrentResearch(playerId: string, techId: string): Promise<void> {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) {
      throw new Error(`Player ${playerId} research not initialized`);
    }

    const tech = TECHNOLOGIES[techId];
    if (!tech) {
      throw new Error(`Unknown technology: ${techId}`);
    }

    // Check if tech is already researched
    if (playerResearch.researchedTechs.has(techId)) {
      throw new Error(`Technology ${techId} already researched`);
    }

    // Check requirements
    for (const reqTech of tech.requirements) {
      if (!playerResearch.researchedTechs.has(reqTech)) {
        throw new Error(`Missing requirement: ${reqTech} for ${techId}`);
      }
    }

    playerResearch.currentTech = techId;

    // Update database - create research entry if it doesn't exist
    const existingResearch = await db
      .select()
      .from(researchTable)
      .where(and(eq(researchTable.gameId, this.gameId), eq(researchTable.playerId, playerId)));

    if (existingResearch.length === 0) {
      await db.insert(researchTable).values({
        gameId: this.gameId,
        playerId,
        currentTech: techId,
        bulbsAccumulated: 0,
        bulbsLastTurn: 0,
      });
    } else {
      await db
        .update(researchTable)
        .set({
          currentTech: techId,
        })
        .where(and(eq(researchTable.gameId, this.gameId), eq(researchTable.playerId, playerId)));
    }
  }

  public async setResearchGoal(playerId: string, techId: string): Promise<void> {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) {
      throw new Error(`Player ${playerId} research not initialized`);
    }

    const tech = TECHNOLOGIES[techId];
    if (!tech) {
      throw new Error(`Unknown technology: ${techId}`);
    }

    playerResearch.techGoal = techId;

    // Update database
    await db
      .update(researchTable)
      .set({
        techGoal: techId,
      })
      .where(and(eq(researchTable.gameId, this.gameId), eq(researchTable.playerId, playerId)));
  }

  public async addResearchPoints(playerId: string, bulbs: number): Promise<string | null> {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch || !playerResearch.currentTech) {
      return null;
    }

    const tech = TECHNOLOGIES[playerResearch.currentTech];
    if (!tech) {
      return null;
    }

    playerResearch.bulbsAccumulated += bulbs;
    playerResearch.bulbsLastTurn = bulbs;

    // Check if technology is completed
    if (playerResearch.bulbsAccumulated >= tech.cost) {
      const completedTech = playerResearch.currentTech;
      await this.completeTechnology(playerId, completedTech);
      return completedTech;
    }

    return null;
  }

  private async completeTechnology(playerId: string, techId: string): Promise<void> {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) {
      return;
    }

    const tech = TECHNOLOGIES[techId];
    if (!tech) {
      return;
    }

    // Mark technology as researched
    playerResearch.researchedTechs.add(techId);

    // Save excess bulbs
    const excessBulbs = playerResearch.bulbsAccumulated - tech.cost;
    playerResearch.bulbsAccumulated = 0;
    playerResearch.currentTech = undefined;

    // Save to database
    await db.insert(playerTechs).values({
      gameId: this.gameId,
      playerId,
      techId,
      researchedTurn: this.getCurrentTurn(),
    });

    // Handle bonus tech flag (Philosophy gives free tech)
    if (tech.flags.includes('bonus_tech')) {
      const availableTechs = this.getAvailableTechnologies(playerId);
      if (availableTechs.length > 0) {
        // Give random available tech
        const randomTech = availableTechs[Math.floor(Math.random() * availableTechs.length)];
        playerResearch.researchedTechs.add(randomTech.id);
        await db.insert(playerTechs).values({
          gameId: this.gameId,
          playerId,
          techId: randomTech.id,
          researchedTurn: this.getCurrentTurn(),
        });
      }
    }

    // Auto-select next research if goal is set
    if (playerResearch.techGoal && this.canResearch(playerId, playerResearch.techGoal)) {
      playerResearch.currentTech = playerResearch.techGoal;
      playerResearch.techGoal = undefined;
      playerResearch.bulbsAccumulated = excessBulbs;
    } else {
      // Auto-select a random available tech
      const availableTechs = this.getAvailableTechnologies(playerId);
      if (availableTechs.length > 0) {
        const nextTech = availableTechs[0]; // Pick first available
        playerResearch.currentTech = nextTech.id;
        playerResearch.bulbsAccumulated = excessBulbs;
      }
    }
  }

  public getAvailableTechnologies(playerId: string): Technology[] {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) {
      return [];
    }

    return Object.values(TECHNOLOGIES).filter(
      tech =>
        !playerResearch.researchedTechs.has(tech.id) &&
        tech.requirements.every(req => playerResearch.researchedTechs.has(req))
    );
  }

  public canResearch(playerId: string, techId: string): boolean {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) {
      return false;
    }

    const tech = TECHNOLOGIES[techId];
    if (!tech) {
      return false;
    }

    if (playerResearch.researchedTechs.has(techId)) {
      return false;
    }

    return tech.requirements.every(req => playerResearch.researchedTechs.has(req));
  }

  public getPlayerResearch(playerId: string): PlayerResearch | undefined {
    return this.playerResearch.get(playerId);
  }

  public getResearchProgress(
    playerId: string
  ): { current: number; required: number; turnsRemaining: number } | null {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch || !playerResearch.currentTech) {
      return null;
    }

    const tech = TECHNOLOGIES[playerResearch.currentTech];
    if (!tech) {
      return null;
    }

    const remaining = tech.cost - playerResearch.bulbsAccumulated;
    const turnsRemaining =
      playerResearch.bulbsLastTurn > 0 ? Math.ceil(remaining / playerResearch.bulbsLastTurn) : -1;

    return {
      current: playerResearch.bulbsAccumulated,
      required: tech.cost,
      turnsRemaining,
    };
  }

  public hasResearchedTech(playerId: string, techId: string): boolean {
    const playerResearch = this.playerResearch.get(playerId);
    return playerResearch?.researchedTechs.has(techId) || false;
  }

  public getResearchedTechs(playerId: string): string[] {
    const playerResearch = this.playerResearch.get(playerId);
    return playerResearch ? Array.from(playerResearch.researchedTechs) : [];
  }

  public async loadPlayerResearch(): Promise<void> {
    // Load research state from database
    const researchData = await db
      .select()
      .from(researchTable)
      .where(eq(researchTable.gameId, this.gameId));
    const techData = await db.select().from(playerTechs).where(eq(playerTechs.gameId, this.gameId));

    // Group techs by player
    const playerTechMap = new Map<string, string[]>();
    for (const tech of techData) {
      if (!playerTechMap.has(tech.playerId)) {
        playerTechMap.set(tech.playerId, []);
      }
      playerTechMap.get(tech.playerId)!.push(tech.techId);
    }

    // Restore research state
    for (const researchEntry of researchData) {
      const playerResearch: PlayerResearch = {
        playerId: researchEntry.playerId,
        currentTech: researchEntry.currentTech || undefined,
        techGoal: researchEntry.techGoal || undefined,
        bulbsAccumulated: researchEntry.bulbsAccumulated || 0,
        bulbsLastTurn: researchEntry.bulbsLastTurn || 0,
        researchedTechs: new Set(playerTechMap.get(researchEntry.playerId) || ['alphabet']),
      };

      this.playerResearch.set(researchEntry.playerId, playerResearch);
    }
  }

  private getCurrentTurn(): number {
    // This would typically come from the game manager
    return 1;
  }

  public cleanup(): void {
    this.playerResearch.clear();
  }

  public getDebugInfo(): any {
    return {
      gameId: this.gameId,
      playerCount: this.playerResearch.size,
      players: Object.fromEntries(
        Array.from(this.playerResearch.entries()).map(([playerId, research]) => [
          playerId,
          {
            currentTech: research.currentTech,
            techGoal: research.techGoal,
            bulbsAccumulated: research.bulbsAccumulated,
            bulbsLastTurn: research.bulbsLastTurn,
            researchedTechCount: research.researchedTechs.size,
            researchedTechs: Array.from(research.researchedTechs),
          },
        ])
      ),
    };
  }
}
