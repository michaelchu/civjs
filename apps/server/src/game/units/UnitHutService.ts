/**
 * @module server/game/units/UnitHutService
 * Defines Unit Hut Service unit behavior and contracts.
 */
import type { DatabaseProvider } from '@database';
import { players } from '@database/schema';
import { getTerrainMovementCost } from '@game/constants/MovementConstants';
import type { MapManager } from '@game/managers/MapManager';
import type { UnitManagerCallbacks } from '@game/managers/UnitManager';
import type { TerrainType } from '@game/map/MapTypes';
import { randomInt, type RandomSource } from '@game/random/FreecivRandom';
import type { UnitType } from '@game/services/RulesetUnitsService';
import { and, eq, sql } from 'drizzle-orm';
import type { Unit } from './UnitTypes';
import type { UnitMapStateRepository } from './UnitMapStateRepository';

export class UnitHutService {
  constructor(
    private readonly gameId: string,
    private readonly databaseProvider: DatabaseProvider,
    private readonly mapManager: MapManager | undefined,
    private readonly getUnitTypes: () => Record<string, UnitType>,
    private readonly random: RandomSource,
    private readonly callbacks: UnitManagerCallbacks | undefined,
    private readonly getTerrainAt: (x: number, y: number) => TerrainType,
    private readonly getPlayerTechs: (playerId: string) => Set<string>,
    private readonly createUnit: (
      playerId: string,
      unitTypeId: string,
      x: number,
      y: number,
      homeCityId?: string
    ) => Promise<Unit>,
    private readonly destroyUnit: (unitId: string) => Promise<void>,
    private readonly hasUnit: (unitId: string) => boolean,
    private readonly mapStateRepository: UnitMapStateRepository
  ) {}

  async resolveEnteredTile(unit: Unit): Promise<void> {
    const tile = this.mapManager?.getTile(unit.x, unit.y);
    if (!tile) return;
    let changed = false;
    const improvements = [...tile.improvements];
    const hutIndex = improvements.findIndex((extra: string) => extra.toLowerCase() === 'hut');
    if (hutIndex >= 0) {
      improvements.splice(hutIndex, 1);
      changed = true;
      const frightens =
        this.getUnitTypes()[unit.unitTypeId].rulesetUnitClassFlags.includes('HutFrighten');
      if (frightens) {
        this.broadcast(unit, 'Your overflight frightens the tribe; they scatter in terror.');
      } else {
        await this.resolveReward(unit);
      }
    }

    const conquerableExtras = improvements.filter(
      (extra: string) => !['pollution', 'fallout'].includes(extra.toLowerCase())
    );
    if (conquerableExtras.length > 0 && tile.claimer !== unit.playerId) {
      this.mapManager?.updateTileProperty(unit.x, unit.y, 'claimer', unit.playerId);
      changed = true;
    }
    if (changed) {
      this.mapManager?.updateTileProperty(unit.x, unit.y, 'improvements', improvements);
      await this.mapStateRepository.persist();
    }
  }

  async resolveReward(unit: Unit): Promise<void> {
    const chance = randomInt(this.random, 14);
    if (chance <= 4) return this.resolveGold(unit, chance);
    if (chance <= 7) return this.resolveTechnology(unit);
    if (chance <= 9) return this.resolveMercenary(unit);
    if (chance === 10) return this.resolveBarbarians(unit);
    if (chance === 11 && this.callbacks?.foundCity) return this.resolveSettlement(unit);
    return this.resolveMap(unit);
  }

  private async resolveGold(unit: Unit, chance: number): Promise<void> {
    const gold = chance === 0 ? 25 : chance <= 3 ? 50 : 100;
    await this.changePlayerGold(unit.playerId, gold);
    this.broadcast(unit, `Your unit found ${gold} gold in a goody hut.`);
  }

  private async resolveTechnology(unit: Unit): Promise<void> {
    const technology = await this.callbacks?.grantHutTechnology?.(unit.playerId);
    if (technology)
      return this.broadcast(
        unit,
        `Your unit discovered the technology ${technology} in a goody hut.`
      );
    await this.changePlayerGold(unit.playerId, 25);
    this.broadcast(unit, 'The goody hut had no new technology; your unit found 25 gold instead.');
  }

  private async resolveMercenary(unit: Unit): Promise<void> {
    const terrain = this.getTerrainAt(unit.x, unit.y);
    const techs = this.getPlayerTechs(unit.playerId);
    const canExist = (type: UnitType): boolean =>
      getTerrainMovementCost(terrain, type.id) >= 0 &&
      (!type.requiredTech ||
        [...techs].some(tech => tech.toLowerCase() === type.requiredTech!.toLowerCase()));
    const mercenary =
      Object.values(this.getUnitTypes()).find(
        type => type.roles?.includes('HutTech') && canExist(type)
      ) ??
      Object.values(this.getUnitTypes()).find(
        type => type.roles?.includes('Hut') && canExist(type)
      );
    if (mercenary) {
      await this.createUnit(unit.playerId, mercenary.id, unit.x, unit.y, unit.homeCityId);
      return this.broadcast(
        unit,
        `Your unit found a ${mercenary.name ?? mercenary.id} in a goody hut.`
      );
    }
    await this.changePlayerGold(unit.playerId, 25);
    this.broadcast(unit, 'No mercenary was available; your unit found 25 gold instead.');
  }

  private async resolveBarbarians(unit: Unit): Promise<void> {
    if (this.getUnitTypes()[unit.unitTypeId]?.rulesetUnitClassFlags.includes('GameLoss')) return;
    const alive = await this.callbacks?.spawnHutBarbarians?.(unit.playerId, unit.x, unit.y);
    if (alive === undefined) {
      await this.changePlayerGold(unit.playerId, 25);
      return this.broadcast(unit, 'The goody hut was quiet; your unit found 25 gold instead.');
    }
    if (!alive && this.hasUnit(unit.id)) {
      await this.destroyUnit(unit.id);
      return this.broadcast(unit, 'Barbarians emerged from the goody hut and destroyed your unit.');
    }
    this.broadcast(unit, 'Barbarians emerged from the goody hut.');
  }

  private async resolveSettlement(unit: Unit): Promise<void> {
    try {
      await this.callbacks!.foundCity(this.gameId, unit.playerId, 'Hut Settlement', unit.x, unit.y);
    } catch {
      const settlers = Object.values(this.getUnitTypes()).find(
        type =>
          (type.canFoundCity || type.rulesetUnitClassFlags.includes('Cities')) &&
          getTerrainMovementCost(this.getTerrainAt(unit.x, unit.y), type.id) >= 0
      );
      if (settlers) {
        await this.createUnit(unit.playerId, settlers.id, unit.x, unit.y, unit.homeCityId);
        return this.broadcast(unit, 'Your unit found nomad settlers in a goody hut.');
      }
      await this.changePlayerGold(unit.playerId, 25);
      this.broadcast(
        unit,
        'The goody hut could not provide settlers; your unit found 25 gold instead.'
      );
    }
  }

  private async resolveMap(unit: Unit): Promise<void> {
    const exploredTiles = this.callbacks?.revealHutMap?.(unit.playerId, unit.x, unit.y);
    if (!exploredTiles) {
      await this.changePlayerGold(unit.playerId, 25);
      return this.broadcast(
        unit,
        'The goody hut revealed nothing; your unit found 25 gold instead.'
      );
    }
    await this.databaseProvider
      .getDatabase()
      .update(players)
      .set({ exploredTiles })
      .where(and(eq(players.id, unit.playerId), eq(players.gameId, this.gameId)));
    this.broadcast(unit, 'Your unit discovered a map in a goody hut.');
  }

  private broadcast(unit: Unit, message: string): void {
    this.callbacks?.broadcastHutEvent?.(this.gameId, unit.playerId, message);
  }

  private async changePlayerGold(playerId: string, amount: number): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .update(players)
      .set({ gold: sql`${players.gold} + ${amount}` })
      .where(and(eq(players.id, playerId), eq(players.gameId, this.gameId)));
  }
}
