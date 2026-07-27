import { DatabaseProvider } from '@database';
import { research as researchTable, playerTechs } from '@database/schema';
import { eq, and } from 'drizzle-orm';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

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

/**
 * Build the playable technology catalogue from classic ruleset data.
 * @reference reference/freeciv/data/classic/techs.ruleset
 */
export function loadRulesetTechnologies(
  loader: Pick<typeof rulesetLoader, 'getTechs'> = rulesetLoader
): Record<string, Technology> {
  return Object.fromEntries(
    Object.entries(loader.getTechs()).map(([id, tech]) => [
      id,
      {
        id: tech.id,
        name: tech.name,
        cost: tech.cost,
        requirements: tech.requirements,
        rootRequirement: tech.root_req ?? undefined,
        flags: tech.flags,
        description: tech.description,
      },
    ])
  );
}

export const TECHNOLOGIES: Record<string, Technology> = loadRulesetTechnologies();

export class ResearchManager {
  private playerResearch: Map<string, PlayerResearch> = new Map();
  private gameId: string;
  private databaseProvider: DatabaseProvider;
  private currentTurnProvider?: () => number;

  constructor(
    gameId: string,
    databaseProvider: DatabaseProvider,
    private readonly technologies: Record<string, Technology> = TECHNOLOGIES
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
  }

  public setCurrentTurnProvider(provider: () => number): void {
    this.currentTurnProvider = provider;
  }

  public async initializePlayerResearch(playerId: string): Promise<void> {
    if (this.playerResearch.has(playerId)) {
      return;
    }

    const research: PlayerResearch = {
      playerId,
      bulbsAccumulated: 0,
      bulbsLastTurn: 0,
      researchedTechs: new Set(['alphabet']), // Start with alphabet
    };

    this.playerResearch.set(playerId, research);

    // Save to database
    await this.databaseProvider.getDatabase().insert(playerTechs).values({
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

    const tech = this.technologies[techId];
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
    const existingResearch = await this.databaseProvider
      .getDatabase()
      .select()
      .from(researchTable)
      .where(and(eq(researchTable.gameId, this.gameId), eq(researchTable.playerId, playerId)));

    if (existingResearch.length === 0) {
      await this.databaseProvider.getDatabase().insert(researchTable).values({
        gameId: this.gameId,
        playerId,
        currentTech: techId,
        bulbsAccumulated: 0,
        bulbsLastTurn: 0,
      });
    } else {
      await this.databaseProvider
        .getDatabase()
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

    const tech = this.technologies[techId];
    if (!tech) {
      throw new Error(`Unknown technology: ${techId}`);
    }

    playerResearch.techGoal = techId;

    // Update database
    await this.databaseProvider
      .getDatabase()
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

    const tech = this.technologies[playerResearch.currentTech];
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

    // @reference reference/freeciv/server/techtools.c:650-719
    // Persist per-turn research before a restart can discard the progress.
    await this.saveResearchState(playerResearch);

    return null;
  }

  private async completeTechnology(playerId: string, techId: string): Promise<void> {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) {
      return;
    }

    const tech = this.technologies[techId];
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
    await this.databaseProvider.getDatabase().insert(playerTechs).values({
      gameId: this.gameId,
      playerId,
      techId,
      researchedTurn: this.getCurrentTurn(),
    });

    // Handle bonus tech flag (Philosophy gives free tech)
    if (tech.flags.some(flag => flag.toLowerCase().replace(/[^a-z0-9]/g, '') === 'bonustech')) {
      const availableTechs = this.getAvailableTechnologies(playerId);
      if (availableTechs.length > 0) {
        // Give random available tech
        const randomTech = availableTechs[Math.floor(Math.random() * availableTechs.length)];
        playerResearch.researchedTechs.add(randomTech.id);
        await this.databaseProvider.getDatabase().insert(playerTechs).values({
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

    await this.saveResearchState(playerResearch);
  }

  private async saveResearchState(playerResearch: PlayerResearch): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .update(researchTable)
      .set({
        currentTech: playerResearch.currentTech ?? null,
        techGoal: playerResearch.techGoal ?? null,
        bulbsAccumulated: playerResearch.bulbsAccumulated,
        bulbsLastTurn: playerResearch.bulbsLastTurn,
      })
      .where(
        and(
          eq(researchTable.gameId, this.gameId),
          eq(researchTable.playerId, playerResearch.playerId)
        )
      );
  }

  public getAvailableTechnologies(playerId: string): Technology[] {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) {
      return [];
    }

    return Object.values(this.technologies).filter(
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

    const tech = this.technologies[techId];
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

    const tech = this.technologies[playerResearch.currentTech];
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

  public async grantTechnology(playerId: string, techId: string): Promise<boolean> {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) throw new Error(`Player ${playerId} research not initialized`);
    if (!this.technologies[techId] || playerResearch.researchedTechs.has(techId)) return false;
    playerResearch.researchedTechs.add(techId);
    await this.databaseProvider.getDatabase().insert(playerTechs).values({
      gameId: this.gameId,
      playerId,
      techId,
      researchedTurn: this.getCurrentTurn(),
    });
    return true;
  }

  public async loadPlayerResearch(): Promise<void> {
    // Load research state from database
    const researchData = await this.databaseProvider
      .getDatabase()
      .select()
      .from(researchTable)
      .where(eq(researchTable.gameId, this.gameId));
    const techData = await this.databaseProvider
      .getDatabase()
      .select()
      .from(playerTechs)
      .where(eq(playerTechs.gameId, this.gameId));

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

    // A player who has not selected a technology only has their starting tech
    // persisted. Recreate that state without inserting another starting-tech row.
    // @reference reference/freeciv/server/savegame/savegame3.c:7648-7741
    for (const [playerId, researchedTechs] of playerTechMap) {
      if (this.playerResearch.has(playerId)) continue;

      this.playerResearch.set(playerId, {
        playerId,
        bulbsAccumulated: 0,
        bulbsLastTurn: 0,
        researchedTechs: new Set(researchedTechs),
      });
    }
  }

  private getCurrentTurn(): number {
    return this.currentTurnProvider?.() ?? 1;
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
