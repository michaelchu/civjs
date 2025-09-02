# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CivJS is a modern web-based civilization game port built with TypeScript. This is a monorepo containing:
- **Client**: React/TypeScript frontend with Canvas 2D rendering (porting from freeciv-web)
- **Server**: Node.js/TypeScript backend with Socket.IO for real-time multiplayer
- **Shared Types**: Common TypeScript interfaces between client and server

The project is inspired by Freeciv and freeciv-web, reimplementing the game with modern web technologies.

**Note**: This project uses standalone apps (not npm workspaces) for Railway deployment compatibility. Each app in `apps/` has its own `package.json` and `package-lock.json`.

## Development Commands

### Root Level (standalone apps)
```bash
npm run dev              # Start both client and server concurrently
npm run dev:client       # Start only frontend (port 3000)
npm run dev:server       # Start only backend (port 3001)

npm run build            # Build all workspaces
npm run build:client     # Build frontend only
npm run build:server     # Build backend only

npm run test             # Run all tests
npm run test:client      # Test frontend only
npm run test:server      # Test backend only

npm run lint             # Lint all workspaces
npm run lint:fix         # Fix linting issues
npm run typecheck        # Type check all workspaces

# Docker
npm run docker:build     # Build and start all services
npm run docker:up        # Start existing containers
npm run docker:down      # Stop all containers
```

### Client-specific (apps/client)
```bash
# Use root commands or cd to apps/client
npm run type-check       # TypeScript type checking
npm run format          # Format with Prettier
npm run format:check     # Check formatting
```

### Server-specific (apps/server)
```bash
# Use root commands or cd to apps/server
npm run type-check       # TypeScript type checking
npm run test:watch       # Jest in watch mode
npm run test:coverage    # Test with coverage
npm run test:ci          # CI test mode

# Testing commands
npm test                 # Run unit tests (mocked dependencies)
npm run test:unit        # Run unit tests explicitly
npm run test:integration # Run integration tests (real database)
npm run test:integration:watch    # Integration tests in watch mode
npm run test:integration:coverage # Integration tests with coverage
npm run test:db:setup    # Setup test database (migrate)
npm run test:db:reset    # Clear all test data

# Database commands (Drizzle ORM)
npm run db:generate      # Generate migrations
npm run db:migrate       # Run migrations
npm run db:migrate:prod  # Production migrations
npm run db:push          # Push schema changes
npm run db:studio        # Open Drizzle Studio

# Docker services for development
npm run docker:up        # Start postgres/redis containers
npm run docker:down      # Stop containers
npm run docker:logs      # View container logs
```

## Architecture

### Client Architecture (`apps/client/src/`)
- **Components/**: React components organized by feature
  - `Canvas2D/`: Map rendering with HTML5 Canvas (ported from freeciv-web)
  - `GameUI/`: Game interface components (chat, status, turns)
  - `Dialogs/`: Modal dialogs for game interactions
- **Store/**: Zustand state management (`gameStore.ts`)
- **Services/**: API clients and Socket.IO connection (`GameClient.ts`)
- **Types/**: TypeScript definitions for packets and game objects

### Server Architecture (`apps/server/src/`)
- **Game/**: Core game logic managers
  - `GameManager.ts`: Central game state coordination
  - `CityManager.ts`: City management and operations
  - `UnitManager.ts`: Unit movement and actions
  - `TurnManager.ts`: Turn processing and player actions
  - `MapManager.ts`: Map generation and tile management
  - `ResearchManager.ts`: Technology research
  - `VisibilityManager.ts`: Fog of war and player vision
- **Network/**: Socket.IO handlers and packet processing
- **Database/**: Drizzle ORM schemas and Redis connection
  - Schema files for games, players, cities, units, research, etc.
- **Types/**: Server-side type definitions

### Key Technologies
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Zustand, Socket.IO Client
- **Backend**: Node.js, TypeScript, Socket.IO, Express, Drizzle ORM
- **Database**: PostgreSQL 16, Redis 7
- **Development**: Docker, ESLint, Prettier, Jest, Vitest

### Environment Setup
The project uses Docker for development services. Main environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `PORT`: Server port (default 3001)
- `SOCKET_CORS_ORIGIN`: Client URL for CORS (default http://localhost:3000)

### Development Workflow
1. Use `npm run docker:build` to start with Docker (recommended)
2. Or start services individually with `npm run dev:server` and `npm run dev:client`
3. Database migrations are handled via Drizzle Kit
4. Real-time communication uses Socket.IO between client and server
5. Game state is persisted in PostgreSQL with Redis for caching

### Port Context
This is a port from freeciv-web (the original web client) to a modern React/TypeScript architecture. The Canvas2D rendering maintains compatibility with freeciv-web's 2D tile-based system while the server implements civilization game mechanics with modern Node.js patterns.

## Reference Repositories

The `reference/` folder contains the original source repositories we are porting from:
- **freeciv/**: The original Freeciv game (C-based backend) - reference for game mechanics, rules, and server logic
- **freeciv-web/**: The web client implementation - reference for frontend rendering, UI components, and client-side game logic

When implementing features or fixing issues, consult these reference repositories to understand the original implementation and ensure compatibility with established game mechanics.
- Always copy and reference original code when generating ports. Cite the source (file/path/lines). Only if reuse is impossible, explain why and stop. Do not write new code until the user explicitly approves.
- always run linter, formatter and tests before committing and pushing to remote
- Always check typescript before asking user to test

## Testing Strategy

### Test Types

**Unit Tests** (`*.test.ts`):
- Test individual components in isolation
- Use mocked dependencies (database, Redis, Socket.IO)
- Fast execution, suitable for TDD
- Run with: `npm test` or `npm run test:unit`

**Integration Tests** (`*.integration.test.ts`):
- Test components with real database connections
- Verify actual database operations and persistence
- Test cross-component interactions
- Run with: `npm run test:integration`

### Database Testing Setup

Integration tests use a separate test database (`civjs_test`) to avoid conflicts with development data.

**Prerequisites:**
1. PostgreSQL running locally
2. Test database created: `civjs_test`
3. Test user with permissions: `civjs_test`
4. Environment file: `.env.test` with `TEST_DATABASE_URL`

### Test Structure

```
apps/server/tests/
├── setup.ts                    # Unit test setup (mocked)
├── setup.integration.ts        # Integration test setup (real DB)
├── utils/
│   ├── testDatabase.ts         # Database utilities
│   └── gameTestUtils.ts        # Game setup utilities
├── fixtures/
│   └── gameFixtures.ts         # Test data factories
└── [game|integration]/
    ├── Component.test.ts       # Unit tests
    └── Component.integration.test.ts # Integration tests
```

### Writing Tests

**Unit Tests:**
```typescript
// Use mocked dependencies
describe('ComponentName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should test isolated behavior', () => {
    // Test with mocks
  });
});
```

**Integration Tests:**
```typescript
// Use real database
import { setupGameManagerWithScenario, cleanupGameManager } from '../utils/gameTestUtils';

describe('ComponentName - Integration', () => {
  let gameManager, scenario;
  
  beforeEach(async () => {
    const setup = await setupGameManagerWithScenario();
    gameManager = setup.gameManager;
    scenario = setup.scenario;
  });
  
  afterEach(() => {
    cleanupGameManager(gameManager);
  });
  
  it('should test real database behavior', async () => {
    // Test with real DB operations
  });
});
```

### Best Practices

**Unit Tests:**
- Mock external dependencies
- Test individual component logic
- Focus on edge cases and error conditions
- Keep tests fast and isolated

**Integration Tests:**
- Use test fixtures for consistent data (`gameFixtures.ts`)
- Test realistic game scenarios end-to-end
- Verify database persistence and cross-manager interactions
- Use `gameTestUtils.ts` for consistent setup/teardown
- Clean up between tests with `cleanupGameManager()`

**Database Testing:**
- Always clean tables between tests
- Use real database operations to test persistence
- Test both happy path and error cases
- Verify data consistency across operations

### Debugging Tests

```bash
# Run specific test
npm run test:integration -- --testNamePattern="should found a city"

# Debug with verbose output  
npm run test:integration -- --verbose

# Run with longer timeout
npm run test:integration -- --testTimeout=60000

# Check test database connection
psql -h localhost -U civjs_test -d civjs_test
```