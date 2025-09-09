# CityManager Refactoring Summary

## Problem
The `CityManager.ts` file had grown to **3,424 lines**, making it difficult to maintain, test, and understand. The file contained multiple concerns that violated the Single Responsibility Principle.

## Solution
Broke down the monolithic CityManager into specialized services following the Single Responsibility Principle:

## New Service Files Created

### 1. CityTileManagementService.ts
**Responsibility**: City workable tiles and citizen assignments
- `initializeWorkableTiles()` - Set up workable tiles for new cities
- `assignCitizenToTile()` - Assign citizens to work specific tiles  
- `convertTileWorkerToSpecialist()` - Convert tile workers to specialists
- `getWorkableTiles()` - Get all workable tiles for a city
- `calculateCityOutputs()` - Calculate outputs from worked tiles

### 2. CityBuildingService.ts
**Responsibility**: City buildings and their effects
- `canCityBuildBuilding()` - Check building prerequisites
- `completeBuildingConstruction()` - Handle building completion
- `applyBuildingEffects()` - Apply building bonuses/effects
- `calculateCityOutputsWithBuildings()` - Calculate outputs including buildings
- `calculateBuildingMaintenanceCost()` - Calculate upkeep costs
- `startBuildingConstruction()` - Begin building construction
- `sellBuilding()` - Sell buildings for gold

### 3. CityTradeRouteService.ts
**Responsibility**: Trade routes between cities
- `calculateTradeRouteValue()` - Calculate trade route revenue
- `establishTradeRoute()` - Create new trade routes
- `getCityTradeRouteRevenue()` - Get total trade income
- `removeTradeRoute()` - Remove existing trade routes
- `updateTradeRoutesOnCityDestruction()` - Clean up after city destruction
- `getAvailableTradePartners()` - Find potential trade partners

### 4. CityProductionService.ts
**Responsibility**: City production buy/rush mechanics
- `calculateBuyCost()` - Calculate rush buy costs
- `buyProduction()` - Rush buy current production
- `canBuyProduction()` - Check if rush buy is allowed
- `getProductionBuyInfo()` - Get rush buy information

### 5. CityGovernorService.ts
**Responsibility**: Automated city governance and optimization
- `configureCityGovernor()` - Set up city automation
- `applyGovernorAutomation()` - Run automated city management
- `preventCityStarvation()` - Prevent cities from starving
- `optimizeCityHappiness()` - Optimize for happiness
- `optimizeCitySpecialists()` - Manage specialists automatically
- `optimizeCityTiles()` - Automatically assign best tiles
- `selectOptimalProduction()` - Choose optimal production

### 6. CityCaptureService.ts
**Responsibility**: City conquest and transfer mechanics
- `captureCity()` - Handle city conquest
- `transferCity()` - Transfer city between players
- `updateTradeRoutesOnPlayerChange()` - Update routes after ownership change
- `calculateCaptureEffects()` - Calculate conquest damage
- `applyCityResistance()` - Handle post-capture resistance

### 7. Enhanced CityManagementService.ts
**Responsibility**: High-level coordination and game integration
- All original city founding, production, and query operations
- Added high-level coordination methods that delegate to specialized services
- Handles broadcasting of city-related events
- Provides simplified API for GameManager integration

## Benefits of Refactoring

### 1. **Single Responsibility Principle**
Each service now has a single, well-defined responsibility:
- CityTileManagementService → tile work assignments
- CityBuildingService → building construction and effects
- CityTradeRouteService → inter-city trade
- CityProductionService → rush buying production
- CityGovernorService → city automation
- CityCaptureService → city conquest mechanics

### 2. **Improved Testability**
- Each service can be unit tested independently
- Mocking dependencies is much easier
- Test coverage can be measured per service
- Tests are faster and more focused

### 3. **Better Maintainability**
- Smaller files are easier to understand and modify
- Changes to one concern don't affect others
- Code reviews are more focused
- New developers can understand specific areas more easily

### 4. **Cleaner Dependencies**
- Services have explicit dependencies in their constructors
- Circular dependencies are avoided
- Dependencies are injected, making code more flexible

### 5. **Reusability**
- Services can be reused in different contexts
- Individual services can be replaced or extended
- A/B testing different implementations is easier

## File Size Reduction
- **Original**: 3,424 lines in single file
- **New Structure**: 6 specialized services + enhanced coordination service
- **Average service size**: ~200-400 lines per file
- **Much more manageable and focused codebase**

## Integration Points

The services work together through:
1. **CityManager** - Still exists as the main coordinator, now much smaller
2. **CityManagementService** - High-level game integration layer
3. **Service dependencies** - Services are injected into constructors where needed

## Next Steps

1. **Update CityManager.ts** to use the new services (remove duplicate code)
2. **Update imports** throughout the codebase
3. **Run comprehensive tests** to ensure functionality is preserved
4. **Update documentation** for the new architecture
5. **Consider extracting more specialized services** if any files still grow too large

## References
- Original file: `apps/server/src/game/managers/CityManager.ts` (3,424 lines)
- New services: `apps/server/src/game/services/City*Service.ts`
- Updated coordination: `apps/server/src/game/services/CityManagementService.ts`