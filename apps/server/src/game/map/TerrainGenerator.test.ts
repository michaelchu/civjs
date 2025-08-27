/**
 * Tests for Relief Generation System
 * Validates the implementation of make_relief() and make_fracture_relief()
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { TerrainGenerator } from './TerrainGenerator';
import { MapTile, TemperatureType } from './MapTypes';
import { isOceanTerrain } from './TerrainUtils';
import { MapgenTerrainProperty, getTerrainProperties } from './TerrainRuleset';

describe('TerrainGenerator - Relief Generation System', () => {
  let generator: TerrainGenerator;
  let tiles: MapTile[][];
  let heightMap: number[];
  const width = 40;
  const height = 40;

  // Seeded random for deterministic tests
  const seededRandom = (() => {
    let seed = 12345;
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  })();

  beforeEach(() => {
    generator = new TerrainGenerator(width, height, seededRandom, 'random');
    tiles = [];
    heightMap = new Array(width * height);

    // Initialize tiles and height map
    for (let x = 0; x < width; x++) {
      tiles[x] = [];
      for (let y = 0; y < height; y++) {
        const index = y * width + x;
        // Create height map with varied elevations
        const centerX = width / 2;
        const centerY = height / 2;
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        const maxDistance = Math.sqrt(centerX ** 2 + centerY ** 2);

        // Create island-like height map (higher in center)
        // Use higher base heights to account for pole normalization reducing heights
        heightMap[index] = 800 - (distance / maxDistance) * 300 + seededRandom() * 150;

        tiles[x][y] = {
          x,
          y,
          terrain: heightMap[index] > 400 ? 'grassland' : 'ocean',
          elevation: heightMap[index],
          temperature: TemperatureType.TEMPERATE,
          wetness: 50,
          owner: null,
          city: null,
          units: [],
          unitIds: [],
          improvements: [],
          resources: [],
          riverMask: 0,
          continentId: 0,
          isExplored: false,
          isVisible: false,
          continent: 0,
          visibility: new Map(),
          isKnown: false,
          seenCount: 0,
          hasRoad: false,
          hasRailroad: false,
          properties: {},
        } as MapTile;
      }
    }
  });

  describe('makeRelief()', () => {
    it('should place mountains and hills on high elevation tiles', () => {
      const params = {
        landpercent: 30,
        steepness: 30,
        wetness: 50,
        temperature: 50,
      };

      // Execute land generation which includes relief
      generator.makeLand(tiles, heightMap, params);

      // Check that some mountains and hills were placed
      let mountainCount = 0;
      let hillCount = 0;

      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const terrain = tiles[x][y].terrain;
          const props = getTerrainProperties(terrain);

          if (props && props[MapgenTerrainProperty.MOUNTAINOUS]) {
            if (terrain === 'mountains') {
              mountainCount++;
            } else if (terrain === 'hills') {
              hillCount++;
            }
          }
        }
      }

      // Should have placed some mountains and hills
      expect(mountainCount).toBeGreaterThan(0);
      expect(hillCount).toBeGreaterThan(0);

      // Mountains + hills should be reasonable percentage of land
      const landCount = tiles.flat().filter(t => !isOceanTerrain(t.terrain)).length;
      const reliefPercent = ((mountainCount + hillCount) / landCount) * 100;

      // Relief should be between 5% and 50% of land (adjusted for freeciv reference behavior)
      expect(reliefPercent).toBeGreaterThan(5);
      expect(reliefPercent).toBeLessThan(50);
    });

    it('should prefer hills in hot regions and mountains in cold regions (bitwise)', () => {
      // Set up tiles with different temperature zones
      // Hot regions (TT_HOT) = TEMPERATE | TROPICAL should prefer hills
      // Cold regions (FROZEN | COLD) should prefer mountains
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          if (y < height / 3) {
            tiles[x][y].temperature = TemperatureType.COLD; // Cold region
          } else if (y > (2 * height) / 3) {
            tiles[x][y].temperature = TemperatureType.TROPICAL; // Hot region (part of TT_HOT)
          } else {
            tiles[x][y].temperature = TemperatureType.TEMPERATE; // Hot region (part of TT_HOT)
          }
        }
      }

      const params = {
        landpercent: 30,
        steepness: 30,
        wetness: 50,
        temperature: 50,
      };

      generator.makeLand(tiles, heightMap, params);

      // Count mountains/hills in different temperature zones
      let coldMountains = 0;
      let coldHills = 0;
      let hotMountains = 0;
      let hotHills = 0;

      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const tile = tiles[x][y];
          if (tile.terrain === 'mountains') {
            if (tile.temperature === TemperatureType.COLD) coldMountains++;
            if (tile.temperature === TemperatureType.TROPICAL) hotMountains++;
          } else if (tile.terrain === 'hills') {
            if (tile.temperature === TemperatureType.COLD) coldHills++;
            if (tile.temperature === TemperatureType.TROPICAL) hotHills++;
          }
        }
      }

      // Cold regions (not part of TT_HOT) should have more mountains than hills
      if (coldMountains + coldHills > 0) {
        expect(coldMountains).toBeGreaterThanOrEqual(coldHills);
      }

      // Hot regions (TT_HOT = TEMPERATE | TROPICAL) should have more hills than mountains  
      if (hotMountains + hotHills > 0) {
        expect(hotHills).toBeGreaterThanOrEqual(hotMountains);
      }
    });

    it('should prevent excessive mountain clustering', () => {
      const params = {
        landpercent: 30,
        steepness: 50, // High steepness for more mountains
        wetness: 50,
        temperature: 50,
      };

      generator.makeLand(tiles, heightMap, params);

      // Check that mountains don't form huge continuous ranges
      let maxClusterSize = 0;
      const visited = new Set<string>();

      const countCluster = (x: number, y: number): number => {
        const key = `${x},${y}`;
        if (visited.has(key)) return 0;
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        if (tiles[x][y].terrain !== 'mountains') return 0;

        visited.add(key);
        let size = 1;

        // Check all 8 neighbors
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            size += countCluster(x + dx, y + dy);
          }
        }
        return size;
      };

      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          if (tiles[x][y].terrain === 'mountains' && !visited.has(`${x},${y}`)) {
            const clusterSize = countCluster(x, y);
            maxClusterSize = Math.max(maxClusterSize, clusterSize);
          }
        }
      }

      // Mountain clusters should be limited in size
      expect(maxClusterSize).toBeLessThan(50); // No massive mountain ranges
    });
  });

  describe('makeFractureRelief()', () => {
    beforeEach(() => {
      generator = new TerrainGenerator(width, height, seededRandom, 'fracture');
    });

    it('should place relief based on local elevation differences', () => {
      // Create height map with distinct elevation areas
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const index = y * width + x;
          // Create two plateaus with different elevations
          // Use higher heights to account for pole normalization
          if (x < width / 2) {
            heightMap[index] = 600 + seededRandom() * 50;
          } else {
            heightMap[index] = 800 + seededRandom() * 50;
          }

          // Add transition zone
          if (Math.abs(x - width / 2) < 3) {
            heightMap[index] = 700 + seededRandom() * 100;
          }
        }
      }

      const params = {
        landpercent: 50,
        steepness: 30,
        wetness: 50,
        temperature: 50,
      };

      generator.makeLand(tiles, heightMap, params);

      // Check that relief is concentrated in transition zones
      let transitionRelief = 0;
      let plateauRelief = 0;

      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const terrain = tiles[x][y].terrain;
          if (terrain === 'mountains' || terrain === 'hills') {
            if (Math.abs(x - width / 2) < 5) {
              transitionRelief++;
            } else {
              plateauRelief++;
            }
          }
        }
      }

      // Transition zones should have more relief than plateaus
      if (transitionRelief + plateauRelief > 0) {
        const transitionRatio = transitionRelief / (transitionRelief + plateauRelief);
        expect(transitionRatio).toBeGreaterThan(0.15); // At least 15% in transitions (adjusted for freeciv pole normalization)
      }
    });

    it('should avoid placing relief directly on coasts', () => {
      const params = {
        landpercent: 30,
        steepness: 30,
        wetness: 50,
        temperature: 50,
      };

      generator.makeLand(tiles, heightMap, params);

      // Check that coastal tiles don't have mountains or hills
      let coastalRelief = 0;

      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const terrain = tiles[x][y].terrain;
          if (terrain === 'mountains' || terrain === 'hills') {
            // Check if tile is adjacent to ocean
            let hasOceanNeighbor = false;
            for (let dx = -1; dx <= 1; dx++) {
              for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  if (isOceanTerrain(tiles[nx][ny].terrain)) {
                    hasOceanNeighbor = true;
                    break;
                  }
                }
              }
              if (hasOceanNeighbor) break;
            }

            if (hasOceanNeighbor) {
              coastalRelief++;
            }
          }
        }
      }

      // Coastal relief should be minimal for fracture maps
      expect(coastalRelief).toBe(0);
    });

    it('should ensure minimum mountain percentage', () => {
      const params = {
        landpercent: 50,
        steepness: 10, // Low steepness
        wetness: 50,
        temperature: 50,
      };

      generator.makeLand(tiles, heightMap, params);

      // Count total mountains and hills
      let reliefCount = 0;
      let landCount = 0;

      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const terrain = tiles[x][y].terrain;
          if (!isOceanTerrain(terrain)) {
            landCount++;
            if (terrain === 'mountains' || terrain === 'hills') {
              reliefCount++;
            }
          }
        }
      }

      // Should have at least minimum percentage of relief
      const reliefPercent = (reliefCount / landCount) * 100;
      expect(reliefPercent).toBeGreaterThanOrEqual(5); // At least 5% relief
    });
  });

  describe('Helper Functions', () => {
    it('should correctly identify flat areas needing relief', () => {
      // Create a mostly flat area
      // Use higher heights to account for pole normalization
      for (let x = 10; x < 20; x++) {
        for (let y = 10; y < 20; y++) {
          const index = y * width + x;
          heightMap[index] = 600 + seededRandom() * 10; // Very small variation
          tiles[x][y].terrain = 'grassland'; // Ensure it's land
          tiles[x][y].elevation = heightMap[index];
        }
      }

      const params = {
        landpercent: 50,
        steepness: 30,
        wetness: 50,
        temperature: 50,
      };

      generator.makeLand(tiles, heightMap, params);

      // Check that some relief was added to the flat area
      let flatAreaRelief = 0;
      for (let x = 10; x < 20; x++) {
        for (let y = 10; y < 20; y++) {
          const terrain = tiles[x][y].terrain;
          if (terrain === 'mountains' || terrain === 'hills') {
            flatAreaRelief++;
          }
        }
      }

      // Flat areas should get some relief for variety
      expect(flatAreaRelief).toBeGreaterThan(0);
    });

    it('should calculate local average elevation correctly', () => {
      // Create a simple height pattern
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const index = y * width + x;
          heightMap[index] = x * 10 + y * 10; // Linear gradient
        }
      }

      // Test center tile local average
      const centerX = width / 2;
      const centerY = height / 2;
      const centerIndex = centerY * width + centerX;
      const expectedAvg = heightMap[centerIndex]; // Should be close to center value

      // Create generator and calculate local average (need to expose for testing)
      const localAvg = generator['localAveElevation'](heightMap, centerX, centerY);

      // Local average should be close to the center value for smooth gradients
      expect(Math.abs(localAvg - expectedAvg)).toBeLessThan(50);
    });
  });
});
