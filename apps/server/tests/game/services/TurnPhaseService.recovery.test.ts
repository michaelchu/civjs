import { TurnPhase, TurnPhaseService } from '@game/services/TurnPhaseService';
import { FreecivRandom } from '@game/random/FreecivRandom';
import { FreecivIdentityAllocator } from '@game/random/FreecivIdentityAllocator';

describe('TurnPhaseService recovery checkpoints', () => {
  it('runs shared human autoworkers after AI decisions in the end-turn decision phase', async () => {
    const order: string[] = [];
    const service = new TurnPhaseService(
      'game-1',
      {} as any,
      {} as any,
      {} as any,
      { registerEventHandler: jest.fn() } as any
    );
    service.setAIProcessor(async () => {
      order.push('ai');
      return 2;
    });
    service.setWorkerAutomationProcessor(async () => {
      order.push('workers');
      return 3;
    });
    const result = {
      phase: TurnPhase.PHASE_AI_ACTIONS,
      success: true,
      duration: 0,
      playersProcessed: 0,
      itemsProcessed: 0,
      errors: [],
    };

    await (service as any).executeAIActionsPhase(
      { gameId: 'game-1', playerIds: ['player-1'] },
      result
    );

    expect(order).toEqual(['ai', 'workers']);
    expect(result).toMatchObject({
      itemsProcessed: 5,
      data: { aiActions: 2, workerActions: 3 },
    });
    expect(Object.values(TurnPhase).indexOf(TurnPhase.PHASE_UNIT_ACTIVITIES)).toBeLessThan(
      Object.values(TurnPhase).indexOf(TurnPhase.PHASE_AI_ACTIONS)
    );
  });

  it('skips phase implementations that already have durable successful checkpoints', async () => {
    const processing = { resetPlayerUnitMovement: jest.fn() };
    const coordination = {};
    const packets = {
      sendProcessingStepPacket: jest.fn(),
      sendFreezeClientPacket: jest.fn(),
      sendTurnProcessingError: jest.fn(),
      sendThawClientPacket: jest.fn(),
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

  it('restores the shared Freeciv stream from each skipped durable phase', async () => {
    const random = new FreecivRandom(77);
    const identities = new FreecivIdentityAllocator();
    const checkpointSource = new FreecivRandom(77);
    const checkpoints = new Map<TurnPhase, ReturnType<FreecivRandom['getState']>>();
    for (const phase of Object.values(TurnPhase)) {
      checkpointSource.next(100);
      checkpoints.set(phase, checkpointSource.getState());
    }
    const events = {
      registerEventHandler: jest.fn(),
      emitEvent: jest.fn(),
      processQueuedEvents: jest
        .fn()
        .mockResolvedValue({ eventsProcessed: 0, achievementsUnlocked: 0 }),
    };
    const service = new TurnPhaseService(
      'game-1',
      {} as any,
      {} as any,
      {
        sendProcessingStepPacket: jest.fn(),
        sendFreezeClientPacket: jest.fn(),
        sendTurnProcessingError: jest.fn(),
        sendThawClientPacket: jest.fn(),
      } as any,
      events as any,
      undefined,
      undefined,
      undefined,
      undefined,
      random,
      identities
    );
    (service as any).getOrCreatePhaseRecord = jest.fn(async (phase: TurnPhase) => ({
      id: phase,
      completed: {
        phase,
        success: true,
        duration: 1,
        playersProcessed: 0,
        itemsProcessed: 0,
        errors: [],
        data: {
          randomState: checkpoints.get(phase),
          identityNumber: 200 + Object.values(TurnPhase).indexOf(phase),
        },
      },
    }));

    await service.executePhaseProcessing(3, -3920, []);

    expect(random.getState()).toEqual(checkpointSource.getState());
    expect(random.next(1000)).toBe(checkpointSource.next(1000));
    expect(identities.getState()).toBe(200 + Object.values(TurnPhase).length - 1);
  });

  it('thaws clients when a phase fails before the normal end-turn phase', async () => {
    const packets = {
      sendProcessingStepPacket: jest.fn(),
      sendFreezeClientPacket: jest.fn(),
      sendTurnProcessingError: jest.fn(),
      sendThawClientPacket: jest.fn(),
    };
    const service = new TurnPhaseService(
      'game-1',
      {} as any,
      {} as any,
      packets as any,
      {
        registerEventHandler: jest.fn(),
        emitEvent: jest.fn(),
        processQueuedEvents: jest
          .fn()
          .mockResolvedValue({ eventsProcessed: 0, achievementsUnlocked: 0 }),
      } as any
    );
    (service as any).getOrCreatePhaseRecord = jest.fn().mockResolvedValue({ id: 'phase-1' });
    (service as any).executePhase = jest.fn().mockResolvedValue({
      phase: TurnPhase.PHASE_BEGIN_TURN,
      success: false,
      duration: 1,
      playersProcessed: 0,
      itemsProcessed: 0,
      errors: ['database unavailable'],
    });

    const result = await service.executePhaseProcessing(3, -3920, ['player-1']);

    expect(result.success).toBe(false);
    expect(packets.sendThawClientPacket).toHaveBeenCalledWith('Turn processing failed');
  });
});
