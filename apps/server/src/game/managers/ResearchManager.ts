import { DatabaseProvider } from '@database';
import { research as researchTable, playerTechs } from '@database/schema';
import { eq, and } from 'drizzle-orm';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';

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
  futureTechs: number;
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
export const FUTURE_TECH_ID = 'future_tech';

export class ResearchManager {
  private playerResearch: Map<string, PlayerResearch> = new Map();
  private gameId: string;
  private databaseProvider: DatabaseProvider;
  private currentTurnProvider?: () => number;

  constructor(
    gameId: string,
    databaseProvider: DatabaseProvider,
    private readonly technologies: Record<string, Technology> = TECHNOLOGIES,
    private readonly effectsManager: EffectsManager = new EffectsManager()
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
  }

  public setCurrentTurnProvider(provider: () => number): void {
    this.currentTurnProvider = provider;
  }

  /**
   * Calculate per-turn research upkeep. Classic explicitly selects "None",
   * but keeping the full formula here makes Tech_Upkeep_Free executable if
   * the ruleset setting is changed.
   * @reference reference/freeciv/common/research.c:1062-1142
   */
  public calculateTechnologyUpkeep(
    playerId: string,
    cityCount: number,
    playerBuildings: Set<string> = new Set()
  ): number {
    const rules = rulesetLoader.loadGameRulesRuleset().research;
    if (rules.tech_upkeep_style === 'None') return 0;
    const research = this.playerResearch.get(playerId);
    if (!research) return 0;

    const totalCost = [...research.researchedTechs].reduce(
      (sum, techId) => sum + (this.technologies[techId]?.cost ?? 0),
      0
    );
    const free = this.effectsManager.calculateEffect(EffectType.TECH_UPKEEP_FREE, {
      playerId,
      playerTechs: new Set(research.researchedTechs),
      playerBuildings,
    }).value;
    let upkeep = Math.max(0, totalCost / rules.tech_upkeep_divider - free);
    if (rules.tech_upkeep_style === 'Cities') upkeep *= cityCount;
    return Math.floor(upkeep);
  }

  public async initializePlayerResearch(playerId: string): Promise<void> {
    if (this.playerResearch.has(playerId)) {
      return;
    }

    const research: PlayerResearch = {
      playerId,
      bulbsAccumulated: 0,
      bulbsLastTurn: 0,
      researchedTechs: new Set(),
      futureTechs: 0,
    };

    this.playerResearch.set(playerId, research);

    await this.ensureCurrentResearch(playerId);
  }

  /**
   * Freeciv begins a new game with an available research target selected and
   * also repairs an unset target at phase end. Use a stable cheapest-first
   * choice so authoritative replays remain deterministic.
   *
   * @reference reference/freeciv/server/techtools.c:983-994
   * @reference reference/freeciv/server/srv_main.c:1492-1510
   */
  public async ensureCurrentResearch(playerId: string): Promise<string | undefined> {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) {
      throw new Error(`Player ${playerId} research not initialized`);
    }
    if (playerResearch.currentTech) return playerResearch.currentTech;

    const target = this.selectNextResearchTarget(playerResearch);
    if (!target) return undefined;

    await this.setCurrentResearch(playerId, target.id);
    return target.id;
  }

  public async setCurrentResearch(playerId: string, techId: string): Promise<void> {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) {
      throw new Error(`Player ${playerId} research not initialized`);
    }

    const tech = this.getTechnologyForPlayer(playerResearch, techId);
    if (!tech) {
      throw new Error(`Unknown technology: ${techId}`);
    }

    // Check if tech is already researched
    if (playerResearch.researchedTechs.has(techId)) {
      throw new Error(`Technology ${techId} already researched`);
    }

    if (!this.canResearch(playerId, techId)) {
      const missingRequirement = tech.requirements.find(
        reqTech => !playerResearch.researchedTechs.has(reqTech)
      );
      throw new Error(
        missingRequirement
          ? `Missing requirement: ${missingRequirement} for ${techId}`
          : `Technology ${techId} is not currently researchable`
      );
    }

    const switchingTargets =
      playerResearch.currentTech !== undefined && playerResearch.currentTech !== techId;
    if (switchingTargets && playerResearch.bulbsAccumulated > 0) {
      // Classic's default techpenalty is 100 percent.
      // @reference reference/freeciv/common/game.h GAME_DEFAULT_TECHPENALTY
      // @reference reference/freeciv/server/techtools.c:1048-1062
      playerResearch.bulbsAccumulated = 0;
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
          bulbsAccumulated: playerResearch.bulbsAccumulated,
        })
        .where(and(eq(researchTable.gameId, this.gameId), eq(researchTable.playerId, playerId)));
    }
  }

  public async setResearchGoal(playerId: string, techId: string): Promise<void> {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) {
      throw new Error(`Player ${playerId} research not initialized`);
    }

    const tech = this.getTechnologyForPlayer(playerResearch, techId);
    if (!tech) {
      throw new Error(`Unknown technology: ${techId}`);
    }
    if (playerResearch.researchedTechs.has(techId)) {
      throw new Error(`Technology ${techId} already researched`);
    }
    if (techId === FUTURE_TECH_ID && !this.canResearch(playerId, techId)) {
      throw new Error('Future Tech is only available after completing the classic technology tree');
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
    if (!playerResearch) {
      return null;
    }

    // Freeciv keeps bulbs generated while no target is selected and then
    // automatically chooses an available technology. Do not silently discard
    // a city's science output.
    // @reference reference/freeciv/server/techtools.c:650-726
    if (!playerResearch.currentTech) await this.ensureCurrentResearch(playerId);
    if (!playerResearch.currentTech) {
      playerResearch.bulbsAccumulated += bulbs;
      playerResearch.bulbsLastTurn = bulbs;
      await this.saveResearchState(playerResearch);
      return null;
    }

    const tech = this.getTechnologyForPlayer(playerResearch, playerResearch.currentTech);
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

    const tech = this.getTechnologyForPlayer(playerResearch, techId);
    if (!tech) {
      return;
    }

    const isFutureTech = techId === FUTURE_TECH_ID;
    if (isFutureTech) {
      playerResearch.futureTechs++;
    } else {
      playerResearch.researchedTechs.add(techId);
    }

    // Save excess bulbs
    const excessBulbs = playerResearch.bulbsAccumulated - tech.cost;
    playerResearch.bulbsAccumulated = 0;
    playerResearch.currentTech = undefined;

    // Save to database
    await this.databaseProvider
      .getDatabase()
      .insert(playerTechs)
      .values({
        gameId: this.gameId,
        playerId,
        techId: isFutureTech ? `${FUTURE_TECH_ID}_${playerResearch.futureTechs}` : techId,
        researchedTurn: this.getCurrentTurn(),
      });

    // Classic awards Philosophy's bonus only to its first discoverer and,
    // with free_tech_method = Goal, advances the selected goal path.
    // @reference reference/freeciv/server/techtools.c:359-405, 1388-1425
    const isFirstDiscovery = [...this.playerResearch.values()].every(
      other => other.playerId === playerId || !other.researchedTechs.has(techId)
    );
    if (
      !isFutureTech &&
      isFirstDiscovery &&
      tech.flags.some(flag => flag.toLowerCase().replace(/[^a-z0-9]/g, '') === 'bonustech')
    ) {
      const freeTech = this.selectNextResearchTarget(playerResearch);
      if (freeTech && freeTech.id !== FUTURE_TECH_ID) {
        await this.grantTechnology(playerId, freeTech.id);
      }
    }

    if (
      playerResearch.techGoal &&
      playerResearch.techGoal !== FUTURE_TECH_ID &&
      playerResearch.researchedTechs.has(playerResearch.techGoal)
    ) {
      playerResearch.techGoal = undefined;
    }

    const nextTech = this.selectNextResearchTarget(playerResearch);
    if (nextTech) {
      playerResearch.currentTech = nextTech.id;
      playerResearch.bulbsAccumulated = excessBulbs;
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

    const available = Object.values(this.technologies).filter(
      tech =>
        !playerResearch.researchedTechs.has(tech.id) &&
        tech.requirements.every(req => playerResearch.researchedTechs.has(req))
    );
    if (available.length === 0 && this.hasCompletedTechnologyTree(playerResearch)) {
      available.push(this.createFutureTechnology(playerResearch));
    }
    return available;
  }

  public canResearch(playerId: string, techId: string): boolean {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) {
      return false;
    }

    const tech = this.getTechnologyForPlayer(playerResearch, techId);
    if (!tech) {
      return false;
    }

    if (techId !== FUTURE_TECH_ID && playerResearch.researchedTechs.has(techId)) {
      return false;
    }

    return techId === FUTURE_TECH_ID
      ? this.hasCompletedTechnologyTree(playerResearch)
      : tech.requirements.every(req => playerResearch.researchedTechs.has(req));
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

    const tech = this.getTechnologyForPlayer(playerResearch, playerResearch.currentTech);
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

  public getTechnologyCatalogue(playerId: string): Technology[] {
    const research = this.playerResearch.get(playerId);
    const technologies = Object.values(this.technologies);
    return research ? [...technologies, this.createFutureTechnology(research)] : technologies;
  }

  public async grantTechnology(playerId: string, techId: string): Promise<boolean> {
    const playerResearch = this.playerResearch.get(playerId);
    if (!playerResearch) throw new Error(`Player ${playerId} research not initialized`);
    if (
      techId === FUTURE_TECH_ID ||
      !this.technologies[techId] ||
      playerResearch.researchedTechs.has(techId)
    ) {
      return false;
    }
    playerResearch.researchedTechs.add(techId);
    await this.databaseProvider.getDatabase().insert(playerTechs).values({
      gameId: this.gameId,
      playerId,
      techId,
      researchedTurn: this.getCurrentTurn(),
    });
    return true;
  }

  public async grantAvailableTechnologies(playerId: string, count: number): Promise<string[]> {
    const granted: string[] = [];
    for (let index = 0; index < count; index++) {
      const next = this.getAvailableTechnologies(playerId)[0];
      if (!next || !(await this.grantTechnology(playerId, next.id))) break;
      granted.push(next.id);
    }
    return granted;
  }

  /**
   * Great Library: learn a technology once at least two other players know it.
   * @reference reference/freeciv/data/classic/effects.ruleset effect_great_library
   */
  public async processTechParasite(
    playerId: string,
    requiredPlayers: number = 2
  ): Promise<string[]> {
    const research = this.playerResearch.get(playerId);
    if (!research) return [];
    const granted: string[] = [];
    for (const tech of Object.values(this.technologies)) {
      if (research.researchedTechs.has(tech.id)) continue;
      const knownByOthers = [...this.playerResearch.values()].filter(
        other => other.playerId !== playerId && other.researchedTechs.has(tech.id)
      ).length;
      if (knownByOthers >= requiredPlayers && (await this.grantTechnology(playerId, tech.id))) {
        granted.push(tech.id);
      }
    }
    return granted;
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
      const persistedTechs = playerTechMap.get(researchEntry.playerId) || [];
      const playerResearch: PlayerResearch = {
        playerId: researchEntry.playerId,
        currentTech: researchEntry.currentTech || undefined,
        techGoal: researchEntry.techGoal || undefined,
        bulbsAccumulated: researchEntry.bulbsAccumulated || 0,
        bulbsLastTurn: researchEntry.bulbsLastTurn || 0,
        researchedTechs: new Set(
          persistedTechs.filter(techId => !techId.startsWith(`${FUTURE_TECH_ID}_`))
        ),
        futureTechs: this.countPersistedFutureTechs(persistedTechs),
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
        researchedTechs: new Set(
          researchedTechs.filter(techId => !techId.startsWith(`${FUTURE_TECH_ID}_`))
        ),
        futureTechs: this.countPersistedFutureTechs(researchedTechs),
      });
    }

    for (const playerId of this.playerResearch.keys()) {
      await this.ensureCurrentResearch(playerId);
    }
  }

  private getCurrentTurn(): number {
    return this.currentTurnProvider?.() ?? 1;
  }

  private selectNextResearchTarget(playerResearch: PlayerResearch): Technology | undefined {
    if (playerResearch.techGoal) {
      const goalStep = this.getGoalStep(playerResearch, playerResearch.techGoal);
      if (goalStep) return goalStep;
    }
    return this.getAvailableTechnologies(playerResearch.playerId).sort(
      (left, right) => left.cost - right.cost || left.id.localeCompare(right.id)
    )[0];
  }

  private getGoalStep(playerResearch: PlayerResearch, goalId: string): Technology | undefined {
    if (goalId === FUTURE_TECH_ID) {
      return this.hasCompletedTechnologyTree(playerResearch)
        ? this.createFutureTechnology(playerResearch)
        : undefined;
    }

    const goal = this.technologies[goalId];
    if (!goal || playerResearch.researchedTechs.has(goalId)) return undefined;
    const onGoalPath = new Set<string>();
    const visit = (techId: string): void => {
      if (playerResearch.researchedTechs.has(techId) || onGoalPath.has(techId)) return;
      const technology = this.technologies[techId];
      if (!technology) return;
      onGoalPath.add(techId);
      technology.requirements.forEach(visit);
    };
    visit(goalId);

    return [...onGoalPath]
      .filter(techId => this.canResearch(playerResearch.playerId, techId))
      .map(techId => this.technologies[techId])
      .sort((left, right) => left.cost - right.cost || left.id.localeCompare(right.id))[0];
  }

  private hasCompletedTechnologyTree(playerResearch: PlayerResearch): boolean {
    return Object.keys(this.technologies).every(techId =>
      playerResearch.researchedTechs.has(techId)
    );
  }

  private createFutureTechnology(playerResearch: PlayerResearch): Technology {
    const rules = rulesetLoader.loadGameRulesRuleset().research;
    const researchedCount = Object.keys(this.technologies).length + playerResearch.futureTechs;
    const prerequisites = new Set(
      Object.values(this.technologies).flatMap(technology => technology.requirements)
    );
    return {
      id: FUTURE_TECH_ID,
      name: `Future Tech. ${playerResearch.futureTechs + 1}`,
      cost: Math.max(rules.min_tech_cost, rules.base_tech_cost * researchedCount),
      requirements: Object.keys(this.technologies).filter(techId => !prerequisites.has(techId)),
      flags: [],
      description: 'Continued scientific progress beyond the classic technology tree.',
    };
  }

  private getTechnologyForPlayer(
    playerResearch: PlayerResearch,
    techId: string
  ): Technology | undefined {
    return techId === FUTURE_TECH_ID
      ? this.createFutureTechnology(playerResearch)
      : this.technologies[techId];
  }

  private countPersistedFutureTechs(techIds: string[]): number {
    return techIds.filter(techId => techId.startsWith(`${FUTURE_TECH_ID}_`)).length;
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
            futureTechs: research.futureTechs,
          },
        ])
      ),
    };
  }
}
