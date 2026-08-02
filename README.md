# CivJS

CivJS is a browser-based civilization strategy game inspired by Civilization
III. Build an empire from a small settlement, manage cities and resources,
research new technologies, command military and civilian units, and compete
for control of the map.

The game combines the depth of classic 4X strategy with a modern web stack:
games run in the browser, game state is managed by an authoritative server, and
saved games can be resumed later.

## Quick start

### Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- Docker and Docker Compose
- Git

Clone the repository and install dependencies:

```bash
git clone git@github.com:michaelchu/civjs.git
cd civjs
npm install
```

For a fresh Codex worktree, the checked-in local environment at
`.codex/environments/environment.toml` automatically runs the repeatable setup
script. It installs all three lockfiles, creates local env files, and does not
overwrite existing ones. You can also run it manually:

```bash
npm run setup:worktree
```

Install the Chromium runtime for end-to-end tests when needed:

```bash
INSTALL_PLAYWRIGHT_BROWSERS=1 npm run setup:worktree
```

The repository also includes `.devcontainer/devcontainer.json` for tools that
support Development Containers. The setup does not configure Git credentials;
the host's SSH key or GitHub CLI authentication is used for pushing branches.

Start the full development stack:

```bash
npm run docker:build
```

Open [http://localhost:3000](http://localhost:3000). The server runs on port 3001. Stop the stack with:

```bash
npm run docker:down
```

## Local development

To run the client and server directly, start PostgreSQL and migrations first:

```bash
docker compose up -d postgres migrations
cp apps/server/.env.example apps/server/.env
cp apps/client/.env.example apps/client/.env
```

Use these values in `apps/server/.env` for the default Docker services:

```dotenv
PORT=3001
DATABASE_URL=postgresql://civjs:civjs_secret@localhost:5432/civjs
SOCKET_CORS_ORIGIN=http://localhost:3000
```

Set `VITE_SERVER_URL=http://localhost:3001` in `apps/client/.env`, then run:

```bash
npm run dev
```

The client normally uses port 3000. If that port is occupied, Vite prints the
alternate URL in the terminal.

## Useful commands

```bash
npm run dev                 # Start client and server
npm run dev:client          # Start only the client
npm run dev:server          # Start only the server
npm run build               # Build both applications
npm run test                # Run unit tests
npm run test:integration    # Run integration tests with disposable PostgreSQL
npm run test:all            # Run unit and integration tests
npm run lint                # Lint client and server
npm run typecheck           # Type-check client and server
npm run verify              # Formatting, lint, types, and unit tests
npm run build               # Production build (available as a Codex action)
```

## How it works

```text
civjs/
├── apps/client/   React/Vite browser client with Canvas 2D rendering
├── apps/server/   Authoritative Node.js game server and real-time API
├── docs/          Architecture and project documentation
├── reference/     Freeciv and freeciv-web reference material
└── docker-compose.yml
```

The client renders the world map and maintains the player-facing experience.
The server owns game rules, turn progression, and persistence. PostgreSQL
stores games and gameplay entities; the server's in-memory runtime and Socket.IO
connections coordinate live play.

## Documentation

- [Client architecture](docs/CLIENT_ARCHITECTURE.md)
- [Tileset architecture](docs/TILESET_ARCHITECTURE.md)
- [Server architecture](docs/SERVER_CORE_ARCHITECTURE_ROADMAP.md)
- [Gameplay gaps](docs/GAMEPLAY_GAPS.md)
- [Project port status](docs/PORT_STATUS.md)

The porting inventories and playbook in `docs/` are useful for contributors
working on ruleset parity, but they are implementation references rather than
part of the player-facing product description.

## Technology

- Client: React, TypeScript, Vite, Tailwind CSS, Zustand, Socket.IO Client
- Server: Node.js, TypeScript, Express, Socket.IO, Drizzle ORM
- Services: PostgreSQL 16
- Tooling: Docker Compose, ESLint, Prettier, Vitest, Jest, and Playwright

## Contributing

Create a focused feature branch, include tests where practical, and run the
relevant checks before opening a pull request:

```bash
npm run format:check
npm run lint
npm run test:unit
npm run typecheck
```

## License

CivJS is licensed under the MIT License.
