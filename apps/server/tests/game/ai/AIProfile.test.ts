import { createAIProfile, isAILevel } from '@game/ai/AIProfile';

describe('Freeciv AI difficulty profiles', () => {
  it('matches the reference fuzzy, expansion, and science parameters', () => {
    expect(createAIProfile('novice')).toMatchObject({
      fuzzy: 400,
      expansion: 10,
      scienceCost: 250,
    });
    expect(createAIProfile('easy')).toMatchObject({
      fuzzy: 300,
      expansion: 10,
      scienceCost: 100,
    });
    expect(createAIProfile('normal')).toMatchObject({
      fuzzy: 0,
      expansion: 100,
      scienceCost: 100,
    });
    expect(createAIProfile('away')).toMatchObject({
      fuzzy: 0,
      expansion: 0,
      scienceCost: 100,
    });
  });

  it('assigns the reference level handicaps', () => {
    expect(createAIProfile('easy').handicaps).toEqual(
      expect.objectContaining({
        has: expect.any(Function),
      })
    );
    expect(createAIProfile('easy').handicaps.has('no_planes')).toBe(true);
    expect(createAIProfile('normal').handicaps.has('no_planes')).toBe(false);
    expect(createAIProfile('hard').handicaps).toEqual(new Set(['rates']));
  });

  it('validates levels and clamps persisted trait input', () => {
    expect(isAILevel('cheating')).toBe(true);
    expect(isAILevel('impossible')).toBe(false);
    expect(
      createAIProfile('normal', {
        expansionist: -1,
        trader: 60.4,
        aggressive: 5000,
        builder: 50,
      }).traits
    ).toEqual({
      expansionist: 0,
      trader: 60,
      aggressive: 2500,
      builder: 50,
    });
  });
});
