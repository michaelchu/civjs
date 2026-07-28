import { TurnPhase, TurnPhaseService } from '@game/services/TurnPhaseService';

describe('TurnPhaseService recovery checkpoints', () => {
  it('skips phase implementations that already have durable successful checkpoints', async () => {
    const processing = { resetPlayerUnitMovement: jest.fn() };
    const coordination = {};
    const packets = {
      sendProcessingStepPacket: jest.fn(),
      sendFreezeClientPacket: jest.fn(),
      sendTurnProcessingError: jest.fn(),
    };
    const events = {
      registerEventHandler: jest.fn(),
      emitEvent: jest.fn(),
      processQueuedEvents: jest
        .fn()
        .mockResolvedValue({ eventsProcessed: 0, achievementsUnlocked: 0 }),
    };
    const service = new TurnPhaseService(
      'game-1',
      processing as any,
      coordination as any,
      packets as any,
      events as any
    );
    (service as any).getOrCreatePhaseRecord = jest.fn(async (phase: TurnPhase) => ({
      id: phase,
      completed: {
        phase,
        success: true,
        duration: 1,
        playersProcessed: 1,
        itemsProcessed: 0,
        errors: [],
      },
    }));

    const result = await service.executePhaseProcessing(3, -3920, ['player-1']);

    expect(result.success).toBe(true);
    expect(result.phases).toHaveLength(11);
    expect(processing.resetPlayerUnitMovement).not.toHaveBeenCalled();
    expect(packets.sendProcessingStepPacket).not.toHaveBeenCalled();
  });
});
