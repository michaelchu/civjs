import {
  assertAIState,
  createAIState,
  FreecivAIStateStore,
  type FreecivAIState,
} from '@game/ai/FreecivAIStateStore';

describe('Freeciv AI state', () => {
  it('creates the complete native planning state', () => {
    expect(createAIState()).toEqual({
      diplomacy: {},
      unitTasks: {},
      cityWants: {},
      techWants: {},
    });
  });

  it('accepts complete native state without compatibility repair', () => {
    const state: FreecivAIState = {
      lastProcessedTurn: 12,
      diplomacy: { opponent: { love: -50, warDesire: 30, countdown: 4 } },
      unitTasks: {},
      cityWants: {},
      techWants: {},
    };
    expect(assertAIState(state)).toBe(state);
  });

  it('rejects partial legacy state', () => {
    expect(() => assertAIState({ diplomacy: {} })).toThrow('AI state field unitTasks is invalid');
  });

  it('serializes saves per player and snapshots mutable state', async () => {
    const writes: FreecivAIState[] = [];
    const completions: Array<() => void> = [];
    const database = {
      update: jest.fn(() => ({
        set: jest.fn((value: { aiState: FreecivAIState }) => {
          writes.push(value.aiState);
          return {
            where: jest.fn(
              () =>
                new Promise<void>(resolve => {
                  completions.push(resolve);
                })
            ),
          };
        }),
      })),
    };
    const store = new FreecivAIStateStore({
      getDatabase: () => database,
    } as any);
    const state = createAIState();
    state.lastProcessedTurn = 1;

    const first = store.save('game', 'ai', state);
    state.lastProcessedTurn = 2;
    const second = store.save('game', 'ai', state);

    await new Promise(resolve => setImmediate(resolve));
    expect(writes).toHaveLength(1);
    expect(writes[0].lastProcessedTurn).toBe(1);
    completions.shift()!();
    await first;
    await new Promise(resolve => setImmediate(resolve));
    expect(writes).toHaveLength(2);
    expect(writes[1].lastProcessedTurn).toBe(2);
    completions.shift()!();
    await second;
  });
});
