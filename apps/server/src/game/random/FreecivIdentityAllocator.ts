/**
 * @module server/game/random/FreecivIdentityAllocator
 * Provides Freeciv Identity Allocator deterministic random behavior.
 */
import { randomUUID } from 'node:crypto';

const IDENTITY_NUMBER_SIZE = 250_000;
export const FREECIV_IDENTITY_NUMBER_SKIP = 100;

export function identityNumberFromUuid(id: string): number | null {
  const value = Number.parseInt(id.slice(0, 8), 16);
  return Number.isInteger(value) && value >= 0 && value < IDENTITY_NUMBER_SIZE ? value : null;
}

export function createOrderedUuid(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffff_ffff) {
    throw new RangeError('ordered UUID sequence must be an unsigned 32-bit integer');
  }
  return `${sequence.toString(16).padStart(8, '0')}-${randomUUID().slice(9)}`;
}

/**
 * Per-game adaptation of Freeciv's identity_number().
 *
 * CivJS database identifiers remain UUIDs, but their leading field contains
 * the Freeciv sequence. Lexical UUID ordering therefore follows authoritative
 * creation order instead of random UUID bits.
 */
export class FreecivIdentityAllocator {
  private readonly used = new Set<number>();

  constructor(
    private current: number = FREECIV_IDENTITY_NUMBER_SKIP,
    reserved: Iterable<number> = []
  ) {
    this.setState(current);
    this.reserve(0);
    for (const identity of reserved) this.reserve(identity);
  }

  nextUuid(): string {
    for (let retries = 0; retries < IDENTITY_NUMBER_SIZE; retries++) {
      this.current = (this.current + 1) % IDENTITY_NUMBER_SIZE;
      if (this.used.has(this.current)) continue;
      this.reserve(this.current);
      return createOrderedUuid(this.current);
    }
    throw new Error('Exhausted city and unit identity numbers');
  }

  reserve(identity: number): void {
    this.validateIdentity(identity);
    this.used.add(identity);
  }

  reserveUuid(id: string): void {
    const identity = identityNumberFromUuid(id);
    if (identity === null)
      throw new RangeError(`UUID does not contain a valid identity number: ${id}`);
    this.reserve(identity);
  }

  release(identity: number): void {
    this.validateIdentity(identity);
    if (identity !== 0) this.used.delete(identity);
  }

  releaseUuid(id: string): void {
    const identity = identityNumberFromUuid(id);
    if (identity !== null) this.release(identity);
  }

  isReserved(identity: number): boolean {
    this.validateIdentity(identity);
    return this.used.has(identity);
  }

  getState(): number {
    return this.current;
  }

  setState(current: number): void {
    this.validateIdentity(current);
    this.current = current;
  }

  private validateIdentity(identity: number): void {
    if (!Number.isInteger(identity) || identity < 0 || identity >= IDENTITY_NUMBER_SIZE) {
      throw new RangeError(`identity number must be between 0 and ${IDENTITY_NUMBER_SIZE - 1}`);
    }
  }
}
