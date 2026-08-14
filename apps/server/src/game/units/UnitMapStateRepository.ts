/**
 * @module server/game/units/UnitMapStateRepository
 * Defines Unit Map State Repository unit behavior and contracts.
 */
import type { DatabaseProvider } from '@database';
import { games } from '@database/schema';
import type { MapManager } from '@game/managers/MapManager';
import { eq, sql } from 'drizzle-orm';

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

  /**
   * Persist one changed tile without serializing and sending the whole map.
   * Freeciv saves changed tile state independently and sends PACKET_TILE_INFO
   * for the affected tile rather than rebuilding the complete map snapshot.
   *
   * @reference reference/freeciv/server/savegame/savegame3.c:2490-2600
   * @reference reference/freeciv/server/maphand.c:442-613
   */
  async persistTile(x: number, y: number): Promise<void> {
    const tile = this.mapManager?.getTile(x, y);
    if (!tile) return;
    const path = `{tiles,${x},${y}}`;
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({
        mapData: sql`jsonb_set(${games.mapData}, ${path}::text[], ${JSON.stringify(tile)}::jsonb, false)`,
      })
      .where(eq(games.id, this.gameId));
  }
}
