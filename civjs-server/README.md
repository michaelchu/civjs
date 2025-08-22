# CivJS Server

A modern, scalable game server for a Civilization-inspired strategy game, built with TypeScript, Express, Socket.IO, and PostgreSQL.

🎮 **Production-ready multiplayer game server with comprehensive testing and modern tooling.**

## Features

- **Real-time multiplayer** using Socket.IO
- **PostgreSQL database** with Drizzle ORM for game persistence
- **Redis caching** for fast game state access
- **Docker support** for easy deployment
- **Type-safe** with TypeScript throughout
- **Packet-based protocol** inspired by Freeciv
- **Scalable architecture** ready for thousands of concurrent games

## Tech Stack

- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Express + Socket.IO
- **Database**: PostgreSQL with Drizzle ORM
- **Cache**: Redis with ioredis
- **Validation**: Zod
- **Logging**: Winston
- **Containerization**: Docker & Docker Compose

## Prerequisites

- Node.js 20+ and npm
- Docker and Docker Compose (for containerized setup)
- PostgreSQL 16+ (for local development without Docker)
- Redis 7+ (for local development without Docker)

## Quick Start with Docker

1. Clone the repository:

```bash
git clone <repository-url>
cd civjs-server
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Start the development environment:

```bash
npm run docker:up
```

This will start:

- PostgreSQL on port 5432
- Redis on port 6379
- pgAdmin on port 5050 (admin@civjs.local / admin)

4. Install dependencies:

```bash
npm install
```

5. Run database migrations:

```bash
npm run db:push
```

6. Start the development server:

```bash
npm run dev
```

The server will be running on http://localhost:3000

## Local Development Setup

1. Install dependencies:

```bash
npm install
```

2. Set up PostgreSQL:

```bash
# Create database
createdb civjs_dev

# Update .env with your database credentials
DATABASE_URL=postgresql://username:password@localhost:5432/civjs_dev
```

3. Set up Redis:

```bash
# Make sure Redis is running
redis-server
```

4. Run database migrations:

```bash
npm run db:push
```

5. Start the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run type-check` - Run TypeScript type checking
- `npm run lint` - Run ESLint on TypeScript files
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run db:generate` - Generate database migrations
- `npm run db:push` - Push schema changes to database
- `npm run db:studio` - Open Drizzle Studio for database management
- `npm run docker:up` - Start Docker development environment
- `npm run docker:down` - Stop Docker containers
- `npm run docker:logs` - View Docker container logs

## Project Structure

```
civjs-server/
├── src/
│   ├── config/          # Configuration management
│   ├── database/        # Database schemas and connections
│   │   ├── schema/      # Drizzle ORM schemas
│   │   └── redis.ts     # Redis client and helpers
│   ├── game/           # Game logic (to be implemented)
│   │   ├── GameManager.ts
│   │   ├── TurnManager.ts
│   │   └── MapManager.ts
│   ├── network/        # Networking and packet handling
│   │   ├── PacketHandler.ts
│   │   └── socket-handlers.ts
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Utility functions
│   └── index.ts        # Server entry point
├── docker-compose.yml  # Production Docker config
├── docker-compose.dev.yml # Development Docker config
├── drizzle.config.ts   # Drizzle ORM configuration
└── package.json
```

## Database Schema

The database uses the following main tables:

- `users` - Player accounts and statistics
- `games` - Game instances and settings
- `players` - Players in each game
- `cities` - Cities in the game world
- `units` - Military and civilian units
- `game_turns` - Turn history and replay data

## API Endpoints

### HTTP Endpoints

- `GET /health` - Health check
- `GET /api/info` - Server information

### Socket.IO Events

- `packet` - Main event for all game packets
- Packet types include:
  - `SERVER_JOIN_REQ/REPLY` - Join server
  - `CHAT_MSG` - Chat messages
  - `GAME_LIST` - List available games
  - `GAME_CREATE` - Create new game
  - `GAME_JOIN` - Join existing game
  - (More to be implemented)

## Production Deployment

1. Build the Docker image:

```bash
docker build -t civjs-server .
```

2. Run with Docker Compose:

```bash
docker-compose up -d
```

## Environment Variables

See `.env.example` for all available configuration options.

Key variables:

- `PORT` - Server port (default: 3000)
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `NODE_ENV` - Environment (development/production)
- `LOG_LEVEL` - Logging level (debug/info/warn/error)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run type checking: `npm run type-check`
5. Submit a pull request

## License

MIT

## Roadmap

- [x] Basic server setup
- [x] Database schema
- [x] Socket.IO integration
- [x] Packet system
- [x] Game state management
- [x] Turn processing
- [x] Map generation
- [x] City management (founding, growth, production)
- [x] Unit management (movement, combat, fortification)
- [x] Visibility system (fog of war, line of sight)
- [x] Combat system
- [x] Comprehensive test coverage (140+ tests)
- [ ] AI players
- [ ] Technology research system
- [ ] Diplomacy system
- [ ] Save/load functionality
- [ ] Replay system
- [ ] Admin tools
- [ ] Web client interface
