import {
  autoPlaceSpaceship,
  calculateSpaceshipDerived,
  completeSpaceshipPart,
  isSpaceshipLaunchReady,
  launchSpaceship,
  normalizeSpaceshipState,
  placeSpaceshipPart,
  updateSpaceshipArrival,
} from '@game/services/SpaceshipService';

describe('SpaceshipService', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/server/cityturn.c:2768-2851
   * @assertion Completing a c2c3 Special spaceship improvement starts the player's ship and increments its built-part inventory rather than installing a permanent city building.
   * @c2c3-surface victory-space
   * @c2c3-surface-scenario normal
   */
  it('starts a ship when a city completes its first spaceship part', () => {
    const state = completeSpaceshipPart(undefined, 'space_structural');

    expect(state).toMatchObject({
      status: 'started',
      structurals: 1,
      components: 0,
      modules: 0,
    });
  });

  it('rejects a structural that is not connected to the placed hull', () => {
    const unconnected = placeSpaceshipPart({ structurals: 2 }, { kind: 'structural', index: 1 });
    expect(unconnected).toMatchObject({
      success: false,
      reason: 'Structural would not be connected',
    });

    const root = placeSpaceshipPart({ structurals: 2 }, { kind: 'structural', index: 0 });
    expect(root.success).toBe(true);
    expect(placeSpaceshipPart(root.state, { kind: 'structural', index: 1 })).toMatchObject({
      success: true,
      state: expect.objectContaining({ placedStructurals: [0, 1] }),
    });
  });

  it('autoplaces a viable ship and derives the reference success and travel values', () => {
    const state = autoPlaceSpaceship({ structurals: 8, components: 2, modules: 3 });

    expect(state).toMatchObject({
      status: 'started',
      placedStructurals: [0, 1, 2, 4, 6, 8, 10, 12],
      fuel: 1,
      propulsion: 1,
      habitation: 1,
      lifeSupport: 1,
      solarPanels: 1,
      population: 10_000,
      mass: 5600,
      supportRate: 1,
      energyRate: 1,
      successRate: 100,
    });
    expect(state.travelTime).toBeCloseTo(5600 / 220, 8);
    expect(isSpaceshipLaunchReady(state)).toBe(true);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/server/spacerace.c:167-201
   * @assertion A c2c3 spaceship cannot launch without the primary capital or before its connected assembly yields nonzero success, and records the source calendar-year launch and truncated arrival values once valid.
   * @c2c3-surface victory-space
   * @c2c3-surface-scenario boundary
   */
  it('requires both a capital and a viable assembled ship before launch', () => {
    const assembled = autoPlaceSpaceship({ structurals: 8, components: 2, modules: 3 });

    expect(launchSpaceship(assembled, { year: 2000, hasCapital: false })).toMatchObject({
      success: false,
      reason: 'A capital is required to launch',
    });
    expect(
      launchSpaceship(
        { structurals: 16, components: 8, modules: 3 },
        { year: 2000, hasCapital: true }
      )
    ).toMatchObject({ success: false, reason: 'Spaceship cannot be launched yet' });

    expect(launchSpaceship(assembled, { year: 2000, turn: 123, hasCapital: true })).toMatchObject({
      success: true,
      state: expect.objectContaining({
        status: 'launched',
        launchYear: 2000,
        arrivalYear: 2025,
        launchedTurn: 123,
      }),
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/server/srv_main.c:635-724
   * @reference reference/freeciv/server/spacerace.c:418-425
   * @assertion A launched ship transitions to arrived only when the authoritative calendar year reaches its truncated Freeciv arrival year.
   * @c2c3-surface victory-space
   * @c2c3-surface-scenario turn
   */
  it('marks a launched ship as arrived using calendar years, not a fixed turn count', () => {
    const launched = launchSpaceship(
      autoPlaceSpaceship({ structurals: 8, components: 2, modules: 3 }),
      { year: 2000, hasCapital: true }
    );
    expect(launched.success).toBe(true);

    expect(updateSpaceshipArrival(launched.state, 2024).status).toBe('launched');
    expect(updateSpaceshipArrival(launched.state, 2025).status).toBe('arrived');
  });

  it('migrates legacy turn-based launches without inventing placements', () => {
    expect(
      normalizeSpaceshipState({ structurals: 4, components: 2, modules: 1, arrivalTurn: 30 })
    ).toEqual(
      expect.objectContaining({
        status: 'launched',
        structurals: 4,
        components: 2,
        modules: 1,
        placedStructurals: [],
        arrivalTurn: 30,
      })
    );
    expect(normalizeSpaceshipState({ structurals: 4, components: 2, modules: 1 }).status).toBe(
      'started'
    );
    expect(
      calculateSpaceshipDerived({ structurals: 4, components: 2, modules: 1 }).successRate
    ).toBe(0);
  });
});
