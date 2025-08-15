# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

CivJS is a browser-based 4X strategy game inspired by Civilization, built with React, Node.js, and Supabase. It supports real-time multiplayer gameplay for 2-6 players with turn-based mechanics.

## Development Commands

### Setup and Installation

```bash
# Install all dependencies (root, client, and server)
npm run install:all

# Copy environment template (Windows)
copy server\.env.example server\.env
# Edit server/.env with your Supabase credentials
```

### Development Servers

```bash
# Start both client and server in development mode
npm run dev

# Start only the client (React + Vite on port 5173)
npm run client:dev

# Start only the server (Node.js + Express on port 3001)
npm run server:dev
```

### Build Commands

```bash
# Build both client and server for production
npm run build

# Build only client
npm run client:build

# Build only server
npm run server:build
```

### Code Quality and Development Tools

```bash
# Format all code with Prettier
npm run format

# Check if code is properly formatted
npm run format:check

# Lint all code (client and server)
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Check TypeScript types across entire project
npm run type-check

# Run all quality checks (format + lint + types)
npm run check-all

# Auto-fix all issues (format + lint fixes)
npm run fix-all
```

### Individual Project Commands

```bash
# Client-specific commands
cd client && npm run lint         # Lint React/TypeScript code
cd client && npm run type-check   # Check TypeScript types
cd client && npm run preview      # Preview production build

# Server-specific commands
cd server && npm run lint         # Lint Node.js/TypeScript code
cd server && npm run type-check   # Check TypeScript types
cd server && npm start            # Start production server
```

### API Testing

```bash
# Test server health
curl http://localhost:3001/health

# Get available games
curl http://localhost:3001/api/games

# Create a new game
curl -X POST http://localhost:3001/api/games -H "Content-Type: application/json" -d "{\"name\":\"Test Game\",\"settings\":{\"mapSize\":\"small\",\"turnTimer\":300,\"allowSpectators\":false}}"
```

## Project Architecture

### Monorepo Structure

```
civjs/
├── client/          # React frontend (Vite + TypeScript + Tailwind)
├── server/          # Node.js backend (Express + TypeScript + Socket.io)
├── shared/          # Shared TypeScript types and constants
└── docs/            # Database schemas and API documentation
```

### Technology Stack

**Frontend (Client):**

- React 19 with TypeScript
- Vite for build tooling
- Tailwind CSS for styling
- Socket.io-client for real-time communication
- Zustand for state management (planned)
- Zod for validation

**Backend (Server):**

- Node.js with Express and TypeScript
- Socket.io for WebSocket server
- Supabase for database and authentication
- Helmet for security
- CORS for cross-origin requests
- Zod for request validation

**Database:**

- PostgreSQL via Supabase
- 9 tables: games, game_players, players, map_tiles, units, cities, player_state, player_research, profiles

### Key Architectural Patterns

**Database Layer:**

- Uses Supabase client with Row Level Security (RLS) policies
- Service layer (`GameService`) abstracts database operations
- Database functions handle complex operations like game initialization
- Separate admin client for elevated operations

**API Design:**

- RESTful endpoints for game management
- WebSocket events for real-time game actions
- Request validation using Zod schemas
- Mock authentication middleware (to be replaced with real auth)

**State Management:**

- Shared TypeScript types in `/shared` folder
- Constants file defines game configuration (map sizes, unit stats, terrain)
- Server is authoritative for all game state

### Core Game Systems

**Map System:**

- Hexagonal grid with configurable sizes (small: 40x40, medium: 60x60, large: 80x80)
- 12 terrain types with different yields (food, production, gold)
- Features, resources, and improvements supported

**Unit System:**

- 7 unit types: settler, worker, warrior, scout, archer, swordsman, spearman
- Units have health, movement points, and experience
- Combat system with rock-paper-scissors mechanics planned

**City System:**

- Cities can be founded by settlers
- Population growth and resource management
- Building construction system planned

**Turn System:**

- Turn-based with player order determined at game start
- End turn advances to next player or new turn
- Turn timer support in game settings

### Database Schema Highlights

**Critical Tables:**

- `games` - Core game information and current turn state
- `game_players` - Player participation and turn order
- `map_tiles` - All map data for each game
- `units` - Unit positions and stats
- `cities` - City data and management
- `player_state` - Player resources and statistics

**Important Functions:**

- `start_game(p_game_id)` - Initializes map generation and starting units

### Environment Configuration

**Required Environment Variables:**

```
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
PORT=3001
NODE_ENV=development
CLIENT_URL=http://localhost:5173
```

### Development Tools and Code Quality

**Code Formatting:**

- Prettier configured with consistent rules (single quotes, 2-space tabs)
- Automatic formatting on commit via Husky pre-commit hooks
- .prettierrc and .prettierignore files for project-wide consistency

**Code Quality:**

- ESLint configured for TypeScript + React (client) and Node.js (server)
- Strict TypeScript configuration with enhanced type checking
- Custom rules for unused variables, explicit any types, and code standards

**Pre-commit Quality Control:**

- Husky + lint-staged automatically format staged files
- Prevents inconsistent code from being committed
- Ensures all code follows project standards

**Quality Scripts:**

- Comprehensive npm scripts for formatting, linting, and type checking
- Monorepo-wide commands that work across client, server, and shared code
- Individual project commands for targeted development

### Current Development Status

**Completed:**

- Monorepo project structure with TypeScript
- Database schema with 9 tables and RLS policies
- REST API with game management endpoints
- WebSocket connection framework
- Complete React frontend with game management UI
- Beautiful responsive design with Tailwind CSS
- Map generation system (database functions)
- Unit movement and game state management
- Comprehensive development tools (Prettier, ESLint, Husky)
- Pre-commit hooks for code quality

**In Progress/Planned:**

- Frontend game UI (map rendering, unit controls)
- WebSocket event handling for real-time updates
- Authentication system (currently mocked)
- AI players and game logic
- Victory conditions and advanced features

### Development Notes

**Database Access:**

- Uses both regular Supabase client and admin client
- Admin client bypasses RLS for system operations
- Regular client enforces user permissions

**Testing:**

- API endpoints can be tested with curl or PowerShell
- Health check endpoint at `/health`
- Game creation, joining, and state retrieval working

**WebSocket Implementation:**

- Socket.io server configured but minimal event handling
- Client connects and shows connection status
- Game action events defined in shared types but not implemented

### File Structure Patterns

**Shared Types:** All game-related TypeScript interfaces in `/shared/types.ts`
**Constants:** Game configuration values in `/shared/constants.ts`
**Server Services:** Database operations abstracted in service classes
**API Routes:** RESTful endpoints with Zod validation
**Client Components:** React components with Tailwind CSS styling

This project follows a clear separation between client, server, and shared code with TypeScript providing type safety across the full stack.
