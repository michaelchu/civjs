import { afterEach, describe, expect, it, vi } from 'vitest';
import type { City, Unit } from '../../types';
import {
  determineMapClickAction,
  findSelectableCityUnit,
  isRightDragSelectionReady,
  shouldIgnoreClick,
} from '../mapInteraction';

const city = { id: 'city-1', name: 'Rome', x: 2, y: 3 } as City;

const makeUnit = (overrides: Partial<Unit> = {}): Unit =>
  ({
    id: 'unit-1',
    playerId: 'player-1',
    unitTypeId: 'warriors',
    x: 2,
    y: 3,
    hp: 100,
    movesLeft: 2,
    veteranLevel: 0,
    ...overrides,
  }) as Unit;

describe('mapInteraction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:3473-3504
   * @assertion A city click falls through to the city when the occupying stack has no selectable idle unit.
   */
  it('keeps a city reachable when a non-actionable stack occupies it', () => {
    const foreignUnit = makeUnit({ id: 'foreign', playerId: 'player-2' });
    const spentUnit = makeUnit({ id: 'spent', movesLeft: 0 });

    expect(findSelectableCityUnit([foreignUnit, spentUnit], city, 'player-1')).toBeNull();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:3473-3492
   * @assertion An idle owned unit with movement in a city receives the unit context-menu path.
   */
  it('returns an actionable friendly city occupant for the context-menu path', () => {
    const foreignUnit = makeUnit({ id: 'foreign', playerId: 'player-2' });
    const ownUnit = makeUnit({ id: 'own' });

    expect(findSelectableCityUnit([foreignUnit, ownUnit], city, 'player-1')?.id).toBe('own');
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:2301-2307
   * @assertion A multi-unit tile exposes whole-stack and same-type selection rather than selecting only the first unit.
   */
  it('returns every friendly unit for shift-click stack selection', () => {
    const result = determineMapClickAction(
      2,
      3,
      [makeUnit({ id: 'one' }), makeUnit({ id: 'two', unitTypeId: 'settlers' })],
      'player-1',
      [],
      {
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        button: 0,
        isGotoMode: false,
      }
    );

    expect(result.action).toBe('focus');
    expect(result.unitIds).toEqual(['one', 'two']);
  });

  /**
   * @evidence stack
   * @contract CivJS scopes the repeated-click cooldown to the same previously targeted tile.
   */
  it('only applies the click cooldown to the same tile', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    expect(shouldIgnoreClick(900, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(false);
    expect(shouldIgnoreClick(900, { x: 1, y: 1 }, { x: 1, y: 1 })).toBe(true);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:367-374
   * @assertion Right-drag unit selection waits for both 45px axes and 200ms.
   */
  it('gates right-drag selection with the reference distance and time thresholds', () => {
    expect(isRightDragSelectionReady({ x: 0, y: 0 }, { x: 46, y: 46 }, 1_000, 1_201)).toBe(true);
    expect(isRightDragSelectionReady({ x: 0, y: 0 }, { x: 46, y: 20 }, 1_000, 1_201)).toBe(false);
    expect(isRightDragSelectionReady({ x: 0, y: 0 }, { x: 46, y: 46 }, 1_000, 1_200)).toBe(false);
  });
});
