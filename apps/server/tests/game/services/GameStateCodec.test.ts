import { GameStateCodec } from '@game/services/GameStateCodec';

describe('GameStateCodec', () => {
  const snapshot = {
    version: 2,
    turn: 4,
    year: -3880,
    calendar: {},
    cities: [],
    units: [],
    research: {},
  };

  it('validates current authoritative checkpoints', () => {
    expect(new GameStateCodec().decode(snapshot)).toEqual(snapshot);
  });

  it('runs registered migrations before validation', () => {
    const codec = new GameStateCodec();
    codec.registerMigration(1, legacy => ({
      ...legacy,
      version: 2,
      calendar: {},
      cities: [],
      units: [],
      research: {},
    }));

    expect(codec.decode({ version: 1, turn: 4, year: -3880 })).toEqual(snapshot);
  });

  it('rejects unknown versions and incomplete state', () => {
    expect(() => new GameStateCodec().decode({ ...snapshot, version: 3 })).toThrow(
      'Unsupported game-state snapshot version'
    );
    expect(() => new GameStateCodec().decode({ ...snapshot, units: undefined })).toThrow(
      'cities and units must be arrays'
    );
  });
});
