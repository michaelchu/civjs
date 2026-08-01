export const CURRENT_GAME_STATE_VERSION = 2;

export interface AuthoritativeGameState {
  version: typeof CURRENT_GAME_STATE_VERSION;
  turn: number;
  year: number;
  calendar: unknown;
  cities: unknown[];
  units: unknown[];
  research: Record<string, unknown>;
  diplomacy?: unknown;
  aiDiplomacy?: unknown;
  map?: unknown;
  [key: string]: unknown;
}

type SnapshotMigration = (snapshot: Record<string, unknown>) => Record<string, unknown>;

/**
 * Central version boundary for replay checkpoints and native save archives.
 * New snapshot versions must add an explicit migration instead of scattering
 * version checks through recovery code.
 */
export class GameStateCodec {
  private readonly migrations = new Map<number, SnapshotMigration>();

  registerMigration(fromVersion: number, migration: SnapshotMigration): void {
    if (!Number.isInteger(fromVersion) || fromVersion < 1) {
      throw new Error(`Invalid game-state migration version: ${fromVersion}`);
    }
    this.migrations.set(fromVersion, migration);
  }

  decode(input: unknown): AuthoritativeGameState {
    const snapshot = this.migrateSnapshot(this.assertObject(input));
    this.assertDecodedState(snapshot);
    return snapshot as unknown as AuthoritativeGameState;
  }

  private assertObject(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid game-state snapshot: expected an object');
    return input as Record<string, unknown>;
  }

  private migrateSnapshot(initial: Record<string, unknown>): Record<string, unknown> {
    let snapshot = { ...initial };
    let version = this.readVersion(snapshot);
    const visited = new Set<number>();
    while (version !== CURRENT_GAME_STATE_VERSION) {
      if (version > CURRENT_GAME_STATE_VERSION || visited.has(version))
        throw new Error(`Unsupported game-state snapshot version: ${version}`);
      const migration = this.migrations.get(version);
      if (!migration) throw new Error(`Unsupported game-state snapshot version: ${version}`);
      visited.add(version);
      snapshot = migration(snapshot);
      version = this.readVersion(snapshot);
    }
    return snapshot;
  }

  private assertDecodedState(snapshot: Record<string, unknown>): void {
    if (!Number.isInteger(snapshot.turn) || (snapshot.turn as number) < 0)
      throw new Error('Invalid game-state snapshot: turn must be a non-negative integer');
    if (!Number.isInteger(snapshot.year))
      throw new Error('Invalid game-state snapshot: year must be an integer');
    if (!Array.isArray(snapshot.cities) || !Array.isArray(snapshot.units))
      throw new Error('Invalid game-state snapshot: cities and units must be arrays');
    if (
      !snapshot.research ||
      typeof snapshot.research !== 'object' ||
      Array.isArray(snapshot.research)
    )
      throw new Error('Invalid game-state snapshot: research must be an object');
  }

  private readVersion(snapshot: Record<string, unknown>): number {
    if (!Number.isInteger(snapshot.version)) {
      throw new Error('Invalid game-state snapshot: version is missing');
    }
    return snapshot.version as number;
  }
}

export const gameStateCodec = new GameStateCodec();
