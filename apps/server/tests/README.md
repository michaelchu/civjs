# CivJS Server Testing Guide

This directory contains both unit tests and integration tests for the CivJS server.

## Test Types

### Unit Tests (`*.test.ts`)
- Test individual components in isolation
- Use mocked dependencies (database, Redis, Socket.IO)
- Fast execution, suitable for TDD
- Run with: `npm test` or `npm run test:unit`

### Integration Tests (`*.integration.test.ts`) 
- Test components with real database connections
- Verify actual database operations and persistence
- Test cross-component interactions
- Run with: `npm run test:integration`

## Database Testing

### Setup
Integration tests use a separate test database to avoid conflicts with development data.

**Prerequisites:**
1. PostgreSQL running locally
2. Test database created: `civjs_test`
3. Test user with permissions: `civjs_test`

**Environment:**
Copy `.env.test` and adjust database URL if needed:
```
TEST_DATABASE_URL=postgresql://civjs_test:civjs_test@localhost:5432/civjs_test
```

### Test Database Commands
```bash
# Setup test database (migrate)
npm run test:db:setup

# Clear all test data
npm run test:db:reset

# Run integration tests
npm run test:integration

# Run integration tests with coverage
npm run test:integration:coverage
```

## Test Structure

```
tests/
├── setup.ts                    # Unit test setup (mocked)
├── setup.integration.ts        # Integration test setup (real DB)
├── utils/
│   └── testDatabase.ts         # Database utilities
├── fixtures/
│   └── gameFixtures.ts         # Test data factories
└── game/
    ├── Component.test.ts       # Unit tests
    └── Component.integration.test.ts # Integration tests
```

## Writing Tests

### Unit Tests
```typescript
// Use mocked dependencies
import { mockDb } from '../setup';

describe('ComponentName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should test isolated behavior', () => {
    // Test with mocks
  });
});
```

### Integration Tests  
```typescript
// Use real database
import { getTestDatabase, clearAllTables } from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';

describe('ComponentName - Integration', () => {
  beforeEach(async () => {
    await clearAllTables();
  });
  
  it('should test real database behavior', async () => {
    // Test with real DB operations
  });
});
```

## Best Practices

### Unit Tests
- Mock external dependencies
- Test individual component logic
- Focus on edge cases and error conditions
- Keep tests fast and isolated

### Integration Tests  
- Use test fixtures for consistent data
- Test realistic game scenarios
- Verify database persistence
- Test component interactions
- Clean up between tests

### Database Testing
- Always clean tables between tests
- Use transactions for atomic test data
- Test both happy path and error cases
- Verify data consistency across operations

## CI/CD Integration

```yaml
# Example CI configuration
test:
  script:
    - npm run test:unit          # Fast unit tests
    - npm run test:integration   # Integration tests with DB
    - npm run test:coverage      # Coverage reports
```

## Debugging Tests

### Database Issues
```bash
# Check test database connection
psql -h localhost -U civjs_test -d civjs_test

# View test database state
npm run db:studio -- --config drizzle.config.test.ts

# Reset if needed
npm run test:db:reset
```

### Test Debugging
```bash
# Run specific test
npm run test:integration -- --testNamePattern="should found a city"

# Debug with verbose output
npm run test:integration -- --verbose

# Run with longer timeout
npm run test:integration -- --testTimeout=60000
```