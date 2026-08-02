# AGENTS.md

## Project overview

CivJS is a modern web-based Civilization game port written in TypeScript. It is a monorepo-style repository with standalone applications rather than npm workspaces:

- `apps/client/`: React/Vite frontend with Canvas 2D rendering
- `apps/server/`: authoritative Node.js/TypeScript game server with Socket.IO
- `reference/`: Freeciv and freeciv-web source used to preserve gameplay and client behavior
- `docs/`: architecture, porting, parity, and implementation documentation

Each application has its own `package.json` and lockfile. Root scripts delegate to the client and server applications.

## Source-of-truth and porting guidance

For compatibility or parity work, consult the relevant reference implementation before making changes:

- `reference/freeciv/` is the primary source for game rules, mechanics, server behavior, and rulesets.
- `reference/freeciv-web/` is the primary source for browser-client behavior, rendering, controls, assets, and UI details.

Preserve established behavior where practical. When porting behavior, record the reference source path and line range in the relevant documentation or pull request. Do not modify files under `reference/` as part of ordinary feature work.

## Development commands

Run commands from the repository root unless a command explicitly changes directory.

```bash
# Development
npm run dev              # Start client and server
npm run dev:client       # Start only the client
npm run dev:server       # Start only the server

# Build and verification
npm run build            # Build both applications
npm run verify           # Format check, lint, typecheck, and unit tests
npm run test             # Unit tests
npm run test:integration # Integration tests using disposable PostgreSQL via Docker
npm run test:e2e         # Playwright end-to-end tests

# Individual applications
cd apps/client && npm run test
cd apps/server && npm run test:unit
cd apps/server && npm run type-check

# Local services
npm run docker:build     # Build and start the root Docker services
npm run docker:up        # Start the root Docker services
npm run docker:down      # Stop the root Docker services
cd apps/server && npm run docker:up
cd apps/server && npm run docker:down
```

Run the narrowest relevant checks during iteration. Before handing work back, run `npm run verify` and any affected integration or end-to-end checks. Integration tests require Docker. Check TypeScript before asking the user to test.

Useful server commands include:

```bash
cd apps/server
npm run test:watch
npm run test:coverage
npm run test:integration:watch
npm run db:generate
npm run db:migrate
npm run db:push
npm run db:studio
```

## Architecture

### Client (`apps/client/src/`)

- `components/`: React UI organized by feature, including `Canvas2D/`, `GameUI/`, and `Dialogs/`
- `store/`: Zustand game state
- `services/`: API and Socket.IO clients
- `types/`: client, packet, and shared TypeScript definitions
- `hooks/`, `utils/`, `config/`, and `constants/`: supporting client code

### Server (`apps/server/src/`)

- `game/`: core game logic, including `ai/`, `managers/`, `services/`, `systems/`, `map/`, and `rules/`
- `network/`: Socket.IO transport and handlers
- `database/`: Drizzle ORM connection and schema
- `shared/`: data and types shared across server subsystems
- `controllers/`, `routes/`, `config/`, `scripts/`, `types/`, and `utils/`: supporting server code

The server is authoritative for game state. PostgreSQL is used for persistence and Redis is used for caching or coordination where configured. The client communicates with the server through Socket.IO.

## Working agreements

- Inspect existing code, tests, and nearby patterns before changing behavior.
- Add or update tests for behavior changes when practical.
- Keep client/server/shared contracts synchronized.
- Prefer focused changes and avoid unrelated cleanup.
- Do not commit or push changes unless the user explicitly asks.
- Keep `reference/` read-only during normal development.
