import { eq, sql } from 'drizzle-orm';
import { DatabaseProvider } from '@database';
import {
  cities as cityRecords,
  games,
  players as playerRecords,
  units as unitRecords,
} from '@database/schema';
import { GameInstance, PlayerState, TurnPhase, GameState } from '@game/managers/GameManager';
import { BaseGameService } from '@game/orchestrators/GameService';
import { logger } from '@utils/logger';
import { CityManager } from '@game/managers/CityManager';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { MapManager } from '@game/managers/MapManager';
import { PathfindingManager } from '@game/managers/PathfindingManager';
import { MapStartpos } from '@game/map/MapTypes';
import { ResearchManager, loadRulesetTechnologies } from '@game/managers/ResearchManager';
import { TurnManager } from '@game/managers/TurnManager';
import { UnitManager } from '@game/managers/UnitManager';
import { VisibilityManager } from '@game/managers/VisibilityManager';
import { CultureManager } from '@game/managers/CultureManager';
import { EconomicManager } from '@game/systems/Economic/EconomicManager';
import { BorderManager } from '@game/managers/BorderManager';
import { BorderNetworkService } from '@game/services/BorderNetworkService';
import type { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import { Server as SocketServer } from 'socket.io';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { GovernmentManager } from '@game/managers/GovernmentManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';
import { isSettableAILevel } from '@game/ai/AIProfile';
import { assertAIState } from '@game/ai/AIStateStore';
import {
  completeSpaceshipPart,
  isSpaceshipPart,
  normalizeSpaceshipState,
} from '@game/services/SpaceshipService';
import {
  FreecivRandom,
  generateFreecivGameSeed,
  isFreecivRandomState,
} from '@game/random/FreecivRandom';
import {
  FREECIV_IDENTITY_NUMBER_SKIP,
  FreecivIdentityAllocator,
} from '@game/random/FreecivIdentityAllocator';

/**
 * GameInstanceRecoveryService - Extracted game recovery operations from GameManager
 * Handles all game instance recovery and restoration including:
 * - Game instance recovery from database
 * - Map data restoration and deserialization
 * - Manager initialization and state restoration
 * - Database-to-memory synchronization
 */
export class GameInstanceRecoveryService extends BaseGameService {
  constructor(
    private databaseProvider: DatabaseProvider,
    private games: Map<string, GameInstance>,
    private playerToGame: Map<string, string>,
    private io: SocketServer,
    private foundCity: (
      gameId: string,
      playerId: string,
      name: string,
      x: number,
      y: number
    ) => Promise<string>,
    private requestPath: (
      playerId: string,
      unitId: string,
      targetX: number,
      targetY: number
    ) => Promise<any>,
    // Note: createUnit callback removed as it's not currently used
    // private createUnit: (gameId: string, playerId: string, unitType: string, x: number, y: number) => Promise<string>,
    _broadcastToGame: (gameId: string, event: string, data: any) => void,
    private broadcastManager: GameBroadcastManager
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'GameInstanceRecoveryService';
  }

  /**
   * Recover a game instance from database storage
   * @reference Original GameManager.recoverGameInstance()
   */
  public async recoverGameInstance(gameId: string): Promise<GameInstance | null> {
    try {
      logger.info('Attempting to recover game instance from database', { gameId });

      const game = await this.fetchGameRecord(gameId);
      if (!game) return null;

      logger.info('Recovering game instance with map data', {
        gameId,
        playerCount: game.players.length,
        mapSize: `${game.mapWidth}x${game.mapHeight}`,
      });

      const players = this.buildPlayersMap(game, gameId);

      const mapManager = await this.createAndRestoreMapManager(game);

      const managers = await this.createManagers(gameId, game, mapManager, players);

      const gameInstance = this.buildRecoveredGameInstance(gameId, game, players, managers);

      this.games.set(gameId, gameInstance);

      await this.loadDataIntoManagers(managers);

      await this.initializeResearchAndVisibility(
        gameId,
        players,
        managers.researchManager,
        managers.visibilityManager
      );

      logger.info('Game instance recovered successfully', { gameId });
      return gameInstance;
    } catch (error) {
      logger.error('Failed to recover game instance:', error);
      return null;
    }
  }

  private async fetchGameRecord(gameId: string): Promise<any | null> {
    const game = await this.databaseProvider.getDatabase().query.games.findFirst({
      where: eq(games.id, gameId),
      with: { players: true },
    });

    if (!game || !['active', 'paused'].includes(game.status)) {
      logger.warn('Game not found or not recoverable, cannot recover', {
        gameId,
        found: !!game,
        status: game?.status,
      });
      return null;
    }

    if (!game.mapData || !game.mapSeed) {
      logger.warn('No map data found in database, cannot recover game instance', { gameId });
      return null;
    }
    return game;
  }

  private buildPlayersMap(game: any, gameId: string): Map<string, PlayerState> {
    const players = new Map<string, PlayerState>();
    for (const dbPlayer of [...game.players].sort(
      (left, right) => left.playerNumber - right.playerNumber
    )) {
      players.set(dbPlayer.id, {
        id: dbPlayer.id,
        userId: dbPlayer.userId,
        isAI: dbPlayer.isAI,
        aiLevel: dbPlayer.aiLevel,
        aiTraits: dbPlayer.aiTraits,
        aiState: dbPlayer.isAI ? assertAIState(dbPlayer.aiState) : dbPlayer.aiState,
        playerNumber: dbPlayer.playerNumber,
        civilization: dbPlayer.civilization,
        nation: dbPlayer.nation,
        leaderName: dbPlayer.leaderName,
        color: dbPlayer.color,
        isAlive: dbPlayer.isAlive,
        gold: dbPlayer.gold,
        science: dbPlayer.science,
        government: dbPlayer.government,
        history: dbPlayer.history ?? 0,
        teamId: dbPlayer.teamId ?? undefined,
        hasConceded: dbPlayer.hasConceded ?? false,
        spaceshipState: normalizeSpaceshipState(dbPlayer.spaceshipState),
        isReady: dbPlayer.isReady || false,
        hasEndedTurn: dbPlayer.hasEndedTurn || false,
        isConnected: dbPlayer.connectionStatus === 'connected',
        lastSeen: new Date(),
      });
      this.playerToGame.set(dbPlayer.id, gameId);
    }
    return players;
  }

  private async createAndRestoreMapManager(game: any): Promise<MapManager> {
    const storedTerrainSettings = (game.gameState as any)?.terrainSettings;
    const { temperatureParam, startPosMode } = this.getRecoveryMapConfig(storedTerrainSettings);
    const mapManager = new MapManager(
      game.mapWidth,
      game.mapHeight,
      undefined,
      'recovered',
      undefined,
      startPosMode,
      false,
      temperatureParam,
      {
        topologyId: storedTerrainSettings?.topologyId,
        wrapId: storedTerrainSettings?.wrapId,
      },
      storedTerrainSettings?.scenarioId,
      this.getRecoveryGenerationOptions(storedTerrainSettings, temperatureParam),
      game.ruleset ?? DEFAULT_RULESET
    );
    await this.restoreMapDataToManager(mapManager, game.mapData as any, game.mapSeed!);
    return mapManager;
  }

  private getRecoveryMapConfig(settings: any): {
    temperatureParam: number;
    startPosMode: MapStartpos;
  } {
    return {
      temperatureParam: settings?.temperature ?? 50,
      startPosMode: (settings?.startpos ?? MapStartpos.DEFAULT) as MapStartpos,
    };
  }

  private getRecoveryGenerationOptions(settings: any, temperature: number): any {
    return {
      landPercent: this.recoveryLandPercent(settings?.landmass),
      steepness: 30,
      wetness: this.recoveryValue(settings?.wetness, 50),
      temperature,
      riverDensity: this.recoveryValue(settings?.rivers, 50),
      resourceRichness: this.recoveryResourceRichness(settings?.resources),
      hutDensity: this.recoveryValue(settings?.huts, 15),
    };
  }

  private recoveryValue(value: number | undefined, fallback: number): number {
    return value ?? fallback;
  }

  private recoveryLandPercent(value: string | undefined): number {
    return value === 'sparse' ? 30 : value === 'dense' ? 70 : 50;
  }

  private recoveryResourceRichness(value: string | undefined): number {
    return value === 'sparse' ? 100 : value === 'abundant' ? 500 : 250;
  }

  private async createManagers(
    gameId: string,
    game: any,
    mapManager: MapManager,
    players: Map<string, PlayerState>
  ): Promise<{
    turnManager: TurnManager;
    unitManager: UnitManager;
    cityManager: CityManager;
    researchManager: ResearchManager;
    pathfindingManager: PathfindingManager;
    visibilityManager: VisibilityManager;
    borderManager: BorderManager;
    mapManager: MapManager;
    economicManager: EconomicManager;
    governmentManager: GovernmentManager;
    random: FreecivRandom;
    identities: FreecivIdentityAllocator;
  }> {
    // Create managers in dependency order
    const rulesetName = game.ruleset ?? 'civ2civ3';
    const effectsManager = new EffectsManager(rulesetName);
    const random = await this.createGameRandom(gameId, game);
    const identities = await this.createGameIdentities(gameId, game);
    const governmentManager = new GovernmentManager(
      gameId,
      this.databaseProvider,
      effectsManager,
      random
    );
    for (const player of game.players) {
      await governmentManager.loadPlayerGovernment(
        player.id,
        player.government,
        player.revolutionTurns
      );
    }

    // BorderNetworkService will be created after BorderManager

    // Create CityManager with growth callback that will use BorderManager
    // eslint-disable-next-line prefer-const
    let borderManager: BorderManager; // Declare first, initialize after managers are created
    const cityManager = new CityManager(
      gameId,
      this.databaseProvider,
      effectsManager,
      {
        onCityFounded: city => {
          if (!borderManager) return;
          borderManager.addCityBorderSource(city);
        },
        onCityCaptured: city => {
          if (!borderManager) return;
          borderManager.removeBorderSource(city.x, city.y);
          borderManager.addCityBorderSource(city);
          this.broadcastManager.broadcastMapData(gameId, mapManager.getMapData());
        },
        onCityGrowth: (city, oldSize) => {
          logger.info(`City ${city.name} grew from size ${oldSize} to ${city.size}`, {
            cityId: city.id,
            x: city.x,
            y: city.y,
            oldSize,
            newSize: city.size,
          });

          if (borderManager) {
            borderManager.recalculateAllBorders();
          }
        },
      },
      rulesetUnitsService.getUnitTypes(rulesetName),
      rulesetBuildingsService.getPlayableBuildingTypes(rulesetName),
      random,
      identities
    );
    cityManager.setMapManager(mapManager);
    cityManager.setMapChangedCallback((changedGameId, mapData) =>
      this.broadcastManager.broadcastMapData(changedGameId, mapData)
    );
    const researchManager = new ResearchManager(
      gameId,
      this.databaseProvider,
      loadRulesetTechnologies(rulesetLoader, rulesetName),
      effectsManager,
      rulesetName
    );
    governmentManager.setPlayerTechsProvider(
      playerId => new Set(researchManager.getResearchedTechs(playerId))
    );
    cityManager.setPlayerTechsProvider(
      playerId => new Set(researchManager.getResearchedTechs(playerId))
    );
    cityManager.setPlayerBuildingsProvider(
      playerId => new Set(cityManager.getCitiesByPlayer(playerId).flatMap(city => city.buildings))
    );
    cityManager.setPlayerSpaceshipProvider(playerId =>
      normalizeSpaceshipState(players.get(playerId)?.spaceshipState)
    );
    cityManager.setPlayerGovernmentProvider(playerId => {
      const government = governmentManager.getPlayerGovernment(playerId)?.currentGovernment;
      if (!government) {
        throw new Error(`No government found for player '${playerId}'`);
      }
      return government;
    });

    const unitManager = new UnitManager(
      gameId,
      this.databaseProvider,
      game.mapWidth,
      game.mapHeight,
      mapManager,
      {
        foundCity: this.foundCity.bind(this),
        requestPath: this.requestPath.bind(this),
        broadcastUnitMoved: gid => {
          this.broadcastManager.broadcastVisibilityState(gid);
        },
        getCityAt: (x: number, y: number) => {
          const city = cityManager.getCityAt(x, y);
          return city
            ? {
                id: city.id,
                playerId: city.playerId,
                buildings: city.buildings,
                population: city.population,
              }
            : null;
        },
        applyCityPopulationLoss: cityId => cityManager.applyCityPopulationLoss(cityId),
        getPlayerNation: (playerId: string) =>
          game.players.find((player: any) => player.id === playerId)?.nation ??
          game.players.find((player: any) => player.id === playerId)?.civilization,
        getCityNames: () => cityManager.getAllCities().map(city => city.name),
        getPlayerBuildings: playerId =>
          cityManager.getCitiesByPlayer(playerId).flatMap(city => city.buildings),
        reserveAirlift: (sourceCityId, destinationCityId, playerId, turn) =>
          cityManager.reserveAirlift(sourceCityId, destinationCityId, playerId, turn),
        establishTradeRoute: async (playerId, homeCityId, targetX, targetY) => {
          const destination = cityManager.getCityAt(targetX, targetY);
          return destination
            ? cityManager.establishTradeRoute(homeCityId, destination.id, playerId)
            : false;
        },
        executeCityUnitAction: (...args) => cityManager.executeUnitCityAction(...args),
        applyNuclearCityDamage: (...args) => cityManager.applyNuclearExplosion(...args),
        grantHutTechnology: async playerId => {
          const technology = researchManager.getAvailableTechnologies(playerId)[0];
          return technology && (await researchManager.grantTechnology(playerId, technology.id))
            ? technology.name
            : null;
        },
        captureCity: async (cityId, playerId, unitId) =>
          (await cityManager.captureCity(cityId, playerId, unitId)).success,
        broadcastMapChanged: (changedGameId, mapData) =>
          this.broadcastManager.broadcastMapData(changedGameId, mapData),
      },
      effectsManager,
      random,
      rulesetUnitsService.getUnitTypes(rulesetName),
      identities
    );
    cityManager.setCallbacks({
      onCityProductionComplete: async (city, item) => {
        if (item.kind === 'unit') {
          await unitManager.createUnit(city.playerId, item.value, city.x, city.y, city.id);
          return;
        }
        if (isSpaceshipPart(item.value)) {
          const owner = players.get(city.playerId);
          if (!owner) throw new Error(`Spaceship owner not found: ${city.playerId}`);
          owner.spaceshipState = completeSpaceshipPart(owner.spaceshipState, item.value);
          await this.databaseProvider
            .getDatabase()
            .update(playerRecords)
            .set({ spaceshipState: owner.spaceshipState })
            .where(eq(playerRecords.id, city.playerId));
          return;
        }
        const immediateTechs = effectsManager.calculateEffect(EffectType.GIVE_IMMEDIATE_TECH, {
          playerId: city.playerId,
          cityId: city.id,
          buildingId: item.value,
          cityBuildings: new Set(city.buildings),
          playerBuildings: new Set(
            cityManager.getCitiesByPlayer(city.playerId).flatMap(candidate => candidate.buildings)
          ),
          playerTechs: new Set(researchManager.getResearchedTechs(city.playerId)),
        }).value;
        if (immediateTechs > 0) {
          await researchManager.grantAvailableTechnologies(city.playerId, immediateTechs);
        }
      },
    });
    cityManager.setUnitSupportProvider(city => this.getUnitSupport(city, unitManager, cityManager));

    const pathfindingManager = new PathfindingManager(
      game.mapWidth,
      game.mapHeight,
      mapManager,
      unitManager
    );
    const visibilityManager = new VisibilityManager(
      gameId,
      unitManager,
      mapManager,
      effectsManager,
      playerId => new Set(researchManager.getResearchedTechs(playerId)),
      async (playerId, exploredTiles, visibleTiles, tileLastSeen, tileMemory) => {
        await this.databaseProvider
          .getDatabase()
          .update(playerRecords)
          .set({ exploredTiles, visibleTiles, tileLastSeen, tileMemory })
          .where(eq(playerRecords.id, playerId));
      }
    );
    visibilityManager.setCityVisionProvider(playerId =>
      cityManager.getCitiesByPlayer(playerId).map(city => ({ x: city.x, y: city.y }))
    );
    unitManager.setHutMapRevealProvider((playerId, x, y) => [
      ...visibilityManager.revealArea(playerId, x, y, 30),
    ]);
    unitManager.setExploredTilesProvider(playerId => visibilityManager.getExploredTiles(playerId));
    unitManager.setPlayerTechsProvider(
      playerId => new Set(researchManager.getResearchedTechs(playerId))
    );

    // Initialize BorderManager after CityManager is created, reusing the
    // game-owned effects instance so recovered games evaluate the same
    // ruleset context as newly created ones.
    const borderRules = rulesetLoader.getBorderRules(game.ruleset ?? 'civ2civ3');
    borderManager = new BorderManager(mapManager, cityManager, effectsManager, {
      borderCityRadiusSq: borderRules.radius_sq_city,
      borderSizeEffect: borderRules.size_effect,
    });
    unitManager.setTileExtrasChangedCallback(change =>
      borderManager.synchronizeTileExtras(
        change.x,
        change.y,
        change.playerId,
        change.added,
        change.removed
      )
    );
    const borderNetworkService = new BorderNetworkService(this.io, borderManager, gameId =>
      this.games.get(gameId)
    );

    // Set socket server for production completion events
    cityManager.setSocketServer(this.io);
    borderManager.setCallbacks({
      onBorderUpdate: update => {
        borderNetworkService.broadcastBorderUpdate(gameId, update);
      },
    });

    // Create CultureManager
    const cultureManager = new CultureManager(this.databaseProvider, game.ruleset ?? 'civ2civ3');
    cultureManager.setRuntimeState({
      getCity: cityId => cityManager.getCity(cityId),
      getPlayer: playerId => players.get(playerId),
    });
    const economicManager = new EconomicManager(gameId, this.databaseProvider, effectsManager);
    economicManager.setGovernmentProvider(
      playerId => governmentManager.getPlayerGovernment(playerId)?.currentGovernment ?? 'despotism'
    );
    await economicManager.initialize();
    for (const player of game.players) {
      await economicManager.initializePlayer(player.id, player.gold, {
        tax: player.taxRate,
        luxury: player.luxuryRate,
        science: player.scienceRate,
      });
    }
    cityManager.setTreasuryProviders(
      playerId => economicManager.getPlayerGold(playerId),
      async (playerId, amount) =>
        (
          await economicManager.spendPlayerGold(playerId, amount, 'Rush city production', {
            turn: game.currentTurn,
          })
        ).success
    );
    cityManager.setPlayerTaxRatesProvider(playerId => economicManager.getPlayerTaxRates(playerId));

    // Create TurnManager last with all dependencies
    const turnManager = new TurnManager(
      gameId,
      this.databaseProvider,
      this.io,
      unitManager,
      cityManager,
      researchManager,
      borderManager,
      visibilityManager,
      cultureManager,
      this.broadcastManager,
      economicManager,
      governmentManager,
      effectsManager,
      game.ruleset ?? 'civ2civ3',
      random,
      identities,
      game.gameState && typeof game.gameState === 'object'
        ? (game.gameState as { barbarianRate?: number }).barbarianRate
        : undefined
    );

    const playerIds = Array.from(players.keys());
    await turnManager.initializeTurn(playerIds, {
      currentTurn: game.currentTurn,
      createTurnRecord: false,
      broadcastTurnStart: false,
    });
    // @reference reference/freeciv/server/unittools.c:1215-1280
    unitManager.setCurrentTurnProvider(() => turnManager.getCurrentTurn());
    // @reference reference/freeciv/server/citytools.c:639-690
    cityManager.setCurrentTurnProvider(() => turnManager.getCurrentTurn());
    // @reference reference/freeciv/server/techtools.c:665-719
    // Keep recovered research associated with the restored authoritative turn.
    researchManager.setCurrentTurnProvider(() => turnManager.getCurrentTurn());

    return {
      turnManager,
      unitManager,
      cityManager,
      researchManager,
      pathfindingManager,
      visibilityManager,
      borderManager,
      mapManager,
      economicManager,
      governmentManager,
      random,
      identities,
    };
  }

  private async createGameRandom(gameId: string, game: any): Promise<FreecivRandom> {
    const storedState = (game.gameState as any)?.randomState;
    if (isFreecivRandomState(storedState)) return new FreecivRandom(storedState);

    const randomSeed = this.validRandomSeed((game.gameState as any)?.randomSeed);
    const random = new FreecivRandom(randomSeed);
    const identityNumber = Number.isInteger((game.gameState as any)?.identityNumber)
      ? (game.gameState as any).identityNumber
      : FREECIV_IDENTITY_NUMBER_SKIP;
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({
        gameState: sql`coalesce(${games.gameState}, '{}'::jsonb) || ${JSON.stringify({
          randomSeed,
          randomState: random.getState(),
          identityNumber,
        })}::jsonb`,
      })
      .where(eq(games.id, gameId));
    if (!game.gameState || typeof game.gameState !== 'object') game.gameState = {};
    game.gameState.randomSeed = randomSeed;
    game.gameState.randomState = random.getState();
    game.gameState.identityNumber = identityNumber;
    return random;
  }

  private validRandomSeed(storedSeed: unknown): number {
    return Number.isInteger(storedSeed) &&
      (storedSeed as number) >= 0 &&
      (storedSeed as number) <= 0xffff_ffff
      ? (storedSeed as number)
      : generateFreecivGameSeed();
  }

  private async createGameIdentities(gameId: string, game: any): Promise<FreecivIdentityAllocator> {
    const stored = (game.gameState as any)?.identityNumber;
    const [unitIds, cityIds] = await Promise.all([
      this.databaseProvider
        .getDatabase()
        .select({ id: unitRecords.id })
        .from(unitRecords)
        .where(eq(unitRecords.gameId, gameId)),
      this.databaseProvider
        .getDatabase()
        .select({ id: cityRecords.id })
        .from(cityRecords)
        .where(eq(cityRecords.gameId, gameId)),
    ]);
    const allocated = [...unitIds, ...cityIds]
      .map(record => Number.parseInt(record.id.slice(0, 8), 16))
      .filter(value => Number.isInteger(value) && value > 0 && value < 250_000);
    const identityNumber = Number.isInteger(stored) ? stored : FREECIV_IDENTITY_NUMBER_SKIP;
    return new FreecivIdentityAllocator(identityNumber, allocated);
  }

  private getUnitSupport(city: any, unitManager: any, cityManager: any): any[] {
    return [...unitManager.getAllUnits().values()]
      .filter(unit => unit.homeCityId === city.id)
      .map(unit => this.formatUnitSupport(city, unit, unitManager, cityManager));
  }

  private formatUnitSupport(city: any, unit: any, unitManager: any, cityManager: any): any {
    const type = unitManager.getUnitType(unit.unitTypeId);
    return {
      unitId: unit.id,
      unitType: unit.unitTypeId,
      homeCity: city.id,
      currentLocation: this.supportLocation(cityManager, unit),
      upkeep: this.supportUpkeep(type),
      ...this.supportFlags(city, unit, type),
    };
  }

  private supportLocation(cityManager: any, unit: any): string {
    return cityManager.getCityAt(unit.x, unit.y)?.id ?? `${unit.x},${unit.y}`;
  }
  private supportUpkeep(type: any): any {
    return { food: type?.uk_food ?? 0, shield: type?.uk_shield ?? 0, gold: type?.uk_gold ?? 0 };
  }
  private supportFlags(city: any, unit: any, type: any): any {
    return {
      isAwayFromHome: unit.x !== city.x || unit.y !== city.y,
      isMilitaryUnit: (type?.attack ?? 0) > 0,
    };
  }

  private buildRecoveredGameInstance(
    gameId: string,
    game: any,
    players: Map<string, PlayerState>,
    managers: {
      turnManager: TurnManager;
      unitManager: UnitManager;
      cityManager: CityManager;
      researchManager: ResearchManager;
      pathfindingManager: PathfindingManager;
      visibilityManager: VisibilityManager;
      borderManager: BorderManager;
      mapManager: MapManager;
      governmentManager: GovernmentManager;
      random: FreecivRandom;
      identities: FreecivIdentityAllocator;
    }
  ): GameInstance {
    return {
      id: gameId,
      config: {
        name: game.name,
        hostId: game.hostId,
        maxPlayers: game.maxPlayers,
        mapWidth: game.mapWidth,
        mapHeight: game.mapHeight,
        ruleset: game.ruleset || 'civ2civ3',
        turnTimeLimit: game.turnTimeLimit || undefined,
        maxTurns: game.maxTurns ?? 0,
        victoryConditions: (game.victoryConditions as string[]) || [
          'conquest',
          'science',
          'culture',
        ],
        aiLevel: isSettableAILevel((game.gameState as any)?.aiLevel)
          ? (game.gameState as any).aiLevel
          : 'easy',
        randomSeed: game.gameState.randomSeed,
      },
      state: game.status as GameState,
      pauseReason: game.pauseReason ?? undefined,
      turnDeadlineAt: game.turnDeadlineAt ?? null,
      pausedTimerSeconds: game.pausedTimerSeconds ?? null,
      currentTurn: game.currentTurn,
      turnPhase: game.turnPhase as TurnPhase,
      players,
      turnManager: managers.turnManager,
      mapManager: managers.mapManager,
      unitManager: managers.unitManager,
      visibilityManager: managers.visibilityManager,
      cityManager: managers.cityManager,
      researchManager: managers.researchManager,
      pathfindingManager: managers.pathfindingManager,
      borderManager: managers.borderManager,
      governmentManager: managers.governmentManager,
      random: managers.random,
      identities: managers.identities,
      lastActivity: new Date(),
    } as unknown as GameInstance;
  }

  private async loadDataIntoManagers(managers: {
    cityManager: CityManager;
    unitManager: UnitManager;
    borderManager: BorderManager;
  }): Promise<void> {
    // Initialize CityManager services (including TileManagementService for terrain-based calculations)
    await managers.cityManager.initialize();
    await managers.cityManager.loadCities();
    await managers.unitManager.loadUnits();
    for (const city of managers.cityManager.getAllCities()) {
      managers.cityManager.calculateCityOutputs(city.id);
    }
    this.restoreBorderSources(managers.cityManager, managers.borderManager);
  }

  private restoreBorderSources(cityManager: CityManager, borderManager: BorderManager): void {
    for (const city of cityManager.getAllCities()) {
      borderManager.addCityBorderSource(city);
    }
    borderManager.restoreExtraBorderSources();
  }

  private async initializeResearchAndVisibility(
    gameId: string,
    players: Map<string, PlayerState>,
    researchManager: ResearchManager,
    visibilityManager: VisibilityManager
  ): Promise<void> {
    // Restore completed technologies before filling in any legacy players without a record.
    // @reference reference/freeciv/server/savegame/savegame3.c:7648-7741
    // Reinitializing every player here would replace completed technologies after recovery.
    await researchManager.loadPlayerResearch();

    const persistedPlayers = await this.databaseProvider
      .getDatabase()
      .select({
        id: playerRecords.id,
        exploredTiles: playerRecords.exploredTiles,
        visibleTiles: playerRecords.visibleTiles,
        tileLastSeen: playerRecords.tileLastSeen,
        tileMemory: playerRecords.tileMemory,
      })
      .from(playerRecords)
      .where(eq(playerRecords.gameId, gameId));
    const persistedVisibility = new Map(persistedPlayers.map(player => [player.id, player]));

    for (const player of players.values()) {
      if (!researchManager.getPlayerResearch(player.id)) {
        await researchManager.initializePlayerResearch(player.id);
      }
      const stored = persistedVisibility.get(player.id);
      visibilityManager.restorePlayerVisibility(
        player.id,
        this.asTileKeys(stored?.exploredTiles),
        this.asTileKeys(stored?.visibleTiles),
        this.asLastSeenMap(stored?.tileLastSeen),
        this.asTileMemory(stored?.tileMemory)
      );
      visibilityManager.updatePlayerVisibility(player.id);
    }
  }

  private asTileKeys(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((tile): tile is string => typeof tile === 'string')
      : [];
  }

  private asLastSeenMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
  }

  private asTileMemory(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};
  }

  /**
   * Load a game from database into memory for testing purposes
   * @reference Original GameManager.loadGame()
   */
  public async loadGame(gameId: string): Promise<GameInstance | null> {
    // Check if game is already loaded
    const existingInstance = this.games.get(gameId);
    if (existingInstance) {
      return existingInstance;
    }

    // Try to recover from database
    return await this.recoverGameInstance(gameId);
  }

  /**
   * Restore map data from database to MapManager
   * @reference Original GameManager.restoreMapDataToManager()
   */
  private async restoreMapDataToManager(
    mapManager: MapManager,
    mapData: any,
    mapSeed: string
  ): Promise<void> {
    try {
      // Reconstruct full MapData from serialized database storage
      const restoredMapData = {
        width: mapData.width,
        height: mapData.height,
        topologyId: mapData.topologyId,
        wrapId: mapData.wrapId,
        seed: mapSeed,
        generatedAt: new Date(mapData.generatedAt),
        startingPositions: mapData.startingPositions || [],
        tiles: this.deserializeMapTiles(mapData.tiles, mapData.width, mapData.height),
      };

      // Bypass generation and restore the persisted map through MapManager's
      // public API so its MapAccessService serves the restored tiles.
      mapManager.setMapData(restoredMapData);

      logger.info('Map data restored to manager', {
        width: restoredMapData.width,
        height: restoredMapData.height,
        startingPositions: restoredMapData.startingPositions.length,
      });
    } catch (error) {
      logger.error('Failed to restore map data to manager:', error);
      throw error;
    }
  }

  /**
   * Deserialize compressed map tiles from database storage
   * @reference Original GameManager.deserializeMapTiles()
   */
  private deserializeMapTiles(compressedTiles: any, width: number, height: number): any[][] {
    // Current saves store tiles as the map's native column-major [x][y]
    // array. Keep accepting the older coordinate-keyed object format below
    // for saves created before the serializer was updated.
    if (Array.isArray(compressedTiles)) {
      return Array.from({ length: width }, (_, x) =>
        Array.from({ length: height }, (_, y) => {
          const tileData = compressedTiles[x]?.[y];
          return tileData
            ? this.applyTileData(this.createDefaultTile(x, y), tileData)
            : this.createDefaultTile(x, y);
        })
      );
    }

    // Create empty tile array filled with ocean tiles - match generation pattern [x][y]
    const tiles: any[][] = [];

    for (let x = 0; x < width; x++) {
      tiles[x] = [];
      for (let y = 0; y < height; y++) {
        tiles[x][y] = this.createDefaultTile(x, y);
      }
    }

    // Restore non-ocean tiles from compressed storage
    if (compressedTiles) {
      for (const [key, tileData] of Object.entries(compressedTiles)) {
        const [x, y] = key.split(',').map(Number);
        if (this.isValidTileKey(x, y, width, height, tileData)) {
          tiles[x][y] = this.applyTileData(tiles[x][y], tileData as any);
        }
      }
    }

    return tiles;
  }

  private createDefaultTile(x: number, y: number): any {
    return {
      x,
      y,
      terrain: 'ocean',
      elevation: 0,
      riverMask: 0,
      continentId: 0,
      isExplored: false,
      isVisible: false,
      hasRoad: false,
      hasRailroad: false,
      improvements: [],
      unitIds: [],
      properties: {},
      temperature: 4, // TEMPERATE
      wetness: 50,
    };
  }

  private isValidTileKey(
    x: number,
    y: number,
    width: number,
    height: number,
    tileData: unknown
  ): boolean {
    return this.isWithinBounds(x, y, width, height) && !!tileData && typeof tileData === 'object';
  }

  private isWithinBounds(x: number, y: number, width: number, height: number): boolean {
    return x >= 0 && x < width && y >= 0 && y < height;
  }

  private applyTileData(baseTile: any, tileData: any): any {
    return {
      ...baseTile, // Keep default values
      ...tileData, // Override with stored data
    };
  }
}
