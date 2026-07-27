# CivJS

CivJS is an in-progress TypeScript port of the Freeciv classic ruleset and the
freeciv-web 2D client experience. It is a monorepo with a React/Vite client and
a Node.js/Socket.IO server backed by PostgreSQL and Redis.

The project is playable locally, including creating, joining, resuming,
advancing, and completing games. The defined roadmap is complete through
Milestone 8 for the supported classic-ruleset scope. It is not a port of every
Freeciv ruleset or the full upstream default AI; the exact supported scope and
remaining decisions are tracked in the [port status](docs/PORT_STATUS.md) and
[porting playbook](docs/PORTING_PLAYBOOK.md).

## Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Git

## Quick start

Clone the repository and install the root dependencies:

```bash
git clone git@github.com:michaelchu/civjs.git
cd civjs
npm install
```

Start the complete development stack (client, server, PostgreSQL, Redis, and
migrations):

```bash
npm run docker:build
```

Open <http://localhost:3000>. The server is available on port 3001.

To stop the stack:

```bash
npm run docker:down
```

## Running the client and server locally

`npm run dev` starts only the client and server processes. PostgreSQL and Redis
must already be running, and the server must be configured to use them. Start
the supporting services and migrations with Docker:

```bash
docker compose up -d postgres redis migrations
```

Then create local environment files from the examples and set the server values
to match the Docker services:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/client/.env.example apps/client/.env
```

For the default Docker services, `apps/server/.env` needs these values:

```dotenv
PORT=3001
DATABASE_URL=postgresql://civjs:civjs_secret@localhost:5432/civjs
REDIS_URL=redis://localhost:6379
SOCKET_CORS_ORIGIN=http://localhost:3000
```

Set `VITE_SERVER_URL=http://localhost:3001` in `apps/client/.env`, then run:

```bash
npm run dev
```

The client normally uses port 3000. If it reports that port 3000 is occupied,
Vite selects another port; use the URL printed in its terminal output.

## Development commands

```bash
# Development
npm run dev                 # Start client and server (services required)
npm run dev:client          # Start only the client
npm run dev:server          # Start only the server

# Build and quality checks
npm run build               # Build both applications
npm run lint                # Lint both applications
npm run lint:fix            # Apply lint fixes
npm run format:check        # Check formatting
npm run format              # Apply formatting
npm run typecheck           # Type-check both applications

# Tests
npm run test                # All unit tests (client and server)
npm run test:unit           # Same as npm run test
npm run test:integration    # Server integration tests (PostgreSQL required)
npm run test:all            # Unit and integration tests

# Docker
npm run docker:build        # Build and start the complete stack
npm run docker:up           # Start the existing complete stack
npm run docker:down         # Stop the complete stack
```

Integration tests require an isolated PostgreSQL test database. See
`apps/server/tests/setup.integration.ts` for the required `TEST_DATABASE_URL`
configuration.

## Architecture

```
civjs/
├── apps/
│   ├── client/              # React, Vite, Canvas 2D, Zustand, Socket.IO client
│   └── server/              # Node.js, Socket.IO, Drizzle, game logic
├── docs/                    # Port status, inventory, and continuation playbook
├── reference/               # Freeciv and freeciv-web source references
└── docker-compose.yml       # Local development stack
```

The client renders the map with Canvas 2D and receives game state through
Socket.IO. The server is authoritative for game rules and persists games,
players, cities, units, and research in PostgreSQL; Redis supports connections
and caching.

## Porting work

Before adding or changing game behavior, consult the source repositories in
`reference/freeciv/` and `reference/freeciv-web/`. New ported behavior should
record its source file and line range and include appropriate tests. The
[porting playbook](docs/PORTING_PLAYBOOK.md) defines the milestones and the
[porting inventory](docs/PORTING_INVENTORY.md) records current evidence and
known gaps.

## Technology

- Client: React, TypeScript, Vite, Tailwind CSS, Zustand, Socket.IO Client
- Server: Node.js, TypeScript, Express, Socket.IO, Drizzle ORM
- Services: PostgreSQL 16 and Redis 7
- Tooling: Docker Compose, ESLint, Prettier, Vitest, and Jest

## Contributing

1. Create a feature branch.
2. Make a focused change with tests where practical.
3. Run `npm run format:check`, `npm run lint`, `npm run test:unit`, and
   `npm run typecheck`.
4. Commit and open a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
