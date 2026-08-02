import {
  CityFoundingErrorCode,
  CityFoundingValidationService,
} from '@game/services/CityFoundingValidationService';

describe('CityFoundingValidationService', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:727-753
   * @reference reference/freeciv/common/city.c:1487-1550
   * @assertion Found City is performed by the unit on its target tile and has no independent explored-tile requirement.
   * @c2c3-action Found City
   * @c2c3-scenario normal
   * @c2c3-surface cities
   * @c2c3-surface-scenario normal
   */
  it('does not add an independent exploration gate to the c2c3 Found City action', () => {
    const tile = {
      x: 11,
      y: 13,
      terrain: 'grassland',
      isExplored: false,
      cityId: undefined,
      unitIds: [],
      improvements: [],
      riverMask: 0,
    };
    const mapManager = {
      isValidPosition: jest.fn().mockReturnValue(true),
      getTile: jest.fn().mockReturnValue(tile),
    } as any;
    const service = new CityFoundingValidationService(mapManager, 3, 'civ2civ3');
    const isTileExplored = jest.fn().mockReturnValue(false);
    service.setTileExplorationProvider(isTileExplored);

    const result = service.validateCityFounding(
      11,
      13,
      {
        id: 'settler-1',
        playerId: 'player-1',
        unitTypeId: 'settlers',
        x: 11,
        y: 13,
        movementLeft: 3,
      } as any,
      'player-1',
      new Map()
    );

    expect(result).toEqual({ canFound: true });
    expect(isTileExplored).not.toHaveBeenCalled();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:727-753
   * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:259-259
   * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:308-308
   * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:358-358
   * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:409-409
   * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:460-460
   * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:787-787
   * @reference reference/freeciv/common/city.c:1560-1573
   * @assertion Every c2c3 terrain with the NoCities flag rejects Found City before city-distance checks.
   * @c2c3-action Found City
   * @c2c3-scenario rejected
   * @c2c3-surface cities
   * @c2c3-surface-scenario boundary
   */
  it.each(['inaccessible', 'lake', 'ocean', 'deep_ocean', 'glacier', 'mountains'])(
    'rejects Found City on c2c3 NoCities terrain %s',
    terrain => {
      const tile = {
        x: 11,
        y: 13,
        terrain,
        cityId: undefined,
        unitIds: [],
        improvements: [],
        riverMask: 0,
      };
      const mapManager = {
        isValidPosition: jest.fn().mockReturnValue(true),
        getTile: jest.fn().mockReturnValue(tile),
      } as any;
      const service = new CityFoundingValidationService(mapManager, 3, 'civ2civ3');

      const result = service.validateCityFounding(
        11,
        13,
        {
          id: 'settler-1',
          playerId: 'player-1',
          unitTypeId: 'settlers',
          x: 11,
          y: 13,
          movementLeft: 3,
        } as any,
        'player-1',
        new Map()
      );

      expect(result.canFound).toBe(false);
      expect(result.errorCode).toBe(CityFoundingErrorCode.TERRAIN_NO_CITIES);
    }
  );

  /**
   * @evidence parity
   * @reference reference/freeciv/common/city.c:1465-1478
   * @reference reference/freeciv/common/city.c:1560-1573
   * @reference reference/freeciv/data/civ2civ3/game.ruleset:820-828
   * @assertion c2c3 citymindist 3 rejects a city center two tiles away and permits one exactly three tiles away.
   * @c2c3-action Found City
   * @c2c3-scenario boundary
   * @c2c3-surface cities
   * @c2c3-surface-scenario boundary
   */
  it('applies the c2c3 citymindist boundary to Found City', () => {
    const mapManager = {
      isValidPosition: jest.fn().mockReturnValue(true),
      getTile: jest.fn((x: number, y: number) => ({
        x,
        y,
        terrain: 'grassland',
        cityId: undefined,
        unitIds: [],
        improvements: [],
        riverMask: 0,
      })),
    } as any;
    const service = new CityFoundingValidationService(mapManager, 3, 'civ2civ3');
    const cities = new Map([['city-1', { id: 'city-1', x: 10, y: 10 } as any]]);

    expect(service.validateCityFounding(12, 10, null, 'player-1', cities)).toMatchObject({
      canFound: false,
      errorCode: CityFoundingErrorCode.CITYMINDIST_VIOLATION,
    });
    expect(service.validateCityFounding(13, 10, null, 'player-1', cities)).toEqual({
      canFound: true,
    });
  });
});
