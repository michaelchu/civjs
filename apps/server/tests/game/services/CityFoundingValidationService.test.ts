import {
  CityFoundingErrorCode,
  CityFoundingValidationService,
} from '@game/services/CityFoundingValidationService';

describe('CityFoundingValidationService', () => {
  it('uses player-scoped exploration instead of the legacy tile flag', () => {
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
    const isTileExplored = jest.fn().mockReturnValue(true);
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
    expect(isTileExplored).toHaveBeenCalledWith('player-1', 11, 13);
  });

  it('still blocks a tile that is unexplored for the founding player', () => {
    const tile = {
      x: 11,
      y: 13,
      terrain: 'grassland',
      isExplored: true,
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
    service.setTileExplorationProvider(() => false);

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
    expect(result.errorCode).toBe(CityFoundingErrorCode.TILE_NOT_EXPLORED);
  });
});
