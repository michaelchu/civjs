import { createHash } from 'node:crypto';
import { GameReplayService, type GameReplay } from './GameReplayService';
import { gameStateCodec, type AuthoritativeGameState } from './GameStateCodec';

export const NATIVE_SAVE_FORMAT = 'civjs-native-save';
export const NATIVE_SAVE_VERSION = 1;

interface NativeSavePayload {
  format: typeof NATIVE_SAVE_FORMAT;
  version: typeof NATIVE_SAVE_VERSION;
  gameId: string;
  exportedAt: string;
  throughTurn: number;
  replay: GameReplay;
}

export interface NativeSaveArchive extends NativeSavePayload {
  checksum: string;
}

export interface LoadedNativeSave {
  archive: NativeSaveArchive;
  checkpoint: AuthoritativeGameState;
}

/**
 * Portable CivJS-native archive for replay and inspection tooling.
 * It deliberately does not parse or emit Freeciv savegames.
 */
export class NativeSaveService {
  constructor(private readonly replayService: GameReplayService) {}

  async export(gameId: string, throughTurn?: number): Promise<NativeSaveArchive | null> {
    const replay = await this.replayService.getReplay(gameId, throughTurn);
    if (!replay) return null;
    const completedTurns = replay.turns.filter(turn => turn.snapshot);
    const lastTurn = completedTurns.at(-1);
    if (!lastTurn) throw new Error('Cannot export a game without a completed checkpoint');

    const checkpoint = gameStateCodec.decode(lastTurn.snapshot);
    if (checkpoint.map === undefined) {
      throw new Error('Cannot export a checkpoint without authoritative map state');
    }
    const payload: NativeSavePayload = {
      format: NATIVE_SAVE_FORMAT,
      version: NATIVE_SAVE_VERSION,
      gameId,
      exportedAt: new Date().toISOString(),
      throughTurn: lastTurn.turn,
      replay: { ...replay, turns: replay.turns.filter(turn => turn.turn <= lastTurn.turn) },
    };
    return { ...payload, checksum: this.checksum(payload) };
  }

  load(input: unknown): LoadedNativeSave {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Invalid native save: expected an object');
    }
    const archive = input as NativeSaveArchive;
    if (archive.format !== NATIVE_SAVE_FORMAT || archive.version !== NATIVE_SAVE_VERSION) {
      throw new Error(
        `Unsupported native save format/version: ${String(archive.format)}@${String(archive.version)}`
      );
    }
    const { checksum, ...payload } = archive;
    if (typeof checksum !== 'string' || checksum !== this.checksum(payload)) {
      throw new Error('Invalid native save: checksum mismatch');
    }
    if (!archive.replay || archive.replay.gameId !== archive.gameId) {
      throw new Error('Invalid native save: replay identity mismatch');
    }
    const turn = archive.replay.turns.find(candidate => candidate.turn === archive.throughTurn);
    if (!turn?.snapshot) {
      throw new Error('Invalid native save: checkpoint is missing');
    }
    const checkpoint = gameStateCodec.decode(turn.snapshot);
    if (checkpoint.map === undefined) {
      throw new Error('Invalid native save: authoritative map state is missing');
    }
    if (checkpoint.turn !== archive.throughTurn) {
      throw new Error('Invalid native save: checkpoint turn mismatch');
    }
    return { archive, checkpoint };
  }

  private checksum(payload: NativeSavePayload): string {
    return createHash('sha256').update(this.canonicalJson(payload)).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) return `[${value.map(item => this.canonicalJson(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries
        .map(([key, item]) => `${JSON.stringify(key)}:${this.canonicalJson(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }
}
