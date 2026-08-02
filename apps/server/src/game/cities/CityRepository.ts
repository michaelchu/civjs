import type { DatabaseProvider } from '@database';
import { cities } from '@database/schema';
import { SpecialistType } from '@game/constants/SpecialistDefinitions';
import type { UnitType } from '@game/services/RulesetUnitsService';
import { eq } from 'drizzle-orm';
import { logger } from '@utils/logger';
import { CITY_MAP_DEFAULT_RADIUS } from './CityConstants';
import type {
  BuildingType,
  CityGovernor,
  CityRallyPoint,
  CityState,
  ProductionItem,
  TradeRoute,
} from './CityTypes';

export interface LoadedCity {
  city: CityState;
  workedTiles: Array<{ x: number; y: number }> | null;
}

export class CityRepository {
  constructor(
    private readonly gameId: string,
    private readonly databaseProvider: DatabaseProvider,
    private readonly unitTypes: Record<string, UnitType>,
    private readonly buildingTypes: Record<string, BuildingType>
  ) {}

  async loadAll(): Promise<LoadedCity[]> {
    const records = await this.databaseProvider
      .getDatabase()
      .select()
      .from(cities)
      .where(eq(cities.gameId, this.gameId));
    return records.map(record => ({
      city: {
        id: record.id,
        name: record.name,
        x: record.x,
        y: record.y,
        playerId: record.playerId,
        originalOwnerId: record.originalOwnerId ?? record.playerId,
        population: record.population,
        size: record.population,
        cityRadius: CITY_MAP_DEFAULT_RADIUS,
        founded: record.foundedTurn || 1,
        currentProduction: record.currentProduction,
        productionType: this.inferProductionType(record.currentProduction),
        turnsToComplete: 0,
        foodStock: record.food || 0,
        foodPerTurn: record.foodPerTurn || 0,
        productionPerTurn: record.productionPerTurn || 0,
        tradePerTurn: record.tradePerTurn || 0,
        sciencePerTurn: record.sciencePerTurn || 0,
        goldPerTurn: record.goldPerTurn || 0,
        luxuryPerTurn: record.luxuryPerTurn || 0,
        pollution: record.pollution || 0,
        history: record.history || 0,
        wasHappy: record.wasHappy,
        disorderTurns: record.disorderTurns,
        productionStock: record.production || 0,
        buildings: (record.buildings as string[]) || [],
        specialists: (record.specialists as Record<SpecialistType, number>) || {
          [SpecialistType.SCIENTIST]: 0,
          [SpecialistType.TAX_COLLECTOR]: 0,
          [SpecialistType.ENTERTAINER]: 0,
          [SpecialistType.WORKER]: 0,
          [SpecialistType.ENGINEER]: 0,
          [SpecialistType.MERCHANT]: 0,
        },
        tradeRoutes: (record.tradeRoutes as TradeRoute[]) || [],
        governor: (record.governor as CityGovernor | null) ?? undefined,
        rallyPoint: normalizeRallyPoint(record.rallyPoint),
        happiness: {
          happy: 0,
          content: Math.max(0, record.population - 1),
          unhappy: record.happiness < 0 ? Math.abs(record.happiness) : 0,
          angry: 0,
        },
        worklist: (record.productionQueue as ProductionItem[]) || [],
        defenseStrength: record.defenseStrength || 1,
        airliftUsedTurn: record.airliftUsedTurn ?? undefined,
        isCapital: record.isCapital,
        didSellTurn: record.didSellTurn ?? undefined,
        didBuyTurn: record.didBuyTurn ?? undefined,
        espionageThefts: (record.espionageThefts as Record<string, number>) || {},
      },
      workedTiles: record.workedTiles as Array<{ x: number; y: number }> | null,
    }));
  }

  async save(city: CityState): Promise<void> {
    const cityData = {
      id: city.id,
      gameId: this.gameId,
      name: city.name,
      x: city.x,
      y: city.y,
      playerId: city.playerId,
      population: city.population,
      foundedTurn: city.founded || 1,
      originalOwnerId: city.originalOwnerId ?? city.playerId,
      currentProduction: city.currentProduction,
      food: city.foodStock || 0,
      foodPerTurn: city.foodPerTurn || 0,
      production: city.productionStock || 0,
      productionPerTurn: city.productionPerTurn || 0,
      tradePerTurn: city.tradePerTurn || 0,
      goldPerTurn: city.goldPerTurn || 0,
      luxuryPerTurn: city.luxuryPerTurn || 0,
      sciencePerTurn: city.sciencePerTurn || 0,
      pollution: city.pollution || 0,
      tradeRoutes: city.tradeRoutes,
      governor: city.governor ?? null,
      rallyPoint: city.rallyPoint ?? null,
      culturePerTurn: 0,
      faithPerTurn: 0,
      history: city.history || 0,
      buildings: city.buildings,
      specialists: city.specialists,
      productionQueue: city.worklist,
      happiness: city.happiness.content - city.happiness.unhappy,
      wasHappy: city.wasHappy ?? false,
      disorderTurns: city.disorderTurns ?? 0,
      defenseStrength: city.defenseStrength || 1,
      airliftUsedTurn: city.airliftUsedTurn ?? null,
      didSellTurn: city.didSellTurn ?? null,
      didBuyTurn: city.didBuyTurn ?? null,
      espionageThefts: city.espionageThefts,
      health: 100,
      isCapital: city.isCapital ?? city.buildings.includes('palace'),
      isPuppet: false,
      isOccupied: false,
      wallsLevel: 0,
      workedTiles:
        city.workableTiles?.filter(tile => tile.isWorked).map(tile => ({ x: tile.x, y: tile.y })) ||
        [],
    };
    const operation = this.databaseProvider
      .getDatabase()
      .insert(cities)
      .values(cityData)
      .onConflictDoUpdate({
        target: cities.id,
        set: cityData,
      });
    const timeoutMs = process.env.NODE_ENV === 'test' ? 5000 : 10000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(`Database operation timed out for city ${city.id} after ${timeoutMs}ms`)
              ),
            timeoutMs
          );
          timeout.unref?.();
        }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to save city to database', {
        cityId: city.id,
        cityName: city.name,
        gameId: this.gameId,
        error: message,
        isTimeout: message.includes('timed out'),
      });
      if (!message.includes('timed out')) throw error;
      logger.warn('Database timeout occurred, continuing with turn processing', {
        cityId: city.id,
        cityName: city.name,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  inferProductionType(productionId: string | null): 'unit' | 'building' | null {
    if (!productionId || productionId === 'capitalization') return null;
    if (this.unitTypes[productionId]) return 'unit';
    if (this.buildingTypes[productionId]) return 'building';
    return null;
  }
}

function normalizeRallyPoint(value: unknown): CityRallyPoint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const point = value as Partial<CityRallyPoint>;
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) return undefined;
  return { x: point.x as number, y: point.y as number, persistent: Boolean(point.persistent) };
}
