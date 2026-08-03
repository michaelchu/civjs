import { GameManager } from '@game/managers/GameManager';
import { autoPlaceSpaceship } from '@game/services/SpaceshipService';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('GameManager spaceship lifecycle', () => {
  const io = { to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() } as any;
  let manager: GameManager;
  let database: any;
  let broadcastPlayerInfo: jest.Mock;

  const makeGame = ({
    player,
    victoryConditions = ['science'],
  }: {
    player: any;
    victoryConditions?: string[];
  }) => ({
    config: { victoryConditions },
    players: new Map([[player.id, player]]),
    cityManager: {
      hasPrimaryCapital: jest.fn(() => true),
      getCitiesByPlayer: jest.fn(() => [
        { id: 'capital', playerId: player.id, isCapital: true, buildings: ['palace'] },
      ]),
    },
    turnManager: {
      getCurrentTurn: jest.fn(() => 123),
      getCurrentYear: jest.fn(() => 2000),
    },
  });

  beforeEach(() => {
    (GameManager as any).instance = null;
    const provider = createMockDatabaseProvider();
    database = provider.getDatabase() as any;
    manager = GameManager.getInstance(io, provider);
    broadcastPlayerInfo = jest.fn();
    (manager as any).gameBroadcastManager = { broadcastPlayerInfo };
  });

  afterEach(() => manager.clearAllGames());

  it('persists an authenticated player placement and manual launch', async () => {
    const player = { id: 'player', spaceshipState: { structurals: 2 } };
    const game = makeGame({ player });
    (manager as any).games.set('game', game);

    await expect(
      manager.placeSpaceshipPart('game', 'player', { kind: 'structural', index: 0 })
    ).resolves.toMatchObject({ success: true, state: { placedStructurals: [0] } });

    player.spaceshipState = autoPlaceSpaceship({ structurals: 8, components: 2, modules: 3 });
    await expect(manager.launchSpaceship('game', 'player')).resolves.toMatchObject({
      success: true,
      state: expect.objectContaining({ status: 'launched', launchYear: 2000, launchedTurn: 123 }),
    });
    expect(database.update).toHaveBeenCalled();
    expect(broadcastPlayerInfo).toHaveBeenCalledTimes(2);
  });

  it('autoplaces all players at the next turn boundary without launching a human ship', async () => {
    const player = {
      id: 'player',
      spaceshipState: { structurals: 8, components: 2, modules: 3 },
    };
    const game = makeGame({ player });

    await (manager as any).autoPlaceSpaceshipParts(game);

    expect(player.spaceshipState).toMatchObject({
      status: 'started',
      placedStructurals: [0, 1, 2, 4, 6, 8, 10, 12],
      successRate: 100,
    });
    expect(player.spaceshipState).not.toHaveProperty('launchYear');
  });

  it('lets the default AI launch only a fully built ship when space-race victory is enabled', async () => {
    const player = {
      id: 'ai',
      isAI: true,
      spaceshipState: { structurals: 32, components: 16, modules: 12 },
    };
    const game = makeGame({ player });

    await expect((manager as any).manageAISpaceships(game)).resolves.toBe(1);
    expect(player.spaceshipState).toMatchObject({ status: 'launched', launchYear: 2000 });

    player.spaceshipState = { structurals: 32, components: 16, modules: 12 };
    await expect(
      (manager as any).manageAISpaceships(makeGame({ player, victoryConditions: ['conquest'] }))
    ).resolves.toBe(0);
    expect(player.spaceshipState).not.toHaveProperty('launchYear');
  });
});
