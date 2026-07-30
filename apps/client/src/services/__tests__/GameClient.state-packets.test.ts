import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameClient } from '../GameClient';
import { useGameStore } from '../../store/gameStore';
import { PacketType, type Packet } from '../../types/packets';

const handlePacket = (packet: Packet) =>
  (
    gameClient as unknown as {
      handlePacket: (incoming: Packet) => void;
    }
  ).handlePacket(packet);
const applyCultureUpdate = (data: {
  players: Record<string, { history: number; totalCulture: number }>;
}) =>
  (
    gameClient as unknown as {
      applyCultureUpdate: (incoming: typeof data) => void;
    }
  ).applyCultureUpdate(data);

describe('GameClient state-bearing packets', () => {
  beforeEach(() => {
    useGameStore.getState().updateGameState({
      turn: 0,
      year: undefined,
      players: {},
      cities: {},
      map: { width: 0, height: 0, tiles: {} },
    });
    useGameStore.setState({ notifications: [], hasReceivedUnitSnapshot: false });
    useGameStore.setState({ clientState: 'running', endGameReport: undefined });
  });

  it('applies player, calendar, city, and turn-processing packets', () => {
    handlePacket({
      type: PacketType.PLAYER_INFO,
      data: {
        id: 'player-1',
        name: 'Caesar',
        nation: 'roman',
        color: { r: 255, g: 0, b: 0 },
        gold: 75,
        goldPerTurn: -2,
        science: 12,
        sciencePerTurn: 4,
        taxRate: 40,
        luxuryRate: 10,
        scienceRate: 50,
        score: 275,
        teamId: 'team-1',
        spaceshipState: { structurals: 2 },
        culture: 34,
        government: 'republic',
        alive: true,
        isAI: true,
      },
    });
    handlePacket({ type: PacketType.NEW_YEAR, data: { turn: 5, year: -3840 } });
    handlePacket({
      type: PacketType.CITY_INFO,
      data: { id: 'city-1', name: 'Rome', playerId: 'player-1' },
    });
    handlePacket({ type: PacketType.FREEZE_CLIENT, data: {} });

    expect(useGameStore.getState().players['player-1']).toEqual(
      expect.objectContaining({
        name: 'Caesar',
        government: 'republic',
        gold: 75,
        goldPerTurn: -2,
        science: 12,
        sciencePerTurn: 4,
        history: 0,
        culture: 34,
        color: '#ff0000',
        isHuman: false,
        taxRate: 40,
        luxuryRate: 10,
        scienceRate: 50,
        score: 275,
        teamId: 'team-1',
        spaceshipState: { structurals: 2 },
      })
    );
    expect(useGameStore.getState()).toEqual(expect.objectContaining({ turn: 5, year: -3840 }));
    expect(useGameStore.getState().cities['city-1']).toEqual(
      expect.objectContaining({ name: 'Rome' })
    );
    expect(useGameStore.getState().turnProcessingState).toBe('processing');

    handlePacket({ type: PacketType.THAW_CLIENT, data: {} });
    expect(useGameStore.getState().turnProcessingState).toBe('idle');
  });

  it('applies map, visibility, extras, and border ownership packets', () => {
    handlePacket({
      type: PacketType.MAP_INFO,
      data: { xsize: 2, ysize: 1, wrap_id: 0 },
    });
    handlePacket({
      type: PacketType.TILE_INFO,
      data: {
        tile: 0,
        x: 0,
        y: 0,
        terrain: 'grassland',
        known: 2,
        seen: 1,
        improvements: ['road', 'irrigation'],
        owner: 'player-1',
      },
    });
    handlePacket({
      type: PacketType.BORDER_UPDATE,
      data: { tiles: [{ x: 0, y: 0, owner: 'player-2' }] },
    });

    expect(useGameStore.getState().map).toEqual(expect.objectContaining({ width: 2, height: 1 }));
    expect(useGameStore.getState().map.tiles['0,0']).toEqual(
      expect.objectContaining({
        terrain: 'grassland',
        improvements: ['road', 'irrigation'],
        owner: 'player-2',
        visible: true,
        known: true,
      })
    );
  });

  it('preserves HUD-relevant unit metadata during normalization', () => {
    handlePacket({
      type: PacketType.UNIT_INFO,
      data: {
        units: [
          {
            id: 'unit-1',
            owner: 'player-1',
            type: 'warriors',
            x: 2,
            y: 3,
            hp: 80,
            movesleft: 2,
            maxmoves: 3,
            veteran: 1,
            homeCity: 'city-1',
            nationality: 'roman',
            upkeep: [0, 1, 2],
            activityTarget: 'road',
            occupied: true,
            paradropped: false,
            doneMoving: true,
            stay: true,
            facing: 4,
            birthTurn: 7,
          },
        ],
      },
    });

    expect(useGameStore.getState().units['unit-1']).toEqual(
      expect.objectContaining({
        homeCityId: 'city-1',
        nationality: 'roman',
        upkeep: { food: 0, shields: 1, gold: 2 },
        activityTarget: 'road',
        occupied: true,
        doneMoving: true,
        stay: true,
        facing: 4,
        birthTurn: 7,
      })
    );
  });

  it('maps Freeciv fog states and replaces stale units with full visibility snapshots', () => {
    handlePacket({
      type: PacketType.MAP_INFO,
      data: { xsize: 2, ysize: 1, wrap_id: 0 },
    });
    handlePacket({
      type: PacketType.TILE_INFO,
      data: {
        tiles: [
          { tile: 0, x: 0, y: 0, terrain: 'plains', known: 1, seen: 0 },
          { tile: 1, x: 1, y: 0, terrain: 'unknown', known: 0, seen: 0 },
        ],
        startIndex: 0,
        endIndex: 2,
        total: 2,
      },
    });
    useGameStore.getState().updateGameState({
      units: {
        stale: {
          id: 'stale',
          playerId: 'enemy',
          unitTypeId: 'warriors',
          x: 1,
          y: 0,
          hp: 100,
          movesLeft: 1,
          veteranLevel: 0,
        },
      },
    });
    handlePacket({
      type: PacketType.UNIT_INFO,
      data: { units: [], fullSnapshot: true },
    });

    expect(useGameStore.getState().map.tiles['0,0']).toEqual(
      expect.objectContaining({ known: true, visible: false })
    );
    expect(useGameStore.getState().map.tiles['1,0']).toEqual(
      expect.objectContaining({ known: false, visible: false })
    );
    expect(useGameStore.getState().units).toEqual({});
    expect(useGameStore.getState().hasReceivedUnitSnapshot).toBe(true);
  });

  it('resets unit snapshot readiness when a new map snapshot begins', () => {
    useGameStore.setState({ hasReceivedUnitSnapshot: true });

    handlePacket({
      type: PacketType.MAP_INFO,
      data: { xsize: 2, ysize: 1, wrap_id: 0 },
    });

    expect(useGameStore.getState().hasReceivedUnitSnapshot).toBe(false);
  });

  it('does not synthesize resize events after a recovered map snapshot', () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');

    handlePacket({
      type: PacketType.MAP_INFO,
      data: { xsize: 1, ysize: 1, wrap_id: 0 },
    });
    handlePacket({
      type: PacketType.TILE_INFO,
      data: {
        tiles: [{ tile: 0, x: 0, y: 0, terrain: 'plains', known: 2, seen: 1 }],
        startIndex: 0,
        endIndex: 1,
        total: 1,
      },
    });
    vi.runAllTimers();

    expect(dispatchEvent.mock.calls.some(([event]) => event.type === 'resize')).toBe(false);
    dispatchEvent.mockRestore();
    vi.useRealTimers();
  });

  it('commits a recovered map only after the final tile batch', () => {
    handlePacket({
      type: PacketType.MAP_INFO,
      data: { xsize: 2, ysize: 1, wrap_id: 0 },
    });
    handlePacket({
      type: PacketType.TILE_INFO,
      data: {
        tiles: [{ tile: 0, x: 0, y: 0, terrain: 'plains', known: 2, seen: 1 }],
        startIndex: 0,
        endIndex: 1,
        total: 2,
      },
    });

    expect(useGameStore.getState().map.tiles).toEqual({});

    handlePacket({
      type: PacketType.TILE_INFO,
      data: {
        tiles: [{ tile: 1, x: 1, y: 0, terrain: 'ocean', known: 2, seen: 1 }],
        startIndex: 1,
        endIndex: 2,
        total: 2,
      },
    });

    expect(useGameStore.getState().map.tiles).toEqual({
      '0,0': expect.objectContaining({ terrain: 'plains' }),
      '1,0': expect.objectContaining({ terrain: 'ocean' }),
    });
  });

  it('applies authoritative culture updates to existing players', () => {
    handlePacket({
      type: PacketType.PLAYER_INFO,
      data: {
        id: 'player-1',
        name: 'Caesar',
        nation: 'roman',
        color: { r: 255, g: 0, b: 0 },
        gold: 75,
        science: 12,
        culture: 0,
        government: 'republic',
        alive: true,
      },
    });

    applyCultureUpdate({
      players: { 'player-1': { history: 21, totalCulture: 34 } },
    });

    expect(useGameStore.getState().players['player-1']).toEqual(
      expect.objectContaining({ history: 21, culture: 34 })
    );
  });

  it('turns server and territory messages into visible notifications', () => {
    handlePacket({
      type: PacketType.CONNECT_MSG,
      data: { type: 'error', message: 'Connection interrupted' },
    });
    handlePacket({
      type: PacketType.CHAT_MSG,
      data: { type: 'chat', message: 'Ready?' },
    });
    handlePacket({
      type: PacketType.BORDER_CHANGE_NOTIFICATION,
      data: { playerId: 'player-1', tilesGained: [{ x: 1, y: 1 }], tilesLost: [] },
    });

    expect(useGameStore.getState().notifications.map(notification => notification.message)).toEqual(
      ['Connection interrupted', 'Ready?', '1 territory tiles gained']
    );
  });

  it('hydrates diplomacy snapshots and reports rejected diplomacy actions', () => {
    handlePacket({
      type: PacketType.DIPLOMACY_LIST_REPLY,
      data: {
        success: true,
        playerId: 'player-1',
        nations: [
          {
            id: 'player-2',
            civilization: 'greek',
            leaderName: 'Pericles',
            isAlive: true,
            isAI: false,
            known: true,
            relation: {
              state: 'peace',
              sinceTurn: 3,
              embassy: true,
              sharedVision: false,
            },
          },
        ],
      },
    });
    expect(useGameStore.getState().diplomacy?.nations[0]).toEqual(
      expect.objectContaining({
        id: 'player-2',
        relation: expect.objectContaining({ state: 'peace', embassy: true }),
      })
    );

    handlePacket({
      type: PacketType.DIPLOMACY_UPDATE,
      data: { success: false, message: 'Treaty proposal not found' },
    });
    expect(useGameStore.getState().notifications.at(-1)?.message).toBe('Treaty proposal not found');
  });

  it('moves to the accessible end-game flow when the final report arrives', () => {
    handlePacket({
      type: PacketType.ENDGAME_REPORT,
      data: {
        version: 1,
        gameId: 'game-1',
        turn: 42,
        year: -2320,
        reason: 'conquest',
        winnerPlayerId: 'player-1',
        winnerPlayerIds: ['player-1'],
        endedAt: '2026-07-26T12:00:00.000Z',
        standings: [
          {
            playerId: 'player-1',
            civilization: 'Roman',
            score: 400,
            cities: 2,
            population: 8,
            units: 1,
            technologies: 2,
            history: 0,
            alive: true,
          },
        ],
      },
    });

    expect(useGameStore.getState().clientState).toBe('over');
    expect(useGameStore.getState().endGameReport?.winnerPlayerId).toBe('player-1');
  });
});
