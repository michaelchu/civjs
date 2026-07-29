import { createAIState } from '@game/ai/AIStateStore';
import { assertAIValidationInvariants } from './aiValidation';

function gameFixture(overrides: Record<string, unknown> = {}) {
  const player = { id: 'ai', aiState: createAIState() };
  return {
    id: 'validation-game',
    currentTurn: 7,
    players: new Map([[player.id, player]]),
    mapManager: {
      getMapData: () => ({ seed: 'validation-seed', width: 10, height: 10 }),
    },
    unitManager: {
      getAllUnits: () => new Map(),
      getPlayerUnits: () => [],
    },
    cityManager: {
      getAllCities: () => [],
      getPlayerCities: () => [],
    },
    ...overrides,
  } as any;
}

describe('AI validation invariants', () => {
  it('accepts a coherent empty simulation state', () => {
    expect(() => assertAIValidationInvariants(gameFixture())).not.toThrow();
  });

  it('includes deterministic replay data when an invariant fails', () => {
    const game = gameFixture({
      unitManager: {
        getAllUnits: () =>
          new Map([
            [
              'lost-unit',
              { id: 'lost-unit', playerId: 'missing', x: 12, y: 2, health: 100, movementLeft: 1 },
            ],
          ]),
        getPlayerUnits: () => [],
      },
    });

    expect(() => assertAIValidationInvariants(game)).toThrow('validation-seed');
    expect(() => assertAIValidationInvariants(game)).toThrow('lost-unit has no owner');
  });
});
