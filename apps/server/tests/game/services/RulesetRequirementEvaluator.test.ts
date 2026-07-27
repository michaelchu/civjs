import { RulesetRequirementEvaluator } from '@game/services/RulesetRequirementEvaluator';

describe('RulesetRequirementEvaluator', () => {
  const evaluator = new RulesetRequirementEvaluator();

  it('selects facts by requirement range', () => {
    expect(
      evaluator.evaluate(
        { type: 'Tech', name: 'Railroad', range: 'Player', present: true },
        {
          Local: { technologies: new Set(['Railroad']) },
          Player: { technologies: new Set(['Alphabet']) },
        }
      )
    ).toBe(false);
  });

  it('applies negation after evaluating the positive requirement', () => {
    expect(
      evaluator.evaluate(
        { type: 'UnitTypeFlag', name: 'Spy', range: 'Local', present: false },
        { Local: { unitTypeFlags: new Set(['Diplomat']) } }
      )
    ).toBe(true);
  });

  it('supports numeric minimum and maximum requirements', () => {
    expect(
      evaluator.evaluateAll(
        [
          { type: 'MinMoveFrags', name: '1', range: 'Local', present: true },
          { type: 'MaxUnitsOnTile', name: '1', range: 'Tile', present: true },
        ],
        { Local: { moves: 3 }, Tile: { unitsOnTile: 1 } }
      )
    ).toBe(true);
  });

  it('fails closed when the requested context is absent', () => {
    expect(
      evaluator.evaluate(
        { type: 'Terrain', name: 'Desert', range: 'Tile', present: true },
        { Local: { terrain: 'Desert' } }
      )
    ).toBe(false);
  });
});
