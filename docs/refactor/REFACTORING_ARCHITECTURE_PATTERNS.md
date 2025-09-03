# CivJS Refactoring Architecture Patterns

## Overview

This document defines the architectural patterns, principles, and guidelines to follow when refactoring large files in the CivJS codebase. These patterns ensure consistency, maintainability, and compatibility with the existing freeciv-based architecture.

## Table of Contents
1. [Core Architectural Principles](#core-architectural-principles)
2. [Service Layer Organization](#service-layer-organization)
3. [Interface Design Patterns](#interface-design-patterns)
4. [Dependency Injection Patterns](#dependency-injection-patterns)
5. [Manager-Service-Repository Pattern](#manager-service-repository-pattern)
6. [Event-Driven Architecture](#event-driven-architecture)
7. [freeciv Compatibility Patterns](#freeciv-compatibility-patterns)
8. [Performance Optimization Patterns](#performance-optimization-patterns)

---

## Core Architectural Principles

### 1. Single Responsibility Principle (SRP)
Each extracted component should have one clear responsibility.

**Before: Violating SRP**
```typescript
class GameManager {
  // Game lifecycle management
  createGame() { /* */ }
  startGame() { /* */ }
  
  // Player management  
  addPlayer() { /* */ }
  removePlayer() { /* */ }
  
  // State persistence
  saveGame() { /* */ }
  loadGame() { /* */ }
  
  // Real-time communication
  broadcastToPlayers() { /* */ }
}
```

**After: Following SRP**
```typescript
// Each class has single responsibility
class GameLifecycleManager {
  createGame() { /* */ }
  startGame() { /* */ }
}

class PlayerManager {
  addPlayer() { /* */ }
  removePlayer() { /* */ }
}

class GameStateManager {
  saveGame() { /* */ }
  loadGame() { /* */ }
}

class GameBroadcastManager {
  broadcastToPlayers() { /* */ }
}

// Coordinator follows SRP too - just coordinates
class GameManager {
  constructor(
    private lifecycle: GameLifecycleManager,
    private players: PlayerManager,
    private state: GameStateManager,
    private broadcast: GameBroadcastManager
  ) {}
  
  // Delegates to appropriate managers
}
```

### 2. Open/Closed Principle (OCP)
Components should be open for extension but closed for modification.

**Interface-Based Extension Pattern**
```typescript
interface TerrainProcessor {
  processTerrainType(tile: MapTile, params: TerrainParams): void;
}

class HeightMapProcessor implements TerrainProcessor {
  processTerrainType(tile: MapTile, params: TerrainParams): void {
    // Height-based processing
  }
}

class BiomeProcessor implements TerrainProcessor {
  processTerrainType(tile: MapTile, params: TerrainParams): void {
    // Biome-based processing
  }
}

// Extensible without modifying existing code
class TerrainGenerator {
  private processors: TerrainProcessor[] = [];
  
  addProcessor(processor: TerrainProcessor): void {
    this.processors.push(processor);
  }
  
  generateTerrain(mapData: MapTile[][], params: TerrainParams): void {
    for (const processor of this.processors) {
      // Process with each processor
    }
  }
}
```

### 3. Dependency Inversion Principle (DIP)
Depend on abstractions, not concrete implementations.

**Dependency Inversion Pattern**
```typescript
// Abstract interface
interface MapDataRepository {
  save(mapData: MapData): Promise<void>;
  load(mapId: string): Promise<MapData>;
}

// Concrete implementations
class DatabaseMapRepository implements MapDataRepository {
  async save(mapData: MapData): Promise<void> {
    // Database implementation
  }
  
  async load(mapId: string): Promise<MapData> {
    // Database implementation
  }
}

class FileMapRepository implements MapDataRepository {
  async save(mapData: MapData): Promise<void> {
    // File system implementation
  }
  
  async load(mapId: string): Promise<MapData> {
    // File system implementation  
  }
}

// High-level module depends on abstraction
class MapManager {
  constructor(private repository: MapDataRepository) {}
  
  async saveMap(mapData: MapData): Promise<void> {
    return this.repository.save(mapData);
  }
}
```

---

## Service Layer Organization

### 1. Service Hierarchy Pattern

Organize services in clear hierarchical layers:

```
Application Layer (Controllers/Handlers)
├── Domain Services (Business Logic)
├── Application Services (Use Cases)
└── Infrastructure Services (Technical Concerns)
```

**Implementation Structure**
```typescript
// Domain Services - Pure business logic
export class CityProductionService {
  calculateProduction(city: City, improvements: Building[]): ProductionResult {
    // Pure business logic, no external dependencies
  }
}

// Application Services - Use cases and workflows
export class CityManagementService {
  constructor(
    private productionService: CityProductionService,
    private cityRepository: CityRepository,
    private eventBus: EventBus
  ) {}
  
  async updateCityProduction(cityId: string, production: ProductionItem): Promise<void> {
    // Orchestrates domain services and infrastructure
    const city = await this.cityRepository.findById(cityId);
    const result = this.productionService.calculateProduction(city, city.buildings);
    await this.cityRepository.save(city);
    this.eventBus.emit('city.production.updated', { cityId, result });
  }
}

// Infrastructure Services - Technical implementations
export class DatabaseCityRepository implements CityRepository {
  async findById(cityId: string): Promise<City> {
    // Database-specific implementation
  }
  
  async save(city: City): Promise<void> {
    // Database-specific implementation
  }
}
```

### 2. Service Registration Pattern

**Service Registry for Dependency Management**
```typescript
// Service registry for clean dependency management
export class ServiceRegistry {
  private services = new Map<string, any>();
  
  register<T>(key: string, service: T): void {
    this.services.set(key, service);
  }
  
  get<T>(key: string): T {
    const service = this.services.get(key);
    if (!service) {
      throw new Error(`Service not found: ${key}`);
    }
    return service;
  }
}

// Usage in extracted components
export class GameManager {
  private lifecycle: GameLifecycleManager;
  private players: PlayerManager;
  
  constructor(registry: ServiceRegistry) {
    this.lifecycle = registry.get<GameLifecycleManager>('GameLifecycleManager');
    this.players = registry.get<PlayerManager>('PlayerManager');
  }
}
```

---

## Interface Design Patterns

### 1. Command Pattern for Actions

Use command pattern for game actions to maintain consistency and enable features like undo/redo:

```typescript
// Base command interface
interface GameCommand<T = any> {
  execute(): Promise<T>;
  undo?(): Promise<void>;
  canExecute(): boolean;
  getDescription(): string;
}

// Specific command implementations
class MoveUnitCommand implements GameCommand<UnitMoveResult> {
  constructor(
    private unitId: string,
    private destination: Position,
    private unitManager: UnitManager
  ) {}
  
  async execute(): Promise<UnitMoveResult> {
    return this.unitManager.moveUnit(this.unitId, this.destination);
  }
  
  async undo(): Promise<void> {
    // Implement undo logic
  }
  
  canExecute(): boolean {
    return this.unitManager.canMoveUnit(this.unitId, this.destination);
  }
  
  getDescription(): string {
    return `Move unit ${this.unitId} to ${this.destination}`;
  }
}

// Command processor
class GameCommandProcessor {
  private history: GameCommand[] = [];
  
  async execute<T>(command: GameCommand<T>): Promise<T> {
    if (!command.canExecute()) {
      throw new Error(`Cannot execute command: ${command.getDescription()}`);
    }
    
    const result = await command.execute();
    this.history.push(command);
    return result;
  }
  
  async undo(): Promise<void> {
    const command = this.history.pop();
    if (command?.undo) {
      await command.undo();
    }
  }
}
```

### 2. Strategy Pattern for Algorithms

Use strategy pattern for interchangeable algorithms (especially important for freeciv compatibility):

```typescript
// Strategy interface
interface TerrainGenerationStrategy {
  generateTerrain(width: number, height: number, params: TerrainParams): MapTile[][];
  getName(): string;
  isCompatibleWith(ruleSet: string): boolean;
}

// Concrete strategies
class FractalTerrainStrategy implements TerrainGenerationStrategy {
  generateTerrain(width: number, height: number, params: TerrainParams): MapTile[][] {
    // Fractal algorithm implementation (freeciv-compatible)
  }
  
  getName(): string {
    return 'FRACTAL';
  }
  
  isCompatibleWith(ruleSet: string): boolean {
    return ruleSet === 'classic' || ruleSet === 'civ2civ3';
  }
}

class IslandTerrainStrategy implements TerrainGenerationStrategy {
  generateTerrain(width: number, height: number, params: TerrainParams): MapTile[][] {
    // Island algorithm implementation (freeciv-compatible)
  }
  
  getName(): string {
    return 'ISLAND';
  }
  
  isCompatibleWith(ruleSet: string): boolean {
    return true; // Compatible with all rulesets
  }
}

// Context using strategies
class TerrainGenerator {
  private strategies = new Map<string, TerrainGenerationStrategy>();
  
  constructor() {
    this.registerStrategy(new FractalTerrainStrategy());
    this.registerStrategy(new IslandTerrainStrategy());
  }
  
  registerStrategy(strategy: TerrainGenerationStrategy): void {
    this.strategies.set(strategy.getName(), strategy);
  }
  
  generateTerrain(type: string, width: number, height: number, params: TerrainParams): MapTile[][] {
    const strategy = this.strategies.get(type);
    if (!strategy) {
      throw new Error(`Unknown terrain generation strategy: ${type}`);
    }
    
    return strategy.generateTerrain(width, height, params);
  }
}
```

### 3. Observer Pattern for Events

Use observer pattern for loose coupling between components:

```typescript
// Event system interface
interface GameEvent {
  type: string;
  timestamp: Date;
  data: any;
}

interface GameEventListener<T = any> {
  handle(event: GameEvent & { data: T }): void | Promise<void>;
}

// Event bus implementation
class GameEventBus {
  private listeners = new Map<string, Set<GameEventListener>>();
  
  subscribe<T>(eventType: string, listener: GameEventListener<T>): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);
  }
  
  unsubscribe<T>(eventType: string, listener: GameEventListener<T>): void {
    this.listeners.get(eventType)?.delete(listener);
  }
  
  async emit<T>(eventType: string, data: T): Promise<void> {
    const event: GameEvent = {
      type: eventType,
      timestamp: new Date(),
      data
    };
    
    const eventListeners = this.listeners.get(eventType);
    if (eventListeners) {
      const promises = Array.from(eventListeners).map(listener => 
        Promise.resolve(listener.handle(event))
      );
      await Promise.all(promises);
    }
  }
}

// Usage in extracted components
class CityManager implements GameEventListener<UnitCreatedEvent> {
  constructor(private eventBus: GameEventBus) {
    this.eventBus.subscribe('unit.created', this);
  }
  
  async handle(event: GameEvent & { data: UnitCreatedEvent }): Promise<void> {
    // React to unit creation event
    if (event.data.unitType === 'settler') {
      await this.prepareForCityFounding(event.data.unitId);
    }
  }
  
  private async createCity(name: string, position: Position): Promise<string> {
    const cityId = await this.cityRepository.create({ name, position });
    
    // Emit event for other managers
    this.eventBus.emit('city.created', { cityId, name, position });
    
    return cityId;
  }
}
```

---

## Dependency Injection Patterns

### 1. Constructor Injection Pattern

Primary pattern for dependency injection in extracted components:

```typescript
// Define clear interfaces
interface CityRepository {
  findById(id: string): Promise<City>;
  save(city: City): Promise<void>;
  findByPlayerId(playerId: string): Promise<City[]>;
}

interface CityValidationService {
  validateCityName(name: string): boolean;
  validateCityPosition(position: Position, existingCities: City[]): boolean;
}

// Implementation with constructor injection
class CityManager {
  constructor(
    private cityRepository: CityRepository,
    private validationService: CityValidationService,
    private eventBus: GameEventBus,
    private logger: Logger
  ) {}
  
  async createCity(playerId: string, name: string, position: Position): Promise<string> {
    // Use injected dependencies
    const existingCities = await this.cityRepository.findByPlayerId(playerId);
    
    if (!this.validationService.validateCityName(name)) {
      throw new Error('Invalid city name');
    }
    
    if (!this.validationService.validateCityPosition(position, existingCities)) {
      throw new Error('Invalid city position');
    }
    
    const city = new City(playerId, name, position);
    await this.cityRepository.save(city);
    
    this.eventBus.emit('city.created', { cityId: city.id, playerId, name, position });
    this.logger.info(`City created: ${name} at ${position}`, { playerId, cityId: city.id });
    
    return city.id;
  }
}
```

### 2. Factory Pattern for Complex Object Creation

Use factories for creating complex objects with multiple dependencies:

```typescript
// Factory interface
interface GameManagerFactory {
  createGameManager(gameConfig: GameConfig): Promise<GameManager>;
}

// Factory implementation
class GameManagerFactoryImpl implements GameManagerFactory {
  constructor(
    private serviceRegistry: ServiceRegistry,
    private database: Database,
    private io: SocketServer
  ) {}
  
  async createGameManager(gameConfig: GameConfig): Promise<GameManager> {
    // Create all required dependencies
    const gameStateManager = new GameStateManager(this.database);
    const playerManager = new PlayerManager(this.database, this.io);
    const lifecycleManager = new GameLifecycleManager(gameStateManager, playerManager);
    const broadcastManager = new GameBroadcastManager(this.io);
    
    // Register in service registry
    this.serviceRegistry.register('GameStateManager', gameStateManager);
    this.serviceRegistry.register('PlayerManager', playerManager);
    this.serviceRegistry.register('GameLifecycleManager', lifecycleManager);
    this.serviceRegistry.register('GameBroadcastManager', broadcastManager);
    
    // Create and return game manager
    return new GameManager(
      lifecycleManager,
      playerManager,
      gameStateManager,
      broadcastManager,
      gameConfig
    );
  }
}
```

---

## Manager-Service-Repository Pattern

### Architecture Overview

```
Controllers/Handlers (API Layer)
├── Managers (Coordination & Orchestration)
├── Services (Business Logic)
├── Repositories (Data Access)
└── Models/Entities (Data Structures)
```

### 1. Manager Layer Pattern

Managers coordinate between services and handle cross-cutting concerns:

```typescript
// Manager coordinates multiple services
class CityManager {
  constructor(
    private productionService: CityProductionService,
    private growthService: CityGrowthService,
    private improvementService: CityImprovementService,
    private cityRepository: CityRepository,
    private eventBus: GameEventBus
  ) {}
  
  async processCityTurn(cityId: string): Promise<CityTurnResult> {
    const city = await this.cityRepository.findById(cityId);
    
    // Coordinate multiple services
    const productionResult = await this.productionService.processProduction(city);
    const growthResult = await this.growthService.processGrowth(city);
    const improvementResult = await this.improvementService.processImprovements(city);
    
    // Update city state
    city.applyTurnResults(productionResult, growthResult, improvementResult);
    await this.cityRepository.save(city);
    
    // Emit events for other managers
    this.eventBus.emit('city.turn.processed', {
      cityId,
      productionResult,
      growthResult,
      improvementResult
    });
    
    return new CityTurnResult(productionResult, growthResult, improvementResult);
  }
}
```

### 2. Service Layer Pattern

Services contain pure business logic without external dependencies:

```typescript
// Pure business logic service
class CityProductionService {
  calculateProductionOutput(
    city: City,
    improvements: Building[],
    resources: Resource[]
  ): ProductionOutput {
    let baseProduction = city.population * 2; // Base production per citizen
    
    // Add building bonuses
    for (const building of improvements) {
      baseProduction += building.productionBonus;
    }
    
    // Add resource bonuses
    for (const resource of resources) {
      if (resource.type === 'production') {
        baseProduction += resource.bonus;
      }
    }
    
    return new ProductionOutput(baseProduction, improvements, resources);
  }
  
  canCompleteProduction(city: City, item: ProductionItem): boolean {
    const output = this.calculateProductionOutput(city, city.buildings, city.resources);
    return city.accumulatedProduction + output.total >= item.cost;
  }
}
```

### 3. Repository Layer Pattern

Repositories handle data persistence with clear interfaces:

```typescript
// Repository interface
interface CityRepository {
  findById(id: string): Promise<City | null>;
  findByGameId(gameId: string): Promise<City[]>;
  findByPlayerId(playerId: string): Promise<City[]>;
  save(city: City): Promise<void>;
  delete(id: string): Promise<void>;
}

// Database implementation
class DatabaseCityRepository implements CityRepository {
  constructor(private db: Database) {}
  
  async findById(id: string): Promise<City | null> {
    const cityData = await this.db
      .select()
      .from(cities)
      .where(eq(cities.id, id))
      .limit(1);
    
    return cityData.length > 0 ? this.mapToCity(cityData[0]) : null;
  }
  
  async save(city: City): Promise<void> {
    const cityData = this.mapToCityData(city);
    
    await this.db
      .insert(cities)
      .values(cityData)
      .onConflictDoUpdate({
        target: cities.id,
        set: cityData
      });
  }
  
  private mapToCity(data: any): City {
    // Map database data to domain object
    return new City(data.id, data.playerId, data.name, data.position);
  }
  
  private mapToCityData(city: City): any {
    // Map domain object to database data
    return {
      id: city.id,
      playerId: city.playerId,
      name: city.name,
      position: city.position
    };
  }
}
```

---

## Event-Driven Architecture

### 1. Domain Events Pattern

Use domain events to decouple business logic:

```typescript
// Domain event base class
abstract class DomainEvent {
  public readonly occurredOn: Date;
  public readonly eventId: string;
  
  constructor() {
    this.occurredOn = new Date();
    this.eventId = crypto.randomUUID();
  }
  
  abstract getEventType(): string;
}

// Specific domain events
class CityFoundedEvent extends DomainEvent {
  constructor(
    public readonly cityId: string,
    public readonly playerId: string,
    public readonly cityName: string,
    public readonly position: Position
  ) {
    super();
  }
  
  getEventType(): string {
    return 'city.founded';
  }
}

// Aggregate root with events
class City {
  private events: DomainEvent[] = [];
  
  constructor(
    public readonly id: string,
    public readonly playerId: string,
    public name: string,
    public position: Position
  ) {}
  
  static found(playerId: string, name: string, position: Position): City {
    const city = new City(crypto.randomUUID(), playerId, name, position);
    city.addEvent(new CityFoundedEvent(city.id, playerId, name, position));
    return city;
  }
  
  getUncommittedEvents(): DomainEvent[] {
    return [...this.events];
  }
  
  markEventsAsCommitted(): void {
    this.events = [];
  }
  
  private addEvent(event: DomainEvent): void {
    this.events.push(event);
  }
}

// Event handler
class CityFoundedEventHandler {
  constructor(
    private visibilityManager: VisibilityManager,
    private mapManager: MapManager
  ) {}
  
  async handle(event: CityFoundedEvent): Promise<void> {
    // Update visibility around new city
    await this.visibilityManager.updateVisibilityAroundPosition(
      event.playerId,
      event.position,
      2 // City sight radius
    );
    
    // Update map state
    await this.mapManager.markPositionAsOccupied(event.position, 'city');
  }
}
```

---

## freeciv Compatibility Patterns

### 1. Algorithm Preservation Pattern

Maintain exact freeciv algorithm compatibility:

```typescript
/**
 * Freeciv-compatible terrain generation
 * @reference freeciv/server/generator/mapgen.c:1234-1456
 * 
 * This implementation preserves the exact algorithm from freeciv
 * to ensure compatibility with existing rulesets and game mechanics.
 */
class FreecivCompatibleTerrainGenerator {
  /**
   * Generate fractal terrain using freeciv's exact algorithm
   * @reference freeciv/server/generator/mapgen.c:make_fractal_terrain()
   */
  makeFractalTerrain(heightMap: number[][], mapData: MapTile[][]): void {
    // Exact implementation from freeciv source
    // DO NOT MODIFY - maintains freeciv compatibility
    
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const height = heightMap[x][y];
        
        // Use exact freeciv terrain assignment logic
        if (height < OCEAN_LEVEL) {
          mapData[x][y].terrain = 'ocean';
        } else if (height > MOUNTAIN_LEVEL) {
          mapData[x][y].terrain = 'mountain';
        } else {
          // Apply freeciv's terrain selection algorithm
          mapData[x][y].terrain = this.selectTerrainByFreecivRules(height, x, y);
        }
      }
    }
  }
  
  /**
   * Terrain selection following freeciv rules
   * @reference freeciv/server/generator/temperature_map.c
   */
  private selectTerrainByFreecivRules(height: number, x: number, y: number): TerrainType {
    // Exact freeciv terrain selection logic
    // Preserved for compatibility
  }
}
```

### 2. Ruleset Compatibility Pattern

Support multiple freeciv rulesets:

```typescript
// Ruleset abstraction
interface FreecivRuleset {
  getName(): string;
  getVersion(): string;
  getTerrainRules(): TerrainRules;
  getUnitRules(): UnitRules;
  getCityRules(): CityRules;
  isCompatibleWith(version: string): boolean;
}

// Classic freeciv ruleset implementation
class ClassicFreecivRuleset implements FreecivRuleset {
  getName(): string {
    return 'classic';
  }
  
  getVersion(): string {
    return '3.0';
  }
  
  getTerrainRules(): TerrainRules {
    return new ClassicTerrainRules();
  }
  
  isCompatibleWith(version: string): boolean {
    return version.startsWith('3.');
  }
}

// Ruleset-aware services
class RulesetAwareTerrainService {
  constructor(private ruleset: FreecivRuleset) {}
  
  generateTerrain(mapData: MapTile[][]): void {
    const terrainRules = this.ruleset.getTerrainRules();
    
    // Use ruleset-specific logic
    for (const row of mapData) {
      for (const tile of row) {
        tile.terrain = terrainRules.selectTerrain(tile.height, tile.temperature);
      }
    }
  }
}
```

---

## Performance Optimization Patterns

### 1. Lazy Loading Pattern

Implement lazy loading for expensive operations:

```typescript
class LazyMapRenderer {
  private terrainRenderer?: TerrainRenderer;
  private unitRenderer?: UnitRenderer;
  
  private getTerrainRenderer(): TerrainRenderer {
    if (!this.terrainRenderer) {
      this.terrainRenderer = new TerrainRenderer(this.canvas, this.tileset);
    }
    return this.terrainRenderer;
  }
  
  private getUnitRenderer(): UnitRenderer {
    if (!this.unitRenderer) {
      this.unitRenderer = new UnitRenderer(this.canvas, this.sprites);
    }
    return this.unitRenderer;
  }
  
  renderTerrain(viewport: Viewport): void {
    this.getTerrainRenderer().render(viewport);
  }
  
  renderUnits(units: Unit[]): void {
    this.getUnitRenderer().render(units);
  }
}
```

### 2. Object Pooling Pattern

Use object pooling for frequently created/destroyed objects:

```typescript
class TileRenderDataPool {
  private pool: TileRenderData[] = [];
  private active: Set<TileRenderData> = new Set();
  
  acquire(): TileRenderData {
    let data = this.pool.pop();
    if (!data) {
      data = new TileRenderData();
    }
    
    this.active.add(data);
    return data;
  }
  
  release(data: TileRenderData): void {
    if (this.active.has(data)) {
      data.reset();
      this.active.delete(data);
      this.pool.push(data);
    }
  }
  
  releaseAll(): void {
    for (const data of this.active) {
      data.reset();
      this.pool.push(data);
    }
    this.active.clear();
  }
}

// Usage in renderer
class TerrainRenderer {
  constructor(private tilePool: TileRenderDataPool) {}
  
  render(viewport: Viewport): void {
    const renderData: TileRenderData[] = [];
    
    // Acquire objects from pool
    for (const tile of viewport.visibleTiles) {
      const data = this.tilePool.acquire();
      data.initialize(tile);
      renderData.push(data);
    }
    
    // Render tiles
    this.renderTiles(renderData);
    
    // Release objects back to pool
    for (const data of renderData) {
      this.tilePool.release(data);
    }
  }
}
```

### 3. Memoization Pattern

Cache expensive calculations:

```typescript
class MemoizedTerrainCalculator {
  private cache = new Map<string, TerrainCalculationResult>();
  
  calculateTerrainProperties(
    position: Position,
    height: number,
    temperature: number,
    moisture: number
  ): TerrainCalculationResult {
    const cacheKey = `${position.x},${position.y},${height},${temperature},${moisture}`;
    
    let result = this.cache.get(cacheKey);
    if (!result) {
      result = this.performCalculation(height, temperature, moisture);
      this.cache.set(cacheKey, result);
    }
    
    return result;
  }
  
  private performCalculation(
    height: number,
    temperature: number,
    moisture: number
  ): TerrainCalculationResult {
    // Expensive terrain calculation
    return new TerrainCalculationResult(/* ... */);
  }
  
  clearCache(): void {
    this.cache.clear();
  }
}
```

---

## Summary

These architectural patterns provide the foundation for refactoring large files while maintaining:

1. **Code Quality**: Through SOLID principles and clear separation of concerns
2. **Maintainability**: Via consistent patterns and interfaces  
3. **Testability**: Through dependency injection and modular design
4. **Performance**: Using optimization patterns where needed
5. **Compatibility**: Preserving freeciv algorithms and behavior
6. **Extensibility**: Supporting future feature additions and modifications

Apply these patterns consistently across all refactored components to ensure a coherent, maintainable architecture that supports the long-term success of the CivJS project.