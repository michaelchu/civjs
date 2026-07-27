import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameClient } from '../GameClient';
import { useGameStore } from '../../store/gameStore';

const socket = {
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

describe('GameClient management screens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
