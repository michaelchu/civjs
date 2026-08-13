import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameClient } from '../GameClient';
import { useGameStore } from '../../store/gameStore';
import { PacketType } from '../../types/packets';

const socket = {
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

describe('GameClient management screens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socket.emit.mockReset();
    (gameClient as unknown as { socket: typeof socket }).socket = socket;
    useGameStore.getState().updateGameState({
      currentPlayerId: 'player-1',
      players: {
        'player-1': {
          id: 'player-1',
          name: 'Leader',
          nation: 'roman',
          color: '#fff',
          gold: 50,
          science: 0,
          history: 0,
          government: 'despotism',
          isHuman: true,
          isActive: true,
        },
      },
      governments: {},
    });
  });

  it('clears a previous player identity when switching to observer mode', async () => {
    socket.emit.mockImplementation(
      (event: string, _data: unknown, callback: (value: unknown) => void) => {
        expect(event).toBe('observe_game');
        callback({ success: true, role: 'spectator' });
      }
    );

    await gameClient.observeGame('game-2');

    expect(useGameStore.getState().currentPlayerId).toBe('');
  });

  it('sends chat messages through the canonical packet envelope', () => {
    gameClient.sendChatMessage('  Hello world  ');

    expect(socket.emit).toHaveBeenCalledWith(
      'packet',
      expect.objectContaining({
        type: PacketType.CHAT_MSG_REQ,
        data: { message: 'Hello world', channel: 'all' },
      })
    );
  });

  it('hydrates authoritative government definitions and starts a revolution', async () => {
    socket.emit.mockImplementation(
      (event: string, _data: unknown, callback: (value: unknown) => void) => {
        const state = {
          governments: {
            anarchy: {
              id: 'anarchy',
              name: 'Anarchy',
              graphic: '',
              graphic_alt: '',
              sound: '',
              sound_alt: '',
              sound_alt2: '',
              ruler_male_title: '%s',
              ruler_female_title: '%s',
              helptext: 'No government',
            },
          },
          currentGovernment: 'anarchy',
          revolutionTurns: 2,
          requestedGovernment: 'monarchy',
          availableGovernments: [],
        };
        expect(event).toBe('government:startRevolution');
        callback({ success: true, message: 'Revolution started', state });
      }
    );

    await expect(gameClient.startRevolution('monarchy')).resolves.toBe('Revolution started');

    const store = useGameStore.getState();
    expect(store.players['player-1']).toEqual(
      expect.objectContaining({ government: 'anarchy', revolutionTurns: 2 })
    );
    expect(store.governments.anarchy?.name).toBe('Anarchy');
  });

  it('loads and saves authoritative tax rates', async () => {
    socket.emit
      .mockImplementationOnce(
        (_event: string, _data: unknown, callback: (value: unknown) => void) =>
          callback({ success: true, rates: { tax: 50, luxury: 20, science: 30 } })
      )
      .mockImplementationOnce(
        (_event: string, _data: unknown, callback: (value: unknown) => void) =>
          callback({ success: true, rates: { tax: 40, luxury: 10, science: 50 } })
      );

    await expect(gameClient.getTaxRates()).resolves.toEqual({
      tax: 50,
      luxury: 20,
      science: 30,
    });
    await expect(gameClient.setTaxRates({ tax: 40, luxury: 10, science: 50 })).resolves.toEqual({
      tax: 40,
      luxury: 10,
      science: 50,
    });
  });

  it('sends authoritative diplomacy requests with idempotency IDs', () => {
    gameClient.requestDiplomacy();
    gameClient.proposeTreaty('player-2', ['peace', 'embassy']);
    gameClient.respondToTreaty('player-2', 'proposal-1', true);
    gameClient.cancelDiplomaticPact('player-2');
    gameClient.cancelSharedVision('player-2');

    expect(socket.emit).toHaveBeenNthCalledWith(
      1,
      'packet',
      expect.objectContaining({ type: PacketType.DIPLOMACY_LIST_REQ })
    );
    expect(socket.emit).toHaveBeenNthCalledWith(
      2,
      'packet',
      expect.objectContaining({
        type: PacketType.DIPLOMACY_TREATY_PROPOSE,
        data: expect.objectContaining({
          recipientId: 'player-2',
          requestId: expect.any(String),
          clauses: [{ type: 'peace' }, { type: 'embassy' }],
        }),
      })
    );
    expect(socket.emit).toHaveBeenNthCalledWith(
      4,
      'packet',
      expect.objectContaining({
        type: PacketType.DIPLOMACY_PACT_CANCEL,
        data: { otherPlayerId: 'player-2' },
      })
    );
    expect(socket.emit).toHaveBeenNthCalledWith(
      5,
      'packet',
      expect.objectContaining({
        type: PacketType.DIPLOMACY_VISION_CANCEL,
        data: { otherPlayerId: 'player-2' },
      })
    );
    expect(socket.emit).toHaveBeenNthCalledWith(
      3,
      'packet',
      expect.objectContaining({
        type: PacketType.DIPLOMACY_TREATY_RESPONSE,
        data: { otherPlayerId: 'player-2', proposalId: 'proposal-1', accept: true },
      })
    );
  });

  it('loads and updates host turn controls', async () => {
    socket.emit
      .mockImplementationOnce(
        (_event: string, _data: unknown, callback: (value: unknown) => void) =>
          callback({ success: true, isHost: true, paused: false, turnTimeLimit: 90 })
      )
      .mockImplementationOnce(
        (_event: string, _data: unknown, callback: (value: unknown) => void) =>
          callback({ success: true })
      )
      .mockImplementationOnce(
        (_event: string, _data: unknown, callback: (value: unknown) => void) =>
          callback({ success: true })
      )
      .mockImplementationOnce(
        (_event: string, _data: unknown, callback: (value: unknown) => void) =>
          callback({ success: true })
      );

    await expect(gameClient.getHostControls()).resolves.toMatchObject({
      isHost: true,
      turnTimeLimit: 90,
    });
    await expect(gameClient.setGamePaused(true)).resolves.toBeUndefined();
    await expect(gameClient.setTurnTimeLimit(120)).resolves.toBeUndefined();
    await expect(
      gameClient.setPlayerAIControl('player-2', true, { aiLevel: 'hard' })
    ).resolves.toBeUndefined();
    expect(socket.emit.mock.calls.map(call => call[0])).toEqual([
      'host:getControls',
      'host:setPaused',
      'host:setTurnTimeLimit',
      'host:setPlayerAIControl',
    ]);
    expect(socket.emit).toHaveBeenLastCalledWith(
      'host:setPlayerAIControl',
      { playerId: 'player-2', isAI: true, aiLevel: 'hard' },
      expect.any(Function)
    );
  });

  it('loads the shared native advisor recommendations', async () => {
    const recommendations = {
      playerId: 'player-1',
      turn: 5,
      economy: {
        reserve: 30,
        rates: { tax: 40, luxury: 0, science: 60 },
        rushCityIds: [],
        saleCandidates: [],
      },
      research: [],
      cities: [],
      workers: [],
      exploration: [],
      military: [],
    };
    socket.emit.mockImplementation(
      (event: string, data: unknown, callback: (value: unknown) => void) => {
        expect(event).toBe('advisor:getRecommendations');
        expect(data).toEqual({});
        callback({ success: true, recommendations });
      }
    );

    await expect(gameClient.getAdvisorRecommendations()).resolves.toEqual(recommendations);
  });

  it('sends city worklist and citizen-management mutations', async () => {
    socket.emit.mockImplementation(
      (_event: string, _data: unknown, callback: (value: unknown) => void) =>
        callback({ success: true })
    );

    await gameClient.addCityWorklistItem('city-1', 'granary', 'building');
    await gameClient.reorderCityWorklist('city-1', 1, 0);
    await gameClient.convertCityWorkerToSpecialist('city-1', 4, 5, 0);
    await gameClient.convertCitySpecialistToTile('city-1', 0, 6, 5);
    await gameClient.renameCity('city-1', 'Roma');
    await gameClient.disbandCity('city-2');

    expect(socket.emit.mock.calls.map(call => call[0])).toEqual([
      'city:addWorklist',
      'city:reorderWorklist',
      'city:workerToSpecialist',
      'city:specialistToTile',
      'city:rename',
      'city:disband',
    ]);
    expect(socket.emit).toHaveBeenNthCalledWith(
      1,
      'city:addWorklist',
      {
        cityId: 'city-1',
        items: [{ productionId: 'granary', type: 'building' }],
      },
      expect.any(Function)
    );
  });

  it('sends one authoritative batch city request and returns partial results', async () => {
    socket.emit.mockImplementation(
      (event: string, data: unknown, callback: (value: unknown) => void) => {
        expect(event).toBe('city:batchManage');
        expect(data).toEqual({
          cityIds: ['city-1', 'city-2'],
          action: 'production',
          productionId: 'granary',
          productionType: 'building',
        });
        callback({
          success: false,
          succeeded: [{ cityId: 'city-1' }],
          failed: [{ cityId: 'city-2', reason: 'Production unavailable' }],
        });
      }
    );

    await expect(
      gameClient.batchManageCities(['city-1', 'city-2'], {
        action: 'production',
        productionId: 'granary',
        productionType: 'building',
      })
    ).resolves.toEqual({
      success: false,
      succeeded: [{ cityId: 'city-1' }],
      failed: [{ cityId: 'city-2', reason: 'Production unavailable' }],
    });
  });
});
