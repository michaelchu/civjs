import { GameManager } from '@game/managers/GameManager';
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
});
