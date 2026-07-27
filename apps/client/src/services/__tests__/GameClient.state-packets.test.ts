import { beforeEach, describe, expect, it } from 'vitest';
import { gameClient } from '../GameClient';
import { useGameStore } from '../../store/gameStore';
import { PacketType, type Packet } from '../../types/packets';

const handlePacket = (packet: Packet) =>
  (
    gameClient as unknown as {
      handlePacket: (incoming: Packet) => void;
    }
  ).handlePacket(packet);

describe('GameClient state-bearing packets', () => {
  beforeEach(() => {
    useGameStore.getState().updateGameState({
      turn: 0,
      year: undefined,
      players: {},
      cities: {},
      map: { width: 0, height: 0, tiles: {} },
    });
    useGameStore.setState({ notifications: [] });
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
        science: 12,
        government: 'republic',
        alive: true,
      },
    });
    handlePacket({ type: PacketType.NEW_YEAR, data: { turn: 5, year: -3840 } });
    handlePacket({
      type: PacketType.CITY_INFO,
      data: { id: 'city-1', name: 'Rome', playerId: 'player-1' },
    });
    handlePacket({ type: PacketType.FREEZE_CLIENT, data: {} });

    expect(useGameStore.getState().players['player-1']).toEqual(
      expect.objectContaining({ name: 'Caesar', government: 'republic', gold: 75 })
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
        known: 1,
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
      })
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
});
