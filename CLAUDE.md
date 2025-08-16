# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Root Level (runs both client and server):**

- `npm run dev` - Start both client and server in development mode
- `npm run build` - Build both client and server for production
- `npm run install:all` - Install dependencies for all projects
- `npm run lint` - Run ESLint on both client and server
- `npm run lint:fix` - Run ESLint with auto-fix on both client and server
- `npm run type-check` - Run TypeScript type checking on both projects
- `npm run format` - Format all code with Prettier
- `npm run check-all` - Run format check, lint, and type check
- `npm run fix-all` - Run format and lint with auto-fix

**Client (React Frontend):**

- `cd client && npm run dev` - Start Vite dev server (localhost:5173)
- `cd client && npm run build` - Build for production
- `cd client && npm run lint` - Run ESLint
- `cd client && npm run type-check` - TypeScript type checking

**Server (Node.js Backend):**

- `cd server && npm run dev` - Start development server with hot reload (localhost:3001)
- `cd server && npm run build` - Compile TypeScript to JavaScript
- `cd server && npm run start` - Run compiled production server

## Project Architecture

### High-Level Structure

This is a full-stack TypeScript multiplayer strategy game with three main components:

1. **Client** (`/client`) - React frontend with Vite, TypeScript, Tailwind CSS
2. **Server** (`/server`) - Node.js/Express backend with Socket.io for real-time communication
3. **Shared** (`/shared`) - Common TypeScript types and constants used by both client and server

### Key Architectural Patterns

**Frontend Architecture:**

- **State Management**: Zustand store (`client/src/stores/gameStore.ts`) manages game state, loading states, and API interactions
- **API Layer**: Centralized API service (`client/src/services/api.ts`) handles all HTTP requests to backend
- **Game Rendering**: Phaser.js integration (`client/src/components/PhaserGame.tsx`) for isometric map rendering and game visualization
- **Routing**: React Router with URL-based navigation between game screens

**Backend Architecture:**

- **Service Layer**: `GameService` handles game logic, database operations, and state management
- **Map Generation**: `MapGenerationService` provides procedural map generation with configurable terrain
- **Database**: Supabase integration with Row Level Security policies for multi-tenant game data
- **Real-time**: Socket.io server for live game updates and player actions

**Database Schema (Supabase):**

- `games` - Game metadata and settings
- `game_players` - Player participation in games
- `map_tiles` - Generated map data for each game
- `units` - Player units and their positions
- `cities` - Player cities and their state
- `player_states` - Per-player game state (resources, etc.)

### Technology Stack Integration

**Frontend Stack:**

- React 19 + TypeScript for UI components
- Vite for fast development and building
- Tailwind CSS for styling with utility classes
- Phaser.js for 2D isometric game rendering
- Zustand for lightweight state management
- Socket.io-client for real-time server communication

**Backend Stack:**

- Express.js with TypeScript for REST API
- Socket.io for WebSocket connections
- Supabase as PostgreSQL database with real-time features
- Zod for runtime type validation
- Helmet and CORS for security

### Game State Flow

1. Games are created through REST API (`POST /api/games`)
2. Players join games via API calls that update database
3. Game start triggers map generation and initial state setup
4. Real-time game actions flow through Socket.io for immediate updates
5. Game state persisted in Supabase with RLS policies for data security

### Development Workflow

- Environment variables in `server/.env` (copy from `server/.env.example`)
- Supabase project setup required with schema from `/docs/*.sql` files
- Hot reload enabled for both client (Vite) and server (ts-node-dev)
- Shared types automatically compiled and available to both client/server
- Pre-commit hooks with Husky for code quality (lint-staged with Prettier)

### File Organization Conventions

- React components in `client/src/components/` with TypeScript
- API services in `client/src/services/`
- Zustand stores in `client/src/stores/`
- Backend services in `server/src/services/`
- Database integration in `server/src/database/`
- Shared types in `/shared/` compiled to JavaScript for import

### API Endpoints

```
GET    /health              - Health check
GET    /api/games           - List available games
POST   /api/games           - Create new game
GET    /api/games/:id       - Get game details
POST   /api/games/:id/join  - Join a game
POST   /api/games/:id/start - Start game (generates map)
GET    /api/games/:id/state - Get full game state
```
