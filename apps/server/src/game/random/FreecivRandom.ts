import { randomBytes } from 'node:crypto';

const MAX_UINT32 = 0xffff_ffff;
const STATE_SIZE = 56;
const WARMUP_ROUNDS = 10_000;

export interface FreecivRandomState {
  values: number[];
  j: number;
  k: number;
  x: number;
}

export interface IntegerRandomSource {
  next(size: number): number;
}

export type RandomSource = IntegerRandomSource | (() => number);

function assertUint32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new RangeError(`${label} must be an unsigned 32-bit integer`);
  }
}

function validateState(state: FreecivRandomState): void {
  if (!Array.isArray(state.values) || state.values.length !== STATE_SIZE) {
    throw new RangeError(`Freeciv random state must contain ${STATE_SIZE} values`);
  }
  state.values.forEach((value, index) => assertUint32(value, `state.values[${index}]`));
  for (const [label, value] of [
    ['state.j', state.j],
    ['state.k', state.k],
    ['state.x', state.x],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value >= STATE_SIZE) {
      throw new RangeError(`${label} must be between 0 and ${STATE_SIZE - 1}`);
    }
  }
}

/**
 * Per-game port of Freeciv's utility/rand.c generator.
 *
 * Freeciv keeps one process-global RANDOM_STATE because a server hosts one
 * game. CivJS hosts multiple games, so each authoritative game owns one
 * equivalent stateful stream.
 */
export class FreecivRandom implements IntegerRandomSource {
  private state: FreecivRandomState;

  constructor(seedOrState: number | FreecivRandomState) {
    if (typeof seedOrState === 'number') {
      assertUint32(seedOrState, 'seed');
      this.state = FreecivRandom.seedState(seedOrState);
      for (let index = 0; index < WARMUP_ROUNDS; index += 1) {
        this.next(MAX_UINT32);
      }
      return;
    }

    validateState(seedOrState);
    this.state = FreecivRandom.cloneState(seedOrState);
  }

  /**
   * Equivalent to fc_rand(size): returns an integer in [0, size - 1].
   * The rejection step deliberately matches Freeciv's range reduction.
   */
  next(size: number): number {
    assertUint32(size, 'size');
    if (size <= 1) return 0;

    const divisor = Math.floor(MAX_UINT32 / size);
    const max = size * divisor - 1;
    let value = 0;
    let bailout = 0;

    do {
      value = (this.state.values[this.state.j]! + this.state.values[this.state.k]!) >>> 0;
      this.state.x = (this.state.x + 1) % STATE_SIZE;
      this.state.j = (this.state.j + 1) % STATE_SIZE;
      this.state.k = (this.state.k + 1) % STATE_SIZE;
      this.state.values[this.state.x] = value;
      bailout += 1;
      if (bailout > 10_000) return 0;
    } while (value > max);

    return Math.floor(value / divisor);
  }

  getState(): FreecivRandomState {
    return FreecivRandom.cloneState(this.state);
  }

  setState(state: FreecivRandomState): void {
    validateState(state);
    this.state = FreecivRandom.cloneState(state);
  }

  private static seedState(seed: number): FreecivRandomState {
    const values = Array<number>(STATE_SIZE).fill(0);
    values[0] = seed >>> 0;
    for (let index = 1; index < STATE_SIZE; index += 1) {
      values[index] = (Math.imul(3, values[index - 1]!) + 257) >>> 0;
    }
    return {
      values,
      j: 0,
      k: 31,
      x: 55,
    };
  }

  private static cloneState(state: FreecivRandomState): FreecivRandomState {
    return {
      values: [...state.values],
      j: state.j,
      k: state.k,
      x: state.x,
    };
  }
}

export function generateFreecivGameSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

/** Compatibility adapter while manager unit tests continue to inject floats. */
export function randomInt(source: RandomSource, size: number): number {
  if (typeof source === 'function') {
    if (!Number.isInteger(size) || size <= 0) return 0;
    return Math.min(size - 1, Math.floor(source() * size));
  }
  return source.next(size);
}

export function isFreecivRandomState(value: unknown): value is FreecivRandomState {
  try {
    validateState(value as FreecivRandomState);
    return true;
  } catch {
    return false;
  }
}
