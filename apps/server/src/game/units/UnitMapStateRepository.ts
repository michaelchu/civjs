/**
 * @module server/game/units/UnitMapStateRepository
 * Defines Unit Map State Repository unit behavior and contracts.
 */
import type { DatabaseProvider } from '@database';
import { games } from '@database/schema';
import type { MapManager } from '@game/managers/MapManager';
import { eq } from 'drizzle-orm';

export class UnitMapStateRepository {
  constructor(
    private readonly gameId: string,
    private readonly databaseProvider: DatabaseProvider,
    private readonly mapManager: MapManager | undefined,
    private readonly onMapChanged?: (gameId: string, mapData: unknown) => void
  ) {}

  async persist(): Promise<void> {
    const mapData = this.mapManager?.getMapData();
    if (!mapData) return;
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({ mapData })
      .where(eq(games.id, this.gameId));
    this.onMapChanged?.(this.gameId, mapData);
  }
}
