import {
  FREECIV_IDENTITY_NUMBER_SKIP,
  FreecivIdentityAllocator,
} from '@game/random/FreecivIdentityAllocator';

describe('FreecivIdentityAllocator', () => {
  it('starts after Freeciv IDENTITY_NUMBER_SKIP and preserves creation ordering in UUIDs', () => {
    const identities = new FreecivIdentityAllocator();

    const first = identities.nextUuid();
    const second = identities.nextUuid();

    expect(parseInt(first.slice(0, 8), 16)).toBe(FREECIV_IDENTITY_NUMBER_SKIP + 1);
    expect(parseInt(second.slice(0, 8), 16)).toBe(FREECIV_IDENTITY_NUMBER_SKIP + 2);
    expect(first.localeCompare(second)).toBeLessThan(0);
    expect(first).not.toBe(new FreecivIdentityAllocator().nextUuid());
  });

  it('restores the persisted identity number', () => {
    const identities = new FreecivIdentityAllocator(412);

    expect(parseInt(identities.nextUuid().slice(0, 8), 16)).toBe(413);
    expect(identities.getState()).toBe(413);
  });

  it('skips reserved identities after wrapping and reuses released unit identities', () => {
    const identities = new FreecivIdentityAllocator(249_999, [1, 2]);

    expect(parseInt(identities.nextUuid().slice(0, 8), 16)).toBe(3);
    identities.release(2);
    identities.setState(1);
    expect(parseInt(identities.nextUuid().slice(0, 8), 16)).toBe(2);
  });

  it('reserves identity zero permanently', () => {
    const identities = new FreecivIdentityAllocator(249_999, [1]);

    expect(identities.isReserved(0)).toBe(true);
    identities.release(0);
    expect(identities.isReserved(0)).toBe(true);
  });
});
