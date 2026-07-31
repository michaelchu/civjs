import { EffectsManager } from '@game/managers/EffectsManager';
import {
  CityCalculationService,
  type CityPlayerContext,
  type CityState,
  SpecialistType,
} from '@game/services/CityCalculationService';

const city = (overrides: Partial<CityState> = {}): CityState => ({
  id: 'city',
  name: 'Test',
  x: 0,
  y: 0,
  playerId: 'player',
  population: 2,
  size: 2,
  cityRadius: 2,
  founded: 1,
  turnsToComplete: 0,
  history: 0,
  buildings: [],
  specialists: {},
  tradeRoutes: [],
  happiness: { happy: 0, content: 2, unhappy: 0, angry: 0 },
  worklist: [],
  ...overrides,
});

const context = (
  subject: CityState,
  overrides: Partial<CityPlayerContext> = {}
): CityPlayerContext => ({
  government: 'Despotism',
  playerTechs: new Set(),
  playerBuildings: new Set(subject.buildings),
  playerCities: [subject],
  taxRates: { tax: 50, luxury: 20, science: 30 },
  ...overrides,
});

describe('city output pipeline', () => {
  it('passes AI identity and difficulty into city effect evaluation', () => {
    const calculateEffect = jest.fn().mockReturnValue({ value: 0 });
    const effects = {
      calculateEffect,
      calculateCityCorruption: jest.fn().mockReturnValue({ corruption: 0 }),
      getRulesetName: jest.fn().mockReturnValue('classic'),
    } as unknown as EffectsManager;
    const subject = city();

    new CityCalculationService(effects).calculateCityOutputs(
      subject,
      { food: 2, shields: 1, trade: 0 },
      undefined,
      context(subject, { playerIsAI: true, aiLevel: 'hard' })
    );

    expect(calculateEffect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ playerIsAI: true, aiLevel: 'hard' })
    );
  });

  it('deducts food consumption after gross tile output and allows starvation', () => {
    const subject = city();
    const result = new CityCalculationService(new EffectsManager()).calculateCityOutputs(
      subject,
      { food: 1, shields: 0, trade: 0 },
      undefined,
      context(subject)
    );

    expect(result.food).toBe(-3);
  });

  it('uses the owning player tax rates', () => {
    const subject = city({ population: 1 });
    const result = new CityCalculationService(new EffectsManager()).calculateCityOutputs(
      subject,
      { food: 2, shields: 1, trade: 5 },
      undefined,
      context(subject, {
        government: 'democracy',
        taxRates: { tax: 0, luxury: 0, science: 100 },
      })
    );

    expect(result).toMatchObject({ trade: 5, science: 5, gold: 0, luxury: 0 });
  });

  it('applies science bonuses to scientist output', () => {
    const effects = new EffectsManager();
    const subject = city({
      population: 1,
      buildings: ['Library'],
      specialists: { [SpecialistType.SCIENTIST]: 1 },
    });

    const result = new CityCalculationService(effects).calculateCityOutputs(
      subject,
      { food: 2, shields: 1, trade: 0 },
      undefined,
      context(subject)
    );

    expect(result.science).toBe(6);
  });

  it('deducts supported-unit food and shield upkeep from surplus', () => {
    const subject = city({ population: 1 });
    const result = new CityCalculationService(new EffectsManager()).calculateCityOutputs(
      subject,
      { food: 4, shields: 3, trade: 0 },
      undefined,
      context(subject, { unitUpkeep: { food: 1, shield: 2, gold: 0 } })
    );

    expect(result.food).toBe(1);
    expect(result.shields).toBe(1);
  });

  it('applies technology-driven pollution and building reductions', () => {
    const service = new CityCalculationService(new EffectsManager());
    const dirty = city({ population: 20 });
    const techs = new Set(['automobile', 'industrialization', 'mass_production', 'plastics']);
    const dirtyOutput = service.calculateCityOutputs(
      dirty,
      { food: 40, shields: 30, trade: 0 },
      undefined,
      context(dirty, { playerTechs: techs })
    );
    const clean = city({
      population: 20,
      buildings: ['mass_transit', 'recycling_center'],
    });
    const cleanOutput = service.calculateCityOutputs(
      clean,
      { food: 40, shields: 30, trade: 0 },
      undefined,
      context(clean, { playerTechs: techs })
    );

    expect(dirtyOutput.pollution).toBeGreaterThan(0);
    expect(cleanOutput.pollution).toBeLessThan(dirtyOutput.pollution);
  });
});
