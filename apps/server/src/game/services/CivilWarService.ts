/**
 * @module server/game/services/CivilWarService
 * Applies Freeciv's capital-loss civil-war sequence to an active runtime.
 */
import { DatabaseProvider } from '@database';
import { players as playerRecords } from '@database/schema';
import { eq } from 'drizzle-orm';
import type { CapitalLossEvent, CityState } from '@game/cities/CityTypes';
import { createAIState } from '@game/ai/AIStateStore';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import type { PlayerState } from '@game/runtime/GameTypes';
import { createOrderedUuid } from '@game/random/FreecivIdentityAllocator';
import { randomInt, type RandomSource } from '@game/random/FreecivRandom';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { NationRuleset } from '@shared/data/rulesets/schemas';

/** Freeciv's default `civilwarsize` server setting. */
export const GAME_DEFAULT_CIVIL_WAR_SIZE = 10;

export interface CivilWarResult {
  activated: boolean;
  rebelPlayerId?: string;
  reason?: string;
}

type CivilWarCityManager = {
  getCitiesByPlayer(playerId: string): CityState[];
  transferCity(
    cityId: string,
    newPlayerId: string,
    reason?: 'transfer' | 'civil_war'
  ): Promise<boolean>;
  establishCivilWarCapital(playerId: string, cityId: string): Promise<boolean>;
};

type CivilWarResearchManager = {
  getPlayerResearch(playerId: string):
    | {
        currentTech?: string;
        techGoal?: string;
        researchedTechs: Set<string>;
      }
    | undefined;
  initializePlayerResearch(playerId: string): Promise<void>;
  seedPlayerResearch(
    playerId: string,
    state: {
      researchedTechs?: string[];
      currentResearch?: string | null;
      researchGoal?: string | null;
      bulbsAccumulated?: number;
      bulbsLastTurn?: number;
    }
  ): Promise<void>;
};

type CivilWarGovernmentManager = {
  getPlayerGovernment(playerId: string): { currentGovernment: string } | undefined;
  loadPlayerGovernment(
    playerId: string,
    currentGovernment: string,
    revolutionTurns: number
  ): Promise<void>;
  startCivilWarRevolution(playerId: string, currentTurn: number): Promise<boolean>;
};

type CivilWarVisibilityManager = {
  getExploredTiles(playerId: string): Set<string>;
  getVisibleTiles(playerId: string): Set<string>;
  getLastSeenTiles(playerId: string): Record<string, Date>;
  getRememberedTiles(playerId: string): Map<string, unknown>;
  restorePlayerVisibility(
    playerId: string,
    exploredTiles: Iterable<string>,
    visibleTiles?: Iterable<string>,
    lastSeenByTile?: Readonly<Record<string, string | Date>>,
    rememberedTiles?: Readonly<Record<string, unknown>>
  ): void;
  updatePlayerVisibility(playerId: string): void;
};

type CivilWarEconomyManager = {
  getPlayerGold(playerId: string): Promise<number>;
  setPlayerGold(playerId: string, amount: number): Promise<boolean>;
  initializePlayer(playerId: string, startingGold: number): Promise<void>;
};

export interface CivilWarServiceOptions {
  gameId: string;
  rulesetName: string;
  maxPlayers: number;
  players: Map<string, PlayerState>;
  databaseProvider: DatabaseProvider;
  cityManager: CivilWarCityManager;
  researchManager: CivilWarResearchManager;
  governmentManager: CivilWarGovernmentManager;
  visibilityManager: CivilWarVisibilityManager;
  effectsManager: EffectsManager;
  random: RandomSource;
  currentTurn: () => number;
  registerTurnPlayer: (playerId: string) => void;
  economyManager?: CivilWarEconomyManager;
  aiLevel?: PlayerState['aiLevel'];
  onPlayerCreated?: (player: PlayerState) => void | Promise<void>;
}

/**
 * C2C3/Freeciv civil war handler. This intentionally has a prepare and an
 * execute step: Freeciv rolls the chance before city capture mutates city
 * buildings, but transfers the rebel cities after the capital has fallen.
 */
export class CivilWarService {
  public constructor(private readonly options: CivilWarServiceOptions) {}

  /**
   * Roll the source-compatible civil-war trigger before a capital changes owner.
   * @reference reference/freeciv/server/citytools.c:2021-2035 unit_conquer_city()
   * @reference reference/freeciv/server/plrhand.c:2915-2978 civil_war_possible(), civil_war_triggered()
   */
  public prepareCapitalLoss(event: CapitalLossEvent): boolean {
    const player = this.options.players.get(event.playerId);
    if (!player || player.isAlive === false) return false;
    if (!this.isCivilWarEnabled() || event.cityCountBeforeLoss < GAME_DEFAULT_CIVIL_WAR_SIZE) {
      return false;
    }

    // The source guarantees at least two cities after the loss before it can
    // construct a rebel player. Preserve that check before consuming the roll.
    if (event.cityCountBeforeLoss - 1 < 2) return false;

    const chance = this.civilWarChance(event.playerId);
    return randomInt(this.options.random, 100) < chance;
  }

  /**
   * Create the AI rebellion once the capital city has fallen.
   * @reference reference/freeciv/server/plrhand.c:3008-3157 civil_war()
   * @reference reference/freeciv/server/plrhand.c:2680-2910 split_player()
   */
  public async resolveCapitalLoss(event: CapitalLossEvent): Promise<CivilWarResult> {
    if (!event.civilWarTriggered) return { activated: false, reason: 'chance_not_triggered' };

    const sourcePlayer = this.options.players.get(event.playerId);
    if (!sourcePlayer || sourcePlayer.isAlive === false) {
      return { activated: false, reason: 'source_player_unavailable' };
    }
    if (this.normalPlayerCount() >= this.options.maxPlayers) {
      return { activated: false, reason: 'max_players_reached' };
    }

    const defectorCandidates = this.options.cityManager
      .getCitiesByPlayer(event.playerId)
      .filter(city => !city.isCapital);
    if (defectorCandidates.length === 0) {
      return { activated: false, reason: 'no_defector_cities' };
    }

    const rebelNation = this.pickRebelNation(sourcePlayer.nation);
    if (!rebelNation) return { activated: false, reason: 'no_rebel_nation' };

    const rebelPlayer = await this.createRebelPlayer(sourcePlayer, rebelNation);
    this.options.players.set(rebelPlayer.id, rebelPlayer);

    await this.options.governmentManager.loadPlayerGovernment(
      rebelPlayer.id,
      rebelPlayer.government!,
      0
    );
    await this.splitTreasury(sourcePlayer, rebelPlayer);
    await this.copyResearch(sourcePlayer.id, rebelPlayer.id);
    await this.options.governmentManager.startCivilWarRevolution(
      sourcePlayer.id,
      this.options.currentTurn()
    );
    sourcePlayer.government = 'anarchy';
    this.copyVisibility(sourcePlayer.id, rebelPlayer.id);

    let left = defectorCandidates.length;
    let toTransfer = Math.max(Math.floor(left / 2), 1);
    for (const city of defectorCandidates) {
      if (toTransfer >= left || (toTransfer > 0 && randomInt(this.options.random, 2) === 1)) {
        await this.options.cityManager.transferCity(city.id, rebelPlayer.id, 'civil_war');
        toTransfer--;
      }
      left--;
    }

    const rebelCities = this.options.cityManager.getCitiesByPlayer(rebelPlayer.id);
    if (rebelCities.length === 0) {
      return { activated: false, reason: 'city_transfer_failed' };
    }
    const capital = rebelCities[randomInt(this.options.random, rebelCities.length)]!;
    if (!(await this.options.cityManager.establishCivilWarCapital(rebelPlayer.id, capital.id))) {
      return { activated: false, reason: 'rebel_capital_failed' };
    }

    this.options.visibilityManager.updatePlayerVisibility(rebelPlayer.id);
    this.options.registerTurnPlayer(rebelPlayer.id);
    await this.options.onPlayerCreated?.(rebelPlayer);
    return { activated: true, rebelPlayerId: rebelPlayer.id };
  }

  private isCivilWarEnabled(): boolean {
    return rulesetLoader
      .loadActionsRuleset(this.options.rulesetName)
      .enablers.some(enabler => enabler.action === 'Civil War');
  }

  private civilWarChance(playerId: string): number {
    const government =
      this.options.governmentManager.getPlayerGovernment(playerId)?.currentGovernment;
    let chance = this.options.effectsManager.calculateEffect(EffectType.CIVIL_WAR_CHANCE, {
      playerId,
      government,
    }).value;
    for (const city of this.options.cityManager.getCitiesByPlayer(playerId)) {
      chance -= this.options.effectsManager.calculateEffect(EffectType.CIVIL_WAR_CITY_BONUS, {
        playerId,
        cityId: city.id,
        government,
        cityCelebrating: this.isCelebrating(city),
        cityDisorder: this.isInDisorder(city),
      }).value;
    }
    return chance;
  }

  private isCelebrating(city: CityState): boolean {
    return (
      city.wasHappy === true &&
      city.population >= 3 &&
      city.happiness.unhappy === 0 &&
      city.happiness.angry === 0 &&
      city.happiness.happy >= Math.ceil(city.population / 2)
    );
  }

  private isInDisorder(city: CityState): boolean {
    return city.happiness.happy < city.happiness.unhappy + 2 * city.happiness.angry;
  }

  private normalPlayerCount(): number {
    return [...this.options.players.values()].filter(
      player =>
        player.nation !== 'barbarian' && !player.civilization.toLowerCase().startsWith('barbarian')
    ).length;
  }

  private pickRebelNation(sourceNationId: string | undefined): NationRuleset | undefined {
    if (!sourceNationId) return undefined;
    const nations = rulesetLoader.getNations(this.options.rulesetName);
    const sourceNation = this.findNation(nations, sourceNationId);
    if (!sourceNation?.civilwar_nations?.length) return undefined;

    const occupied = new Set(
      [...this.options.players.values()]
        .map(player => player.nation?.toLowerCase())
        .filter((nation): nation is string => Boolean(nation))
    );
    const candidates = sourceNation.civilwar_nations
      .map(nationId => this.findNation(nations, nationId))
      .filter((nation): nation is NationRuleset => Boolean(nation))
      .filter(nation => !occupied.has(nation.id.toLowerCase()));
    if (candidates.length === 0) return undefined;
    return candidates[randomInt(this.options.random, candidates.length)];
  }

  private findNation(
    nations: Record<string, NationRuleset>,
    requestedNationId: string
  ): NationRuleset | undefined {
    const needle = requestedNationId.toLowerCase();
    return Object.entries(nations).find(([id]) => id.toLowerCase() === needle)?.[1];
  }

  private governmentId(governmentName: string): string {
    const requested = governmentName.toLowerCase();
    const governments = rulesetLoader.getGovernments(this.options.rulesetName);
    return (
      Object.entries(governments).find(
        ([id, government]) =>
          id.toLowerCase() === requested || government.name.toLowerCase() === requested
      )?.[0] ?? requested
    );
  }

  private async createRebelPlayer(
    sourcePlayer: PlayerState,
    rebelNation: NationRuleset
  ): Promise<PlayerState> {
    const playerNumber =
      [...this.options.players.values()].reduce(
        (maximum, player) => Math.max(maximum, player.playerNumber),
        -1
      ) + 1;
    const id = createOrderedUuid(playerNumber);
    const leader = rebelNation.leaders[randomInt(this.options.random, rebelNation.leaders.length)];
    const color = this.nextColor();
    const aiState = createAIState();
    // Freeciv marks a rebel phase-done so it does not act in the current
    // phase; its first AI decisions belong to the following turn.
    // @reference reference/freeciv/server/plrhand.c:2814-2816 split_player()
    aiState.lastProcessedTurn = this.options.currentTurn();
    const player: PlayerState = {
      id,
      userId: null,
      isAI: true,
      aiLevel: this.options.aiLevel ?? sourcePlayer.aiLevel ?? 'hard',
      aiTraits: { expansionist: 50, trader: 50, aggressive: 50, builder: 50 },
      aiState: aiState as unknown as Record<string, unknown>,
      playerNumber,
      civilization: rebelNation.id,
      nation: rebelNation.id,
      leaderName: leader?.name ?? `Rebel ${playerNumber}`,
      color,
      isAlive: true,
      gold: 0,
      science: sourcePlayer.science ?? 0,
      government: this.governmentId(rebelNation.init_government),
      history: 0,
      unitsBuilt: 0,
      unitsKilled: 0,
      unitsLost: 0,
      isReady: true,
      hasEndedTurn: true,
      isConnected: false,
      lastSeen: new Date(),
    };

    await this.options.databaseProvider
      .getDatabase()
      .insert(playerRecords)
      .values({
        id: player.id,
        gameId: this.options.gameId,
        userId: null,
        playerNumber: player.playerNumber,
        nation: player.nation!,
        civilization: player.civilization,
        leaderName: player.leaderName!,
        color: player.color!,
        isAlive: true,
        isAI: true,
        aiLevel: player.aiLevel,
        aiTraits: player.aiTraits,
        aiState: player.aiState,
        isReady: true,
        hasEndedTurn: true,
        connectionStatus: 'connected',
        government: player.government,
      })
      .returning();
    return player;
  }

  private async splitTreasury(sourcePlayer: PlayerState, rebelPlayer: PlayerState): Promise<void> {
    const sourceGold = this.options.economyManager
      ? await this.options.economyManager.getPlayerGold(sourcePlayer.id)
      : (sourcePlayer.gold ?? 0);
    const rebelGold = Math.floor(sourceGold / 2);
    const remainingGold = sourceGold - rebelGold;
    sourcePlayer.gold = remainingGold;
    rebelPlayer.gold = rebelGold;

    if (this.options.economyManager) {
      await this.options.economyManager.initializePlayer(rebelPlayer.id, rebelGold);
      await this.options.economyManager.setPlayerGold(sourcePlayer.id, remainingGold);
      return;
    }
    const balances: Array<[string, number]> = [
      [sourcePlayer.id, remainingGold],
      [rebelPlayer.id, rebelGold],
    ];
    await Promise.all(
      balances.map(([playerId, gold]) =>
        this.options.databaseProvider
          .getDatabase()
          .update(playerRecords)
          .set({ gold })
          .where(eq(playerRecords.id, playerId))
      )
    );
  }

  private async copyResearch(sourcePlayerId: string, rebelPlayerId: string): Promise<void> {
    const sourceResearch = this.options.researchManager.getPlayerResearch(sourcePlayerId);
    await this.options.researchManager.initializePlayerResearch(rebelPlayerId);
    if (!sourceResearch) return;

    const state = {
      researchedTechs: [...sourceResearch.researchedTechs],
      currentResearch: sourceResearch.currentTech ?? null,
      researchGoal: sourceResearch.techGoal ?? null,
      bulbsAccumulated: 0,
      bulbsLastTurn: 0,
    };
    await this.options.researchManager.seedPlayerResearch(rebelPlayerId, state);
    await this.options.researchManager.seedPlayerResearch(sourcePlayerId, state);
  }

  private copyVisibility(sourcePlayerId: string, rebelPlayerId: string): void {
    this.options.visibilityManager.restorePlayerVisibility(
      rebelPlayerId,
      this.options.visibilityManager.getExploredTiles(sourcePlayerId),
      this.options.visibilityManager.getVisibleTiles(sourcePlayerId),
      this.options.visibilityManager.getLastSeenTiles(sourcePlayerId),
      Object.fromEntries(this.options.visibilityManager.getRememberedTiles(sourcePlayerId))
    );
  }

  private nextColor(): { r: number; g: number; b: number } {
    const colors = rulesetLoader.loadGameRulesRuleset(this.options.rulesetName).player_colors
      .colorlist;
    const used = new Set(
      [...this.options.players.values()]
        .map(player => player.color)
        .filter((color): color is { r: number; g: number; b: number } => Boolean(color))
        .map(color => `${color.r},${color.g},${color.b}`)
    );
    return (
      colors.find(color => !used.has(`${color.r},${color.g},${color.b}`)) ??
      colors[0] ?? {
        r: 128,
        g: 128,
        b: 128,
      }
    );
  }
}
