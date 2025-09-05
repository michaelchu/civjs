import { ResearchManager, TECHNOLOGIES } from '@game/managers/ResearchManager';
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
      expect(TECHNOLOGIES.alphabet).toBeDefined();
      expect(TECHNOLOGIES.alphabet.name).toBe('Alphabet');
      expect(TECHNOLOGIES.alphabet.cost).toBe(10);
      expect(TECHNOLOGIES.alphabet.requirements).toEqual([]);

      expect(TECHNOLOGIES.mathematics).toBeDefined();
      expect(TECHNOLOGIES.mathematics.requirements).toEqual(['alphabet']);
      expect(TECHNOLOGIES.mathematics.cost).toBe(20);

      expect(TECHNOLOGIES.philosophy).toBeDefined();
      expect(TECHNOLOGIES.philosophy.flags).toContain('bonus_tech');
      expect(TECHNOLOGIES.philosophy.requirements).toEqual(['writing', 'mysticism']);
    });

    it('should have properly structured tech tree', () => {
      // Check that all required techs exist
      for (const tech of Object.values(TECHNOLOGIES)) {
        for (const reqTech of tech.requirements) {
          expect(TECHNOLOGIES[reqTech]).toBeDefined();
        }
      }
    });
  });

  describe('player initialization', () => {
    it('should initialize player research with alphabet', async () => {
      await researchManager.initializePlayerResearch('player-123');

      const research = researchManager.getPlayerResearch('player-123');
      expect(research).toBeDefined();
      expect(research!.playerId).toBe('player-123');
      expect(research!.bulbsAccumulated).toBe(0);
      expect(research!.researchedTechs.has('alphabet')).toBe(true);

      // Database operations handled by MockDatabaseProvider
    });
  });

  describe('research selection', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
    });

    it('should set current research successfully', async () => {
      await researchManager.setCurrentResearch('player-123', 'pottery');

      const research = researchManager.getPlayerResearch('player-123');
      expect(research!.currentTech).toBe('pottery');
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
      await expect(
        researchManager.setCurrentResearch('player-123', 'bronze_working')
      ).rejects.toThrow('Missing requirement: pottery for bronze_working');
    });

    it('should allow technology with satisfied requirements', async () => {
      // Research pottery first (no requirements beyond alphabet)
      await researchManager.setCurrentResearch('player-123', 'pottery');

      // Complete pottery research
      const research = researchManager.getPlayerResearch('player-123')!;
      research.researchedTechs.add('pottery');
      research.currentTech = undefined;

      // Now should be able to research animal husbandry (requires pottery)
      await researchManager.setCurrentResearch('player-123', 'animal_husbandry');
      expect(research.currentTech).toBe('animal_husbandry');
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

  describe('research progress', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
      await researchManager.setCurrentResearch('player-123', 'pottery');
    });

    it('should add research points correctly', async () => {
      const completedTech = await researchManager.addResearchPoints('player-123', 5);

      const research = researchManager.getPlayerResearch('player-123');
      expect(research!.bulbsAccumulated).toBe(5);
      expect(research!.bulbsLastTurn).toBe(5);
      expect(completedTech).toBeNull(); // Not enough to complete pottery (costs 10)
    });

    it('should complete technology when enough points accumulated', async () => {
      const completedTech = await researchManager.addResearchPoints('player-123', 10);

      expect(completedTech).toBe('pottery');

      const research = researchManager.getPlayerResearch('player-123');
      expect(research!.researchedTechs.has('pottery')).toBe(true);
      expect(research!.bulbsAccumulated).toBe(0); // Reset after completion
      expect(research!.currentTech).toBeDefined(); // Auto-selects next available tech
    });

    it('should save excess bulbs when completing technology', async () => {
      const completedTech = await researchManager.addResearchPoints('player-123', 15);

      expect(completedTech).toBe('pottery');

      const research = researchManager.getPlayerResearch('player-123');
      expect(research!.bulbsAccumulated).toBe(5); // 15 - 10 = 5 excess
    });

    it('should auto-select next research when goal is set', async () => {
      await researchManager.setResearchGoal('player-123', 'animal_husbandry');

      // Complete pottery
      await researchManager.addResearchPoints('player-123', 10);

      const research = researchManager.getPlayerResearch('player-123');
      expect(research!.currentTech).toBe('animal_husbandry');
      expect(research!.techGoal).toBeUndefined(); // Goal cleared
    });
  });

  describe('available technologies', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
    });

    it('should return technologies available for research', () => {
      const availableTechs = researchManager.getAvailableTechnologies('player-123');

      expect(availableTechs).toHaveLength(4); // pottery, mysticism, mathematics, writing (all require only alphabet)
      expect(availableTechs.map(t => t.id)).toContain('pottery');
      expect(availableTechs.map(t => t.id)).toContain('mysticism');
      expect(availableTechs.map(t => t.id)).toContain('mathematics');
      expect(availableTechs.map(t => t.id)).toContain('writing');
      expect(availableTechs.map(t => t.id)).not.toContain('alphabet'); // Already researched
      expect(availableTechs.map(t => t.id)).not.toContain('bronze_working'); // Missing requirements
    });

    it('should update available technologies as research progresses', async () => {
      // Complete pottery
      const research = researchManager.getPlayerResearch('player-123')!;
      research.researchedTechs.add('pottery');

      const availableTechs = researchManager.getAvailableTechnologies('player-123');

      // Should now include animal_husbandry (requires pottery)
      expect(availableTechs.map(t => t.id)).toContain('animal_husbandry');
      expect(availableTechs.map(t => t.id)).not.toContain('pottery'); // Already researched
    });
  });

  describe('research progress queries', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
      await researchManager.setCurrentResearch('player-123', 'pottery');
    });

    it('should return correct research progress', () => {
      const research = researchManager.getPlayerResearch('player-123')!;
      research.bulbsAccumulated = 7;
      research.bulbsLastTurn = 3;

      const progress = researchManager.getResearchProgress('player-123');

      expect(progress).toEqual({
        current: 7,
        required: 10, // pottery cost
        turnsRemaining: 1, // (10 - 7) / 3 = 1
      });
    });

    it('should return null when no current research', async () => {
      await researchManager.initializePlayerResearch('player-456');

      const progress = researchManager.getResearchProgress('player-456');
      expect(progress).toBeNull();
    });
  });

  describe('technology queries', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
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
      expect(researchManager.canResearch('player-123', 'bronze_working')).toBe(false); // Missing requirements
      expect(researchManager.canResearch('player-123', 'invalid-tech')).toBe(false); // Doesn't exist
    });
  });

  describe('bonus technologies', () => {
    beforeEach(async () => {
      await researchManager.initializePlayerResearch('player-123');
    });

    it('should grant bonus tech for philosophy', async () => {
      // Research prerequisites for philosophy
      const research = researchManager.getPlayerResearch('player-123')!;
      research.researchedTechs.add('writing');
      research.researchedTechs.add('mysticism');

      await researchManager.setCurrentResearch('player-123', 'philosophy');
      const completedTech = await researchManager.addResearchPoints('player-123', 80);

      expect(completedTech).toBe('philosophy');
      expect(research.researchedTechs.has('philosophy')).toBe(true);

      // Should have received a bonus tech
      expect(research.researchedTechs.size).toBeGreaterThan(4); // alphabet + writing + mysticism + philosophy + bonus
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

    it('should handle player without current research', async () => {
      await researchManager.initializePlayerResearch('player-123');

      const completedTech = await researchManager.addResearchPoints('player-123', 10);
      expect(completedTech).toBeNull();
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
      expect(debugInfo.players['player-123'].researchedTechCount).toBe(1);
      expect(debugInfo.players['player-123'].researchedTechs).toContain('alphabet');
    });
  });
});
