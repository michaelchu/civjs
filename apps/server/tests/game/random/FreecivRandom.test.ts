import { FreecivRandom, isFreecivRandomState, randomInt } from '@game/random/FreecivRandom';

describe('FreecivRandom', () => {
  it('matches the reference fc_rand sequence after fc_srand warmup', () => {
    const random = new FreecivRandom(1);

    expect(Array.from({ length: 12 }, () => random.next(1000))).toEqual([
      39, 981, 893, 595, 111, 292, 596, 715, 696, 73, 725, 215,
    ]);
  });

  it('restores the complete reference state without advancing it', () => {
    const random = new FreecivRandom(0xdead_beef);
    Array.from({ length: 17 }, () => random.next(97));
    const state = random.getState();
    const expected = Array.from({ length: 20 }, () => random.next(10_000));

    const restored = new FreecivRandom(state);

    expect(Array.from({ length: 20 }, () => restored.next(10_000))).toEqual(expected);
    expect(isFreecivRandomState(state)).toBe(true);
  });

  it('returns zero without advancing state when the requested size is at most one', () => {
    const random = new FreecivRandom(42);
    const before = random.getState();

    expect(random.next(0)).toBe(0);
    expect(random.next(1)).toBe(0);
    expect(random.getState()).toEqual(before);
  });

  it('supports legacy floating-point test sources through the compatibility adapter', () => {
    expect(randomInt(() => 0, 5)).toBe(0);
    expect(randomInt(() => 0.999, 5)).toBe(4);
  });
});
