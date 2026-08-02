import {
  FUTURE_TECH_ID,
  ResearchManager,
  TECHNOLOGIES,
  calculateRulesetTechnologyCost,
  loadRulesetTechnologies,
} from '@game/managers/ResearchManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { EffectsManager } from '@game/managers/EffectsManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('ResearchManager', () => {
  let researchManager: ResearchManager;
  const gameId = 'test-game-id';

  beforeEach(() => {
    const mockDbProvider = createMockDatabaseProvider();
    researchManager = new ResearchManager(gameId, mockDbProvider);
    jest.clearAllMocks();
  });

  describe('technology definitions', () => {
    it('should have valid technology definitions', () => {
      const classicTechs = rulesetLoader.getTechs();
      const classicResearch = rulesetLoader.loadGameRulesRuleset().research;

      expect(TECHNOLOGIES.alphabet).toBeDefined();
      expect(TECHNOLOGIES.alphabet.name).toBe('Alphabet');
      expect(TECHNOLOGIES.alphabet.cost).toBe(
        calculateRulesetTechnologyCost('alphabet', classicTechs, classicResearch)
      );
      expect(TECHNOLOGIES.alphabet.requirements).toEqual([]);

      expect(TECHNOLOGIES.mathematics).toBeDefined();
      expect(TECHNOLOGIES.mathematics.requirements).toEqual(classicTechs.mathematics.requirements);
      expect(TECHNOLOGIES.mathematics.cost).toBe(
        calculateRulesetTechnologyCost('mathematics', classicTechs, classicResearch)
      );

      expect(TECHNOLOGIES.philosophy).toBeDefined();
      expect(TECHNOLOGIES.philosophy.flags).toContain('Bonus_Tech');
      expect(TECHNOLOGIES.philosophy.requirements).toEqual(classicTechs.philosophy.requirements);
    });

    it('should have properly structured tech tree', () => {
      expect(Object.keys(TECHNOLOGIES)).toHaveLength(Object.keys(rulesetLoader.getTechs()).length);

      // Check that all required techs exist
      for (const tech of Object.values(TECHNOLOGIES)) {
        for (const reqTech of tech.requirements) {
          expect(TECHNOLOGIES[reqTech]).toBeDefined();
        }
      }
    });

    it('builds an injectable ruleset-backed catalogue', () => {
      const mutated = structuredClone(rulesetLoader.getTechs());

      const technologies = loadRulesetTechnologies({
        getTechs: () => mutated,
        loadGameRulesRuleset: () => rulesetLoader.loadGameRulesRuleset(),
      });

      expect(technologies.pottery.cost).toBe(
        calculateRulesetTechnologyCost(
          'pottery',
          mutated,
          rulesetLoader.loadGameRulesRuleset().research
        )
      );
      expect(technologies.pottery.requirements).toEqual(mutated.pottery.requirements);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/tech.c:225-275
     * @reference reference/freeciv/common/tech.c:544-606
     * @reference reference/freeciv/data/civ2civ3/game.ruleset:308-339
     * @assertion The c2c3 Linear technology cost is the base cost times the distinct recursive requirement count, including the technology itself.
     * @c2c3-surface research-government
     * @c2c3-surface-scenario normal
     */
    it('derives c2c3 technology costs from the source dependency graph', () => {
      const technologies = loadRulesetTechnologies(rulesetLoader, 'civ2civ3');

      expect({
        alphabet: technologies.alphabet.cost,
        writing: technologies.writing.cost,
        electricity: technologies.electricity.cost,
        advancedFlight: technologies.advanced_flight.cost,
        fusionPower: technologies.fusion_power.cost,
      }).toEqual({
        alphabet: 10,
        writing: 20,
        electricity: 300,
        advancedFlight: 570,
        fusionPower: 770,
      });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/tech.c:544-606
     * @reference reference/freeciv/data/civ2civ3/techs.ruleset:364-371
     * @reference reference/freeciv/data/civ2civ3/game.ruleset:325-339
     * @assertion Recursive c2c3 prerequisite paths are de-duplicated, so Fusion Power's 77 distinct requirements cost 770 bulbs rather than counting shared ancestors repeatedly.
     * @c2c3-surface research-government
     * @c2c3-surface-scenario boundary
     */
    it('counts shared c2c3 technology prerequisites only once', () => {
      const technologies = loadRulesetTechnologies(rulesetLoader, 'civ2civ3');

      expect(technologies.fusion_power.cost).toBe(770);
    });
  });

  describe('player initialization', () => {
    it('starts with no free technology and selects an initial research target', async () => {
      await researchManager.initializePlayerResearch('player-123');

      const research = researchManager.getPlayerResearch('player-123');
      expect(research).toBeDefined();
      expect(research!.playerId).toBe('player-123');
      expect(research!.bulbsAccumulated).toBe(0);
      expect(research!.researchedTechs).toEqual(new Set());
      expect(research!.futureTechs).toBe(0);
      expect(research!.currentTech).toBe('alphabet');

      // Database operations handled by MockDatabaseProvider
    });

    it('charges no technology upkeep under the classic None setting', async () => {
      await researchManager.initializePlayerResearch('player-123');

      expect(researchManager.calculateTechnologyUpkeep('player-123', 4)).toBe(0);
    });

    it('applies civ2civ3 cost factors and sciencebox to per-city technology upkeep', async () => {
      const technologies = loadRulesetTechnologies(rulesetLoader, 'civ2civ3');
      const manager = new ResearchManager(
        gameId,
        createMockDatabaseProvider(),
        technologies,
        new EffectsManager('civ2civ3'),
        'civ2civ3'
      );
      await manager.initializePlayerResearch('player');
      for (const tech of Object.values(technologies)) {
        await manager.grantTechnology('player', tech.id);
      }

      const totalCost = Object.values(technologies).reduce((sum, tech) => sum + tech.cost, 0);
      const expected = Math.floor(Math.max(0, (totalCost * 4) / 6000 - 3) * 2);
      expect(manager.calculateTechnologyUpkeep('player', 2)).toBe(expected);
    });
  });

  describe('research selection', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
      await researchManager.grantTechnology('player-123', 'alphabet');
    });

    it('should set current research successfully', async () => {
      await researchManager.setCurrentResearch('player-123', 'pottery');

      const research = researchManager.getPlayerResearch('player-123');
      expect(research!.currentTech).toBe('pottery');
    });

    it('automatically selects a target instead of discarding bulbs', async () => {
      const research = researchManager.getPlayerResearch('player-123')!;
      research.currentTech = undefined;

      await researchManager.addResearchPoints('player-123', 3);

      expect(research.currentTech).toBeDefined();
      expect(research.bulbsAccumulated).toBe(3);
      expect(research.bulbsLastTurn).toBe(3);
    });

    it('should reject invalid technology', async () => {
      await expect(
        researchManager.setCurrentResearch('player-123', 'invalid-tech')
      ).rejects.toThrow('Unknown technology: invalid-tech');
    });

    it('should reject already researched technology', async () => {
      await expect(researchManager.setCurrentResearch('player-123', 'alphabet')).rejects.toThrow(
        'Technology alphabet already researched'
      );
    });

    it('should reject technology without requirements', async () => {
      await expect(researchManager.setCurrentResearch('player-123', 'mathematics')).rejects.toThrow(
        'Missing requirement: masonry for mathematics'
      );
    });

    it('should allow technology with satisfied requirements', async () => {
      const research = researchManager.getPlayerResearch('player-123')!;
      research.researchedTechs.add('masonry');

      await researchManager.setCurrentResearch('player-123', 'mathematics');
      expect(research.currentTech).toBe('mathematics');
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/server/techtools.c:1048-1064
     * @assertion Switching a research target applies the configured penalty to accumulated non-free bulbs before selecting the new target.
     */
    it('applies the classic 100 percent penalty when switching targets', async () => {
      await researchManager.setCurrentResearch('player-123', 'pottery');
      await researchManager.addResearchPoints('player-123', 5);

      await researchManager.setCurrentResearch('player-123', 'warrior_code');

      expect(researchManager.getPlayerResearch('player-123')).toMatchObject({
        currentTech: 'warrior_code',
        bulbsAccumulated: 0,
      });
    });

    it('applies a configured partial switching penalty', async () => {
      const manager = new ResearchManager(
        gameId,
        createMockDatabaseProvider(),
        TECHNOLOGIES,
        new EffectsManager(),
        'classic',
        { techPenalty: 25 }
      );
      await manager.initializePlayerResearch('player');
      await manager.grantTechnology('player', 'alphabet');
      await manager.setCurrentResearch('player', 'pottery');
      await manager.addResearchPoints('player', 8);

      await manager.setCurrentResearch('player', 'warrior_code');

      expect(manager.getPlayerResearch('player')?.bulbsAccumulated).toBe(6);
    });
  });

  describe('research goals', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
    });

    it('should set research goal successfully', async () => {
      await researchManager.setResearchGoal('player-123', 'mathematics');

      const research = researchManager.getPlayerResearch('player-123');
      expect(research!.techGoal).toBe('mathematics');
    });

    it('should reject invalid goal technology', async () => {
      await expect(researchManager.setResearchGoal('player-123', 'invalid-tech')).rejects.toThrow(
        'Unknown technology: invalid-tech'
      );
    });
  });

  describe('wonder research effects', () => {
    it('grants two immediately available technologies for Darwin’s Voyage', async () => {
      await researchManager.initializePlayerResearch('darwin-player');

      const granted = await researchManager.grantAvailableTechnologies('darwin-player', 2);

      expect(granted).toHaveLength(2);
      expect(researchManager.getResearchedTechs('darwin-player')).toEqual(
        expect.arrayContaining(granted)
      );
    });

    it('grants Great Library knowledge known by two other players', async () => {
      for (const player of ['library-player', 'peer-1', 'peer-2']) {
        await researchManager.initializePlayerResearch(player);
      }
      await researchManager.grantTechnology('peer-1', 'pottery');
      await researchManager.grantTechnology('peer-2', 'pottery');

      await researchManager.processTechParasite('library-player', 2);

      expect(researchManager.hasResearchedTech('library-player', 'pottery')).toBe(true);
    });
  });

  describe('research progress', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
      await researchManager.grantTechnology('player-123', 'alphabet');
      await researchManager.setCurrentResearch('player-123', 'pottery');
    });

    it('should add research points correctly', async () => {
      const bulbs = TECHNOLOGIES.pottery.cost - 1;
      const completedTech = await researchManager.addResearchPoints('player-123', bulbs);

      const research = researchManager.getPlayerResearch('player-123');
      expect(research!.bulbsAccumulated).toBe(bulbs);
      expect(research!.bulbsLastTurn).toBe(bulbs);
      expect(completedTech).toBeNull(); // One bulb short of completing Pottery.
    });

    it('should complete technology when enough points accumulated', async () => {
      const completedTech = await researchManager.addResearchPoints(
        'player-123',
        TECHNOLOGIES.pottery.cost
      );

      expect(completedTech).toBe('pottery');

      const research = researchManager.getPlayerResearch('player-123');
      expect(research!.researchedTechs.has('pottery')).toBe(true);
      expect(research!.bulbsAccumulated).toBe(0); // Reset after completion
      expect(research!.currentTech).toBeDefined(); // Auto-selects next available tech
    });

    it('notifies telemetry observers when research completes', async () => {
      const observer = jest.fn();
      researchManager.setTechnologyCompletionObserver(observer);

      await expect(
        researchManager.addResearchPoints('player-123', TECHNOLOGIES.pottery.cost)
      ).resolves.toBe('pottery');

      expect(observer).toHaveBeenCalledWith('player-123', 'pottery', 'research');
    });

    it('should save excess bulbs when completing technology', async () => {
      const completedTech = await researchManager.addResearchPoints(
        'player-123',
        TECHNOLOGIES.pottery.cost + 5
      );

      expect(completedTech).toBe('pottery');

      const research = researchManager.getPlayerResearch('player-123');
      expect(research!.bulbsAccumulated).toBe(5); // 15 - 10 = 5 excess
    });

    it('applies the AI difficulty science-cost multiplier to cost and overflow', async () => {
      researchManager.setScienceCostProvider(playerId => (playerId === 'player-123' ? 250 : 100));
      const required = Math.ceil(TECHNOLOGIES.pottery.cost * 2.5);

      expect(researchManager.getResearchProgress('player-123')).toEqual({
        current: 0,
        required,
        turnsRemaining: -1,
      });
      expect(await researchManager.addResearchPoints('player-123', required - 1)).toBeNull();
      expect(await researchManager.addResearchPoints('player-123', 6)).toBe('pottery');
      expect(researchManager.getPlayerResearch('player-123')!.bulbsAccumulated).toBe(5);
    });

    it('matches civ2civ3 cost-factor, game-speed, and AI pacing semantics', async () => {
      const technologies = loadRulesetTechnologies(rulesetLoader, 'civ2civ3');
      const manager = new ResearchManager(
        gameId,
        createMockDatabaseProvider(),
        technologies,
        new EffectsManager('civ2civ3'),
        'civ2civ3',
        { scienceBox: 150 }
      );
      for (const playerId of ['human', 'easy-ai', 'restricted-ai']) {
        await manager.initializePlayerResearch(playerId);
      }
      manager.setScienceCostProvider(playerId => (playerId === 'restricted-ai' ? 250 : 100));
      const baseCost = technologies.alphabet.cost;

      expect(manager.getResearchProgress('human')?.required).toBe(baseCost * 3 * 1.5);
      expect(manager.getResearchProgress('easy-ai')?.required).toBe(baseCost * 3 * 1.5);
      expect(manager.getResearchProgress('restricted-ai')?.required).toBe(
        Math.ceil(baseCost * 3 * 1.5 * 2.5)
      );
      expect(
        manager.getAvailableTechnologies('human').find(tech => tech.id === 'alphabet')?.cost
      ).toBe(baseCost * 3 * 1.5);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/research.c:872-1050
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3794-3796
     * @assertion A c2c3 root technology completes exactly when accumulated bulbs reach its base cost after the global Tech_Cost_Factor has been applied.
     * @c2c3-surface research-government
     * @c2c3-surface-scenario turn
     */
    it('completes c2c3 research at the exact cost-adjusted turn boundary', async () => {
      const technologies = loadRulesetTechnologies(rulesetLoader, 'civ2civ3');
      const manager = new ResearchManager(
        gameId,
        createMockDatabaseProvider(),
        technologies,
        new EffectsManager('civ2civ3'),
        'civ2civ3'
      );
      await manager.initializePlayerResearch('player');

      expect(manager.getResearchProgress('player')).toEqual({
        current: 0,
        required: 30,
        turnsRemaining: -1,
      });
      await expect(manager.addResearchPoints('player', 29)).resolves.toBeNull();
      await expect(manager.addResearchPoints('player', 1)).resolves.toBe('alphabet');
    });

    it('uses Civ I/II dynamic costs together with the ruleset sciencebox', async () => {
      const manager = new ResearchManager(
        gameId,
        createMockDatabaseProvider(),
        loadRulesetTechnologies(rulesetLoader, 'civ2'),
        new EffectsManager('civ2'),
        'civ2'
      );
      await manager.initializePlayerResearch('player');

      expect(manager.getResearchProgress('player')?.required).toBe(10);
      await manager.grantTechnology('player', 'alphabet');
      await manager.setCurrentResearch('player', 'pottery');

      expect(manager.getResearchProgress('player')?.required).toBe(20);
    });

    it('routes the next research through a goal prerequisite chain', async () => {
      await researchManager.setResearchGoal('player-123', 'mathematics');

      // Complete pottery
      await researchManager.addResearchPoints('player-123', TECHNOLOGIES.pottery.cost);

      const research = researchManager.getPlayerResearch('player-123');
      expect(research!.currentTech).toBe('masonry');
      expect(research!.techGoal).toBe('mathematics');
    });
  });

  describe('available technologies', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
    });

    it('should return technologies available for research', () => {
      const availableTechs = researchManager.getAvailableTechnologies('player-123');

      const expected = Object.values(TECHNOLOGIES)
        .filter(tech => tech.requirements.length === 0)
        .map(tech => tech.id);
      expect(availableTechs.map(t => t.id).sort()).toEqual(expected.sort());
      expect(availableTechs.map(t => t.id)).toContain('alphabet');
    });

    it('should update available technologies as research progresses', async () => {
      // Complete pottery
      const research = researchManager.getPlayerResearch('player-123')!;
      research.researchedTechs.add('pottery');

      const availableTechs = researchManager.getAvailableTechnologies('player-123');

      // Pottery is no longer available after it has been researched.
      expect(availableTechs.map(t => t.id)).not.toContain('pottery'); // Already researched
    });
  });

  describe('research progress queries', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
      await researchManager.grantTechnology('player-123', 'alphabet');
      await researchManager.setCurrentResearch('player-123', 'pottery');
    });

    it('should return correct research progress', () => {
      const research = researchManager.getPlayerResearch('player-123')!;
      research.bulbsAccumulated = 7;
      research.bulbsLastTurn = 3;

      const progress = researchManager.getResearchProgress('player-123');

      expect(progress).toEqual({
        current: 7,
        required: TECHNOLOGIES.pottery.cost,
        turnsRemaining: Math.ceil((TECHNOLOGIES.pottery.cost - 7) / 3),
      });
    });

    it('should automatically expose progress for a newly initialized player', async () => {
      await researchManager.initializePlayerResearch('player-456');

      const progress = researchManager.getResearchProgress('player-456');
      expect(progress).toEqual({
        current: 0,
        required: TECHNOLOGIES.alphabet.cost,
        turnsRemaining: -1,
      });
    });
  });

  describe('technology queries', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
      await researchManager.grantTechnology('player-123', 'alphabet');
    });

    it('should check if player has researched technology', () => {
      expect(researchManager.hasResearchedTech('player-123', 'alphabet')).toBe(true);
      expect(researchManager.hasResearchedTech('player-123', 'pottery')).toBe(false);
    });

    it('should return list of researched technologies', () => {
      const researchedTechs = researchManager.getResearchedTechs('player-123');

      expect(researchedTechs).toEqual(['alphabet']);

      // Add another tech and check
      const research = researchManager.getPlayerResearch('player-123')!;
      research.researchedTechs.add('pottery');

      const updatedTechs = researchManager.getResearchedTechs('player-123');
      expect(updatedTechs).toContain('alphabet');
      expect(updatedTechs).toContain('pottery');
    });

    it('should check if technology can be researched', () => {
      expect(researchManager.canResearch('player-123', 'pottery')).toBe(true);
      expect(researchManager.canResearch('player-123', 'alphabet')).toBe(false); // Already researched
      expect(researchManager.canResearch('player-123', 'mathematics')).toBe(false); // Missing masonry
      expect(researchManager.canResearch('player-123', 'invalid-tech')).toBe(false); // Doesn't exist
    });
  });

  describe('bonus technologies', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
    });

    it('grants the first Philosophy discoverer a goal-directed bonus tech', async () => {
      // Research prerequisites for philosophy
      const research = researchManager.getPlayerResearch('player-123')!;
      research.researchedTechs.add('mysticism');
      research.researchedTechs.add('literacy');
      await researchManager.setResearchGoal('player-123', 'university');

      await researchManager.setCurrentResearch('player-123', 'philosophy');
      const completedTech = await researchManager.addResearchPoints(
        'player-123',
        TECHNOLOGIES.philosophy.cost
      );

      expect(completedTech).toBe('philosophy');
      expect(research.researchedTechs.has('philosophy')).toBe(true);

      // Should have received a bonus tech
      expect(research.researchedTechs.has('alphabet')).toBe(true);
      expect(research.researchedTechs.size).toBe(4);
    });

    it('does not award Philosophy a second time', async () => {
      await researchManager.initializePlayerResearch('player-456');
      for (const playerId of ['player-123', 'player-456']) {
        const research = researchManager.getPlayerResearch(playerId)!;
        research.researchedTechs.add('mysticism');
        research.researchedTechs.add('literacy');
        await researchManager.setCurrentResearch(playerId, 'philosophy');
        await researchManager.addResearchPoints(playerId, TECHNOLOGIES.philosophy.cost);
      }

      expect(researchManager.getPlayerResearch('player-456')!.researchedTechs.size).toBe(3);
    });
  });

  describe('complete age progression', () => {
    it('can traverse every classic technology and continue into Future Tech', async () => {
      await researchManager.initializePlayerResearch('player-123');

      const granted = await researchManager.grantAvailableTechnologies(
        'player-123',
        Object.keys(TECHNOLOGIES).length
      );

      expect(new Set(granted).size).toBe(Object.keys(TECHNOLOGIES).length);
      expect(researchManager.getResearchedTechs('player-123')).toHaveLength(
        Object.keys(TECHNOLOGIES).length
      );
      expect(researchManager.getAvailableTechnologies('player-123')).toEqual([
        expect.objectContaining({ id: FUTURE_TECH_ID, name: 'Future Tech. 1' }),
      ]);

      await researchManager.setCurrentResearch('player-123', FUTURE_TECH_ID);
      const required = researchManager.getResearchProgress('player-123')!.required;
      await researchManager.addResearchPoints('player-123', required);

      expect(researchManager.getPlayerResearch('player-123')).toMatchObject({
        currentTech: FUTURE_TECH_ID,
        futureTechs: 1,
      });
      expect(researchManager.getTechnologyCatalogue('player-123')).toHaveLength(
        Object.keys(TECHNOLOGIES).length + 1
      );
    });
  });

  describe('database integration', () => {
    it('should load player research from database', async () => {
      // Mock database provider returns empty arrays, so loadPlayerResearch should complete without error
      await expect(researchManager.loadPlayerResearch()).resolves.not.toThrow();

      // Database loading is mocked, so no actual data will be loaded
      const research = researchManager.getPlayerResearch('player-1');
      expect(research).toBeUndefined(); // MockDatabaseProvider returns empty data
    });
  });

  describe('edge cases', () => {
    it('should handle non-existent player gracefully', () => {
      const research = researchManager.getPlayerResearch('non-existent');
      expect(research).toBeUndefined();

      const availableTechs = researchManager.getAvailableTechnologies('non-existent');
      expect(availableTechs).toEqual([]);

      const progress = researchManager.getResearchProgress('non-existent');
      expect(progress).toBeNull();
    });

    it('should automatically research the initial target', async () => {
      await researchManager.initializePlayerResearch('player-123');
      const initialTarget = researchManager.getPlayerResearch('player-123')!.currentTech;

      const completedTech = await researchManager.addResearchPoints(
        'player-123',
        TECHNOLOGIES[initialTarget!].cost
      );
      expect(initialTarget).toBeDefined();
      expect(completedTech).toBe(initialTarget);
    });
  });

  describe('cleanup', () => {
    it('should clean up all research data', async () => {
      await researchManager.initializePlayerResearch('player-1');
      await researchManager.initializePlayerResearch('player-2');

      const debugInfo = researchManager.getDebugInfo();
      expect(debugInfo.playerCount).toBe(2);

      researchManager.cleanup();

      const debugInfoAfter = researchManager.getDebugInfo();
      expect(debugInfoAfter.playerCount).toBe(0);
    });
  });

  describe('debug information', () => {
    it('should provide useful debug information', async () => {
      await researchManager.initializePlayerResearch('player-123');
      await researchManager.setCurrentResearch('player-123', 'pottery');

      const debugInfo = researchManager.getDebugInfo();

      expect(debugInfo.gameId).toBe(gameId);
      expect(debugInfo.playerCount).toBe(1);
      expect(debugInfo.players['player-123']).toBeDefined();
      expect(debugInfo.players['player-123'].currentTech).toBe('pottery');
      expect(debugInfo.players['player-123'].researchedTechCount).toBe(0);
      expect(debugInfo.players['player-123'].futureTechs).toBe(0);
    });
  });
});
