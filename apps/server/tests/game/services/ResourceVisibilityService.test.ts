import {
  isResourceRevealed,
  visibleResourceForPlayer,
} from '@game/services/ResourceVisibilityService';

describe('ResourceVisibilityService', () => {
  const loader = {
    getResource: jest.fn((resource: string) => {
      const definitions: Record<string, { extra: string; reveal_tech?: string }> = {
        Iron: { extra: 'Iron', reveal_tech: 'iron_working' },
        Gold: { extra: 'Gold' },
      };
      const definition = definitions[resource];
      if (!definition) throw new Error(`Unknown resource ${resource}`);
      return definition;
    }),
  };

  beforeEach(() => loader.getResource.mockClear());

  it('hides a resource until its reveal technology is researched', () => {
    expect(isResourceRevealed('Iron', new Set(), 'civ2civ3', loader)).toBe(false);
    expect(isResourceRevealed('Iron', new Set(['iron_working']), 'civ2civ3', loader)).toBe(true);
    expect(visibleResourceForPlayer('Iron', new Set(), 'civ2civ3', loader)).toBeUndefined();
    expect(visibleResourceForPlayer('Iron', new Set(['iron_working']), 'civ2civ3', loader)).toBe(
      'Iron'
    );
  });

  it('keeps resources without reveal metadata visible', () => {
    expect(isResourceRevealed('Gold', new Set(), 'legacy', loader)).toBe(true);
    expect(visibleResourceForPlayer('Gold', new Set(), 'legacy', loader)).toBe('Gold');
  });

  it('preserves compatibility for undeclared resources', () => {
    expect(isResourceRevealed('LegacyResource', new Set(), 'legacy', loader)).toBe(true);
    expect(visibleResourceForPlayer('LegacyResource', new Set(), 'legacy', loader)).toBe(
      'LegacyResource'
    );
  });

  it('matches technology identifiers case-insensitively and across separators', () => {
    expect(isResourceRevealed('Iron', new Set(['Iron-Working']), 'civ2civ3', loader)).toBe(true);
  });
});
