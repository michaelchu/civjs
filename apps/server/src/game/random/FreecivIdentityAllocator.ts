import { randomUUID } from 'node:crypto';

const IDENTITY_NUMBER_SIZE = 250_000;
export const FREECIV_IDENTITY_NUMBER_SKIP = 100;

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
  constructor(private current: number = FREECIV_IDENTITY_NUMBER_SKIP) {
    this.setState(current);
  }

  nextUuid(): string {
    this.current = (this.current + 1) % IDENTITY_NUMBER_SIZE;
    if (this.current === 0) this.current = 1;
    return createOrderedUuid(this.current);
  }

  getState(): number {
    return this.current;
  }

  setState(current: number): void {
    if (!Number.isInteger(current) || current < 0 || current >= IDENTITY_NUMBER_SIZE) {
      throw new RangeError(`identity number must be between 0 and ${IDENTITY_NUMBER_SIZE - 1}`);
    }
    this.current = current;
  }
}
