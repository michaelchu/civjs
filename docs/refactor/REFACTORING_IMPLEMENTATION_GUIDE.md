# CivJS Refactoring Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing the large file refactoring identified in the CivJS codebase. It covers the complete process from preparation through validation, ensuring systematic decomposition while maintaining code quality and freeciv compatibility.

## Table of Contents
1. [Pre-Refactoring Preparation](#pre-refactoring-preparation)
2. [Phase-by-Phase Implementation](#phase-by-phase-implementation)
3. [Code Extraction Patterns](#code-extraction-patterns)
4. [Testing Strategies](#testing-strategies)
5. [Quality Gates & Validation](#quality-gates--validation)
6. [Rollback Procedures](#rollback-procedures)

## Pre-Refactoring Preparation

### 1. Environment Setup

```bash
# Create dedicated refactoring branch
git checkout master
git pull origin master
git checkout -b feature/large-files-refactor

# Ensure clean working directory
git status

# Verify all tests pass before starting
npm run test
npm run lint
npm run typecheck
```

### 2. Baseline Metrics Collection

```bash
# Collect current metrics for comparison
npm run test:coverage > baseline-coverage.txt
npm run build > baseline-build.txt

# Create performance baseline (if available)
npm run test:performance > baseline-performance.txt
```

### 3. Backup Strategy

```bash
# Tag current state for easy rollback
git tag refactor-baseline-$(date +%Y%m%d)

# Document current file sizes
find apps/ -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -n > baseline-file-sizes.txt
```

### 4. Dependencies Analysis

Create dependency map for each file to be refactored:
```bash
# Analyze imports for each target file
grep -r "import.*from.*GameManager" apps/server/src/ > dependencies-GameManager.txt
grep -r "import.*from.*TerrainGenerator" apps/server/src/ > dependencies-TerrainGenerator.txt
# Repeat for all critical files
```

## Phase-by-Phase Implementation

### Phase 1: Critical Monster Files (Weeks 1-4)

#### Week 1: TerrainGenerator.ts Refactoring

**Step 1: Create New Component Structure**
```bash
mkdir -p apps/server/src/game/map/terrain/
```

**Step 2: Extract HeightMapProcessor**
```typescript
// apps/server/src/game/map/terrain/HeightMapProcessor.ts
export class HeightMapProcessor {
  private width: number;
  private height: number;
  private random: () => number;

  constructor(width: number, height: number, random: () => number) {
    this.width = width;
    this.height = height;
    this.random = random;
  }

  /**
   * Copy height map values to tile altitude properties
   * @reference freeciv/server/generator/height_map.c height_map_to_map()
   */
  heightMapToTiles(heightMap: number[][], mapData: MapTile[][]): void {
    // Extract height map processing logic from TerrainGenerator
    // Preserve exact freeciv algorithm implementation
  }

  // Additional height map processing methods...
}
```

**Step 3: Extract BiomeGenerator**
```typescript
// apps/server/src/game/map/terrain/BiomeGenerator.ts
export class BiomeGenerator {
  private temperatureMap: TemperatureMap;
  private random: () => number;

  constructor(temperatureMap: TemperatureMap, random: () => number) {
    this.temperatureMap = temperatureMap;
    this.random = random;
  }

  /**
   * Generate biomes based on temperature and moisture
   * @reference freeciv/server/generator/mapgen.c
   */
  generateBiomes(mapData: MapTile[][], params: TerrainParams): void {
    // Extract biome generation logic
  }

  // Additional biome methods...
}
```

**Step 4: Update TerrainGenerator to Use Extracted Components**
```typescript
// apps/server/src/game/map/TerrainGenerator.ts (updated)
import { HeightMapProcessor } from './terrain/HeightMapProcessor';
import { BiomeGenerator } from './terrain/BiomeGenerator';
// ... other imports

export class TerrainGenerator {
  private heightMapProcessor: HeightMapProcessor;
  private biomeGenerator: BiomeGenerator;
  // ... other components

  constructor(width: number, height: number, random: () => number, generator: string) {
    this.width = width;
    this.height = height;
    this.random = random;
    this.generator = generator;
    
    // Initialize extracted components
    this.heightMapProcessor = new HeightMapProcessor(width, height, random);
    this.biomeGenerator = new BiomeGenerator(temperatureMap, random);
    // ...
  }

  generateTerrain(mapData: MapTile[][], params: TerrainParams): void {
    // Orchestrate using extracted components
    this.heightMapProcessor.heightMapToTiles(heightMap, mapData);
    this.biomeGenerator.generateBiomes(mapData, params);
    // ...
  }
}
```

**Step 5: Update Tests**
```typescript
// tests/game/terrain/HeightMapProcessor.test.ts (new)
import { HeightMapProcessor } from '../../../src/game/map/terrain/HeightMapProcessor';

describe('HeightMapProcessor', () => {
  let processor: HeightMapProcessor;

  beforeEach(() => {
    const mockRandom = jest.fn(() => 0.5);
    processor = new HeightMapProcessor(100, 100, mockRandom);
  });

  describe('heightMapToTiles', () => {
    it('should convert height map to tile altitudes', () => {
      // Test extracted functionality
    });
  });
});
```

#### GameManager.ts Refactoring Pattern

**Step 1: Create Manager Structure**
```bash
mkdir -p apps/server/src/game/managers/
```

**Step 2: Extract GameLifecycleManager**
```typescript
// apps/server/src/game/managers/GameLifecycleManager.ts
export class GameLifecycleManager {
  private io: SocketServer;
  private games: Map<string, GameInstance>;

  constructor(io: SocketServer, games: Map<string, GameInstance>) {
    this.io = io;
    this.games = games;
  }

  async createGame(config: GameConfig): Promise<string> {
    // Extract game creation logic
  }

  async startGame(gameId: string): Promise<void> {
    // Extract game start logic
  }

  async endGame(gameId: string, reason: string): Promise<void> {
    // Extract game end logic
  }
}
```

**Step 3: Extract PlayerConnectionManager**
```typescript
// apps/server/src/game/managers/PlayerConnectionManager.ts
export class PlayerConnectionManager {
  private playerToGame: Map<string, string>;
  private io: SocketServer;

  constructor(playerToGame: Map<string, string>, io: SocketServer) {
    this.playerToGame = playerToGame;
    this.io = io;
  }

  async addPlayer(gameId: string, userId: string, civilization: string): Promise<string> {
    // Extract player management logic
  }

  async updatePlayerConnection(playerId: string, isConnected: boolean): Promise<void> {
    // Extract connection management logic
  }
}
```

### Code Extraction Patterns

#### Pattern 1: Single Responsibility Extraction

**Before: Monolithic Class**
```typescript
class LargeManager {
  // 50+ methods handling different concerns
  manageGameState() { /* ... */ }
  handlePlayerConnections() { /* ... */ }
  processGameLogic() { /* ... */ }
  validateInput() { /* ... */ }
  persistData() { /* ... */ }
}
```

**After: Decomposed Classes**
```typescript
// Core manager becomes coordinator
class Manager {
  private gameStateManager: GameStateManager;
  private connectionManager: ConnectionManager;
  private gameLogicProcessor: GameLogicProcessor;
  private inputValidator: InputValidator;
  private dataRepository: DataRepository;

  constructor() {
    this.gameStateManager = new GameStateManager();
    this.connectionManager = new ConnectionManager();
    // ... inject dependencies
  }

  // Delegate to specialized classes
  async processRequest(request: Request): Promise<Response> {
    const validatedRequest = this.inputValidator.validate(request);
    const result = await this.gameLogicProcessor.process(validatedRequest);
    await this.dataRepository.persist(result);
    return result;
  }
}
```

#### Pattern 2: Service Layer Extraction

**Extract Common Interface**
```typescript
// Common interface for all services
export interface GameService {
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
}

// Implement in extracted services
export class CityProductionManager implements GameService {
  async initialize(): Promise<void> {
    // Service initialization
  }

  async cleanup(): Promise<void> {
    // Cleanup logic
  }

  // Service-specific methods
  async updateProduction(cityId: string, production: ProductionItem): Promise<void> {
    // Production logic
  }
}
```

#### Pattern 3: Configuration Object Pattern

**Before: Many Constructor Parameters**
```typescript
class ComplexManager {
  constructor(
    width: number,
    height: number,
    seed: string,
    generator: string,
    param1: number,
    param2: boolean,
    // ... 10+ parameters
  ) {
    // Complex initialization
  }
}
```

**After: Configuration Object**
```typescript
interface ManagerConfig {
  dimensions: { width: number; height: number };
  generation: { seed: string; type: string };
  parameters: { param1: number; param2: boolean };
}

class SimplifiedManager {
  constructor(config: ManagerConfig) {
    // Cleaner initialization
  }
}
```

## Testing Strategies

### 1. Unit Test Migration

**Pattern for Testing Extracted Components**
```typescript
// Test extracted component in isolation
describe('HeightMapProcessor', () => {
  let processor: HeightMapProcessor;
  let mockRandom: jest.Mock;

  beforeEach(() => {
    mockRandom = jest.fn(() => 0.5);
    processor = new HeightMapProcessor(100, 100, mockRandom);
  });

  it('should process height map correctly', () => {
    const heightMap = createTestHeightMap();
    const mapData = createTestMapData();
    
    processor.heightMapToTiles(heightMap, mapData);
    
    expect(mapData[0][0].altitude).toBeDefined();
    // Assert specific behavior
  });
});
```

### 2. Integration Test Updates

**Pattern for Testing Component Integration**
```typescript
// Test that extracted components work together
describe('TerrainGenerator Integration', () => {
  it('should generate terrain using all components', () => {
    const generator = new TerrainGenerator(100, 100, mockRandom, 'FRACTAL');
    const mapData = createEmptyMapData();
    const params = getDefaultTerrainParams();
    
    generator.generateTerrain(mapData, params);
    
    // Verify end-to-end terrain generation
    expect(mapData.some(row => row.some(tile => tile.terrain === 'mountain'))).toBe(true);
  });
});
```

### 3. Performance Test Migration

**Before and After Performance Comparison**
```typescript
describe('Performance Tests', () => {
  it('should maintain performance after refactoring', async () => {
    const startTime = performance.now();
    
    // Execute refactored code
    await refactoredFunction();
    
    const endTime = performance.now();
    const executionTime = endTime - startTime;
    
    // Should not be significantly slower than baseline
    expect(executionTime).toBeLessThan(BASELINE_TIME * 1.1); // 10% tolerance
  });
});
```

## Quality Gates & Validation

### 1. Automated Quality Checks

**Create Quality Gate Script**
```bash
#!/bin/bash
# quality-gate.sh

echo "Running quality checks..."

# Linting
npm run lint
if [ $? -ne 0 ]; then
  echo "❌ Linting failed"
  exit 1
fi

# Type checking
npm run typecheck
if [ $? -ne 0 ]; then
  echo "❌ Type checking failed"
  exit 1
fi

# Tests
npm run test
if [ $? -ne 0 ]; then
  echo "❌ Tests failed"
  exit 1
fi

# Coverage check
npm run test:coverage -- --coverageThreshold='{"global":{"branches":80,"functions":80,"lines":80,"statements":80}}'
if [ $? -ne 0 ]; then
  echo "❌ Coverage below threshold"
  exit 1
fi

echo "✅ All quality gates passed"
```

### 2. Performance Validation

**Performance Comparison Script**
```typescript
// performance-validator.ts
import { performance } from 'perf_hooks';

class PerformanceValidator {
  async validateRefactoring(originalFunction: Function, refactoredFunction: Function): Promise<boolean> {
    const iterations = 100;
    
    // Test original
    const originalTimes = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await originalFunction();
      originalTimes.push(performance.now() - start);
    }
    
    // Test refactored
    const refactoredTimes = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await refactoredFunction();
      refactoredTimes.push(performance.now() - start);
    }
    
    const originalAvg = originalTimes.reduce((a, b) => a + b) / originalTimes.length;
    const refactoredAvg = refactoredTimes.reduce((a, b) => a + b) / refactoredTimes.length;
    
    // Allow 10% performance degradation
    return refactoredAvg <= originalAvg * 1.1;
  }
}
```

### 3. freeciv Compatibility Validation

**Compatibility Test Suite**
```typescript
// freeciv-compatibility.test.ts
describe('freeciv Compatibility', () => {
  it('should generate terrain matching freeciv algorithms', () => {
    const generator = new TerrainGenerator(100, 100, () => 0.5, 'FRACTAL');
    const mapData = generator.generate();
    
    // Validate against freeciv reference implementation
    expect(validateFreecivCompatibility(mapData)).toBe(true);
  });

  it('should preserve original game mechanics', () => {
    // Test that extracted components preserve game behavior
  });
});
```

## Rollback Procedures

### 1. Immediate Rollback

**If critical issues are discovered:**
```bash
# Revert to baseline tag
git reset --hard refactor-baseline-$(date +%Y%m%d)

# Or revert specific commits
git revert <commit-hash> --no-edit

# Verify system is working
npm run test
```

### 2. Partial Rollback

**If specific component extraction fails:**
```bash
# Revert specific file changes
git checkout HEAD~1 -- apps/server/src/game/GameManager.ts

# Remove extracted components
rm -rf apps/server/src/game/managers/

# Update imports back to original
# Run tests to verify stability
```

### 3. Rollback Validation

**After any rollback:**
```bash
# Verify all tests pass
npm run test

# Check performance hasn't degraded
npm run test:performance

# Validate no regressions
npm run test:integration

# Confirm freeciv compatibility
npm run test:freeciv-compatibility
```

## Success Criteria Checklist

After each extraction, verify:

- [ ] All tests pass
- [ ] No performance degradation (within 10%)
- [ ] ESLint and TypeScript checks pass
- [ ] Test coverage maintained or improved
- [ ] No breaking changes to public APIs
- [ ] freeciv compatibility preserved
- [ ] Documentation updated
- [ ] Code review completed

## Common Pitfalls & Solutions

### 1. Circular Dependencies
**Problem**: Extracted classes depend on each other
**Solution**: Use dependency injection and interfaces

### 2. Performance Degradation
**Problem**: Multiple small classes slower than single large class
**Solution**: Optimize hot paths, consider lazy loading

### 3. Lost Context
**Problem**: Related logic scattered across files
**Solution**: Maintain clear interfaces and documentation

### 4. Over-extraction
**Problem**: Too many small classes
**Solution**: Balance between cohesion and separation

This implementation guide provides the systematic approach needed to successfully refactor the identified large files while maintaining system quality and stability.