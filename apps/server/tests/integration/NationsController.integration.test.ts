import request from 'supertest';
import express from 'express';
import { NationsController } from '../../src/controllers/nationsController';
import { RulesetLoader } from '../../src/shared/data/rulesets/RulesetLoader';
import { setupTestDatabase, cleanupTestDatabase } from '../utils/testDatabase';

// Mock the logger to avoid console noise in tests
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('NationsController - Integration Tests with Real Ruleset Data', () => {
  let app: express.Application;

  beforeAll(async () => {
    // Setup test database (even though this controller doesn't use it directly,
    // it may be needed for other integration scenarios)
    await setupTestDatabase();

    // Initialize RulesetLoader with actual data
    RulesetLoader.getInstance();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(() => {
    // Create fresh Express app for each test
    app = express();
    app.use(express.json());

    // Setup routes
    app.get('/api/nations', NationsController.getNations);
    app.get('/api/nations/:id', NationsController.getNationById);
    app.get('/api/rulesets', NationsController.getRulesets);
    app.get('/api/nations/:id/leaders', NationsController.getNationLeaders);
  });

  describe('GET /api/nations', () => {
    it('should return all nations for default (classic) ruleset', async () => {
      const response = await request(app).get('/api/nations').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.nations).toBeInstanceOf(Array);
      expect(response.body.data.nations.length).toBeGreaterThan(0);
      expect(response.body.data.metadata).toBeDefined();
      expect(response.body.data.metadata.ruleset).toBe('classic');
      expect(response.body.data.metadata.count).toBe(response.body.data.nations.length);

      // Verify nation structure
      const nation = response.body.data.nations[0];
      expect(nation).toHaveProperty('id');
      expect(nation).toHaveProperty('name');
      expect(nation).toHaveProperty('plural');
      expect(nation).toHaveProperty('adjective');
      expect(nation).toHaveProperty('leaders');
      expect(nation.leaders).toBeInstanceOf(Array);
    });

    it('should return nations for specified ruleset', async () => {
      const response = await request(app)
        .get('/api/nations')
        .query({ ruleset: 'classic' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.metadata.ruleset).toBe('classic');
    });

    it('should return 404 for non-existent ruleset', async () => {
      const response = await request(app)
        .get('/api/nations')
        .query({ ruleset: 'nonexistent' })
        .expect(404);

      expect(response.body.error).toBe('Ruleset not found');
      expect(response.body.message).toContain('nonexistent');
    });

    it('should return 400 for invalid ruleset parameter type', async () => {
      const response = await request(app)
        .get('/api/nations')
        .query({ ruleset: 123 }) // Invalid type
        .expect(400);

      expect(response.body.error).toBe('Invalid ruleset parameter');
      expect(response.body.message).toBe('Ruleset must be a string');
    });

    it('should include nation traits and essential properties', async () => {
      const response = await request(app).get('/api/nations').expect(200);

      const nations = response.body.data.nations;
      const romanNation = nations.find((n: any) => n.id === 'romans');

      if (romanNation) {
        expect(romanNation).toHaveProperty('class');
        expect(romanNation).toHaveProperty('style');
        expect(romanNation).toHaveProperty('init_government');
        expect(romanNation).toHaveProperty('traits');
        expect(romanNation).toHaveProperty('flag');
        expect(romanNation).toHaveProperty('legend');
      }
    });
  });

  describe('GET /api/nations/:id', () => {
    it('should return specific nation by ID', async () => {
      const response = await request(app).get('/api/nations/romans').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.nation).toBeDefined();
      expect(response.body.data.nation.id).toBe('romans');
      expect(response.body.data.nation.name).toBeDefined();
      expect(response.body.data.nation.leaders).toBeInstanceOf(Array);
      expect(response.body.data.nation.leaders.length).toBeGreaterThan(0);
    });

    it('should return nation with complete data structure', async () => {
      const response = await request(app).get('/api/nations/romans').expect(200);

      const nation = response.body.data.nation;
      expect(nation).toHaveProperty('id');
      expect(nation).toHaveProperty('name');
      expect(nation).toHaveProperty('plural');
      expect(nation).toHaveProperty('adjective');
      expect(nation).toHaveProperty('class');
      expect(nation).toHaveProperty('style');
      expect(nation).toHaveProperty('init_government');
      expect(nation).toHaveProperty('leaders');
      expect(nation).toHaveProperty('traits');
      expect(nation).toHaveProperty('flag');
      expect(nation).toHaveProperty('legend');
    });

    it('should return 404 for non-existent nation', async () => {
      const response = await request(app).get('/api/nations/nonexistent').expect(404);

      expect(response.body.error).toBe('Nation not found');
      expect(response.body.message).toContain('nonexistent');
    });

    it('should work with different rulesets via query parameter', async () => {
      const response = await request(app)
        .get('/api/nations/romans')
        .query({ ruleset: 'classic' })
        .expect(200);

      expect(response.body.data.nation.id).toBe('romans');
    });

    it('should return 400 for invalid ruleset parameter', async () => {
      const response = await request(app)
        .get('/api/nations/romans')
        .query({ ruleset: ['invalid', 'array'] })
        .expect(400);

      expect(response.body.error).toBe('Invalid ruleset parameter');
    });
  });

  describe('GET /api/rulesets', () => {
    it('should return available rulesets', async () => {
      const response = await request(app).get('/api/rulesets').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.rulesets).toBeInstanceOf(Array);
      expect(response.body.data.rulesets).toContain('classic');
      expect(response.body.data.default).toBe('classic');
    });

    it('should return consistent response structure', async () => {
      const response = await request(app).get('/api/rulesets').expect(200);

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('rulesets');
      expect(response.body.data).toHaveProperty('default');
    });
  });

  describe('GET /api/nations/:id/leaders', () => {
    it('should return leaders for a specific nation', async () => {
      const response = await request(app).get('/api/nations/romans/leaders').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.nation_id).toBe('romans');
      expect(response.body.data.nation_name).toBeDefined();
      expect(response.body.data.leaders).toBeInstanceOf(Array);
      expect(response.body.data.leaders.length).toBeGreaterThan(0);

      // Verify leader structure
      const leader = response.body.data.leaders[0];
      expect(leader).toHaveProperty('name');
      expect(typeof leader.name).toBe('string');
    });

    it('should return leaders with proper nation context', async () => {
      const response = await request(app).get('/api/nations/greeks/leaders').expect(200);

      expect(response.body.data.nation_id).toBe('greeks');
      expect(response.body.data.nation_name).toBeDefined();
      expect(response.body.data.leaders).toBeInstanceOf(Array);
    });

    it('should return 404 for non-existent nation leaders', async () => {
      const response = await request(app).get('/api/nations/nonexistent/leaders').expect(404);

      expect(response.body.error).toBe('Nation not found');
      expect(response.body.message).toContain('nonexistent');
    });

    it('should work with ruleset parameter', async () => {
      const response = await request(app)
        .get('/api/nations/romans/leaders')
        .query({ ruleset: 'classic' })
        .expect(200);

      expect(response.body.data.nation_id).toBe('romans');
      expect(response.body.data.leaders.length).toBeGreaterThan(0);
    });

    it('should return 400 for invalid ruleset parameter', async () => {
      const response = await request(app)
        .get('/api/nations/romans/leaders')
        .query({ ruleset: null })
        .expect(400);

      expect(response.body.error).toBe('Invalid ruleset parameter');
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle malformed requests gracefully', async () => {
      // Test with extremely long nation ID
      const longId = 'a'.repeat(1000);
      const response = await request(app).get(`/api/nations/${longId}`).expect(404);

      expect(response.body.error).toBe('Nation not found');
    });

    it('should handle special characters in nation ID', async () => {
      const response = await request(app).get('/api/nations/test@#$%').expect(404);

      expect(response.body.error).toBe('Nation not found');
    });

    it('should handle concurrent requests properly', async () => {
      // Test concurrent requests to same endpoint
      const promises = Array.from({ length: 10 }, () =>
        request(app).get('/api/nations').expect(200)
      );

      const responses = await Promise.all(promises);

      responses.forEach(response => {
        expect(response.body.success).toBe(true);
        expect(response.body.data.nations).toBeInstanceOf(Array);
      });
    });

    it('should maintain consistent response times for large datasets', async () => {
      const start = Date.now();
      await request(app).get('/api/nations').expect(200);
      const duration = Date.now() - start;

      // Response should be reasonably fast (less than 1 second for local tests)
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('data integrity and validation', () => {
    it('should return consistent nation data across multiple requests', async () => {
      const response1 = await request(app).get('/api/nations/romans').expect(200);
      const response2 = await request(app).get('/api/nations/romans').expect(200);

      expect(response1.body.data.nation).toEqual(response2.body.data.nation);
    });

    it('should validate nation data structure completeness', async () => {
      const response = await request(app).get('/api/nations').expect(200);

      const nations = response.body.data.nations;
      nations.forEach((nation: any) => {
        // Every nation should have required fields
        expect(nation.id).toBeDefined();
        expect(nation.name).toBeDefined();
        expect(nation.leaders).toBeInstanceOf(Array);
        expect(nation.leaders.length).toBeGreaterThan(0);

        // Leaders should have names
        nation.leaders.forEach((leader: any) => {
          expect(leader.name).toBeDefined();
          expect(typeof leader.name).toBe('string');
          expect(leader.name.length).toBeGreaterThan(0);
        });
      });
    });

    it('should ensure unique nation IDs', async () => {
      const response = await request(app).get('/api/nations').expect(200);

      const nations = response.body.data.nations;
      const ids = nations.map((nation: any) => nation.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });
  });
});
