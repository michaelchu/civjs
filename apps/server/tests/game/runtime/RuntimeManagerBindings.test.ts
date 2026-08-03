import { createConquestTechnologyProvider } from '@game/runtime/RuntimeManagerBindings';

describe('createConquestTechnologyProvider', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/common/research.c:691-715 research_invention_gettable()
   * @reference reference/freeciv/server/techtools.c:1249-1329 steal_a_tech()
   * @assertion C2C3 conquest theft chooses only a victim-known technology whose prerequisites the conqueror already knows, in the supplied deterministic random order.
   */
  it('selects a victim-known, currently gettable technology in deterministic order', async () => {
    const grantTechnology = jest.fn().mockResolvedValue(true);
    const provider = createConquestTechnologyProvider({
      getResearchedTechs: jest.fn().mockReturnValue(['alphabet', 'writing']),
      getAvailableTechnologies: jest
        .fn()
        .mockReturnValue([{ id: 'alphabet' }, { id: 'bronze_working' }, { id: 'writing' }]),
      grantTechnology,
    } as any);

    await expect(provider('conqueror', 'victim', () => 1)).resolves.toBe('writing');
    expect(grantTechnology).toHaveBeenCalledWith('conqueror', 'writing');
  });

  it('does not grant when no victim technology is currently gettable', async () => {
    const grantTechnology = jest.fn();
    const provider = createConquestTechnologyProvider({
      getResearchedTechs: jest.fn().mockReturnValue(['future_tech']),
      getAvailableTechnologies: jest.fn().mockReturnValue([{ id: 'alphabet' }]),
      grantTechnology,
    } as any);

    await expect(provider('conqueror', 'victim', () => 0)).resolves.toBeUndefined();
    expect(grantTechnology).not.toHaveBeenCalled();
  });
});
