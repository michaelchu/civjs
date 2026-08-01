import { GameManager } from '@game/managers/GameManager';
import { games } from '@database/schema';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';
import { createMockSocketServer } from '../utils/gameTestUtils';

describe('headless simulation lifecycle', () => {
  beforeEach(() => {
    (GameManager as any).instance = null;
  });

  it('starts through the normal lifecycle with timers disabled', async () => {
    const manager = GameManager.getInstance(
      createMockSocketServer() as any,
      createMockDatabaseProvider()
    );
    const lifecycle = (manager as any).gameLifecycleManager;
    const startGame = jest.spyOn(lifecycle, 'startGame').mockResolvedValue(undefined);
    const configure = jest
      .spyOn(manager as any, 'configureMultiplayerInstance')
      .mockResolvedValue(undefined);

    await manager.startHeadlessGame('simulation-id', 'headless-host');

    expect(startGame).toHaveBeenCalledWith('simulation-id', 'headless-host');
    expect(configure).toHaveBeenCalledWith('simulation-id', { startTurnTimer: false });
  });

  it('durably pauses an active recovered headless game without starting a timer', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const manager = GameManager.getInstance(createMockSocketServer() as any, databaseProvider);
    const clearTurnTimer = jest.fn();
    const recovered = {
      config: { executionMode: 'headless' },
      state: 'active',
      turnManager: { clearTurnTimer },
    } as any;
    jest
      .spyOn((manager as any).gameInstanceRecoveryService, 'recoverGameInstance')
      .mockResolvedValue(recovered);
    const configure = jest
      .spyOn(manager as any, 'configureMultiplayerInstance')
      .mockResolvedValue(undefined);

    await manager.recoverGameInstance('simulation-id');

    const database = databaseProvider.getDatabase() as any;
    expect(recovered.state).toBe('paused');
    expect(clearTurnTimer).toHaveBeenCalled();
    expect(database.update).toHaveBeenCalledWith(games);
    expect(database.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'paused' }));
    expect(database.where).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledWith('simulation-id', { startTurnTimer: false });
  });
});
