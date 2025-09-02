# Testing Strategy - Reducing Over-Mocking

This document explains our improved testing approach that addresses over-mocking issues and ensures better test reliability.

## Problem with Over-Mocking

Our previous tests were heavily mocked, which caused several issues:

- **Database operations completely mocked** - Real SQL errors and schema issues weren't caught
- **Static mock responses** - Tests passed with hardcoded data instead of realistic scenarios  
- **Manager interactions isolated** - Cross-component bugs weren't detected
- **No persistence validation** - Data consistency issues went unnoticed

## Solution: Two-Tier Testing Strategy

### Unit Tests (Isolated Testing)
**Purpose**: Test individual component logic in isolation  
**Setup**: Uses mocked dependencies (database, Redis, Socket.IO)  
**Files**: `*.test.ts`  
**Command**: `npm run test:unit`

**Use for**:
- Business logic validation
- Edge case handling  
- Error condition testing
- Fast feedback during development

### Integration Tests (Real Dependencies)
**Purpose**: Test components with actual database connections  
**Setup**: Uses real PostgreSQL test database  
**Files**: `*.integration.test.ts`  
**Command**: `npm run test:integration`  

**Use for**:
- Database schema validation
- SQL query correctness
- Data persistence verification
- Cross-component interaction testing

## Database Testing Setup

### Prerequisites
1. **PostgreSQL running locally**
2. **Create test database**: 
   ```sql
   CREATE DATABASE civjs_test;
   CREATE USER civjs_test WITH ENCRYPTED PASSWORD 'civjs_test';  
   GRANT ALL PRIVILEGES ON DATABASE civjs_test TO civjs_test;
   ```

### Configuration
Test database URL is configured in `.env.test`:
```
TEST_DATABASE_URL=postgresql://civjs_test:civjs_test@localhost:5432/civjs_test
```

### Running Tests
```bash
# Unit tests only (fast, mocked)
npm run test:unit

# Integration tests (with real database) 
npm run test:integration

# Both unit and integration tests
npm test

# With coverage reporting
npm run test:integration:coverage
```

## Writing Integration Tests

### Example: CityManager Integration Test
```typescript
import { getTestDatabase, clearAllTables } from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';

describe('CityManager Integration', () => {
  beforeEach(async () => {
    await clearAllTables(); // Clean slate for each test
  });

  it('should persist city data to database', async () => {
    const scenario = await createBasicGameScenario();
    const cityManager = new CityManager(scenario.game.id);
    
    // Test real database operations
    const cityId = await cityManager.foundCity('player-1', 'TestCity', 10, 10, 1);
    
    // Verify persistence
    const db = getTestDatabase();
    const dbCity = await db.query.cities.findFirst({
      where: (cities, { eq }) => eq(cities.id, cityId)
    });
    
    expect(dbCity).toBeDefined();
    expect(dbCity!.name).toBe('TestCity');
  });
});
```

## Test Fixtures

We use fixture factories to create consistent test scenarios:

- `createBasicGameScenario()` - Basic 2-player game with cities and units
- `createCityGrowthScenario()` - City ready for population growth  
- `createCombatScenario()` - Units positioned for combat
- `createProductionScenario()` - City producing units/buildings

## Benefits of This Approach

### Catches Real Issues
- SQL syntax errors and constraint violations
- Database schema mismatches
- Performance issues with complex queries
- Data consistency problems

### Improves Confidence  
- Tests validate actual application behavior
- Database migrations are tested automatically
- Real data persistence is verified
- Cross-component interactions work correctly

### Maintains Speed
- Unit tests remain fast for TDD workflow
- Integration tests run in isolated environment
- Parallel test execution where possible
- Clear separation of concerns

## CI/CD Integration

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - run: npm ci
      
      # Create test database
      - run: |
          PGPASSWORD=postgres createdb -h localhost -U postgres civjs_test
          PGPASSWORD=postgres psql -h localhost -U postgres -c "CREATE USER civjs_test WITH ENCRYPTED PASSWORD 'civjs_test';"
          PGPASSWORD=postgres psql -h localhost -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE civjs_test TO civjs_test;"
      
      # Run tests
      - run: npm run test:unit
      - run: npm run test:integration  
      - run: npm run test:coverage
```

## Migration Path

### Phase 1: Infrastructure ✅ 
- Test database configuration
- Integration test framework  
- Database utilities and fixtures
- CityManager integration tests

### Phase 2: Expand Coverage 🚧
- UnitManager integration tests
- GameManager integration tests  
- Cross-manager interaction tests
- Performance benchmarks

### Phase 3: Full Coverage 📋
- All managers have integration tests
- End-to-end game flow tests
- Load testing with multiple players
- Regression test suite

This approach ensures our civilization game implementation is robust and matches the complexity of the original Freeciv game while maintaining fast development feedback.