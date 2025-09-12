# CitizenManagement System

An intelligent citizen assignment optimization system based on Freeciv's Citizen Management (CM) architecture.

## Overview

The CitizenManagement system optimizes how citizens in a city are assigned to work tiles or become specialists, maximizing city output according to configurable parameters and constraints.

## Architecture

### Core Components

- **`CitizenParameter`** - Configuration parameters for optimization
- **`CitizenResult`** - Results of optimization with citizen assignments
- **`CitizenTileType`** - Represents unique tile output combinations
- **`CitizenManagementService`** - Main service interface

### Key Features

- **Parameter-driven optimization** with configurable weights and constraints
- **Tile type binning** to reduce search complexity
- **Branch-and-bound algorithm** for optimal solutions with timeout protection
- **Caching system** for performance with LRU eviction
- **Specialist integration** including all specialist types with ruleset-based calculations
- **Happiness/disorder management** with automatic entertainer conversion
- **Performance monitoring** with detailed statistics and complexity scoring

## Usage

### Basic Usage

```typescript
import { CitizenManagementService, CitizenParameterFactory } from '@game/systems/CitizenManagement';

const cmService = CitizenManagementService.getInstance();
cmService.initialize();

// Get optimal assignment with default parameters
const result = cmService.getOptimalAssignment(city);

// Get growth-focused assignment
const growthResult = cmService.getGrowthFocusedAssignment(city);
```

### Custom Parameters

```typescript
import { CitizenParameterFactory } from '@game/systems/CitizenManagement';

// Create custom parameters
const params = CitizenParameterFactory.createDefault();
params.factor.food = 3;  // Prioritize food
params.factor.shield = 1;
params.minimal_surplus.food = 2;  // Require +2 food surplus

const result = cmService.queryResult(city, params);
```

## Implementation Status

### ✅ Completed (Phase 1 - Foundation)
- [x] Core interfaces and types
- [x] Parameter system with factory methods
- [x] Result structures and utilities
- [x] Tile type system architecture
- [x] Basic service interface with caching

### ✅ Completed (Phase 2 - Core Algorithm)
- [x] Branch-and-bound optimization algorithm with timeout protection
- [x] Specialist output calculations from ruleset definitions
- [x] Happiness/disorder mechanics with automatic entertainer conversion
- [x] Performance optimization with caching and complexity detection
- [x] Greedy assignment fallback for complex scenarios
- [x] Tile type binning and dominance analysis for efficiency

### ✅ Completed (Phase 3 - Integration & Testing)
- [x] Integration with CityManager and city update cycles
- [x] Public API methods for manual citizen management
- [x] Comprehensive unit test suite (97 tests)
- [x] Performance monitoring and statistics tracking
- [x] Error handling and validation throughout
- [x] CI/CD configuration to run unit tests

### 📋 Future Enhancements (Optional)
- [ ] Advanced optimization strategies (genetic algorithms, simulated annealing)
- [ ] Multi-city coordination and resource sharing
- [ ] AI governor integration with long-term planning
- [ ] Custom optimization goals and player presets
- [ ] Real-time optimization updates during gameplay
- [ ] UI controls for parameter adjustment

## Algorithm Overview

The system uses Freeciv's branch-and-bound approach:

1. **Tile Type Binning** - Group tiles with identical output
2. **Dominance Analysis** - Build relationships between tile types
3. **Branch & Bound Search** - Systematically explore assignments
4. **Constraint Satisfaction** - Ensure minimal surplus requirements
5. **Fitness Optimization** - Maximize weighted output sum

## Performance Considerations

- **Caching** - Results cached by city state and parameters
- **Complexity Limits** - Timeout protection for large cities
- **Tile Grouping** - Reduces search space significantly
- **Early Termination** - Pruning of dominated branches

## References

- `freeciv/common/aicore/cm.c` - Original implementation
- `freeciv/common/aicore/cm.h` - Interface definitions
- Freeciv documentation on citizen management