# CivJS - Browser-based Civilization Game

A real-time multiplayer 4X strategy game built with React, Node.js, and Supabase.

## 🏗️ Project Structure

```
civjs/
├── client/          # React frontend (Vite + TypeScript)
├── server/          # Node.js backend (Express + TypeScript)
├── shared/          # Shared TypeScript types and constants
└── docs/            # Documentation
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm
- Supabase account (for database setup)

### Installation

1. **Install all dependencies:**

   ```bash
   npm run install:all
   ```

2. **Set up environment variables:**

   ```bash
   # Copy the example environment file
   cp server/.env.example server/.env
   # Edit server/.env with your Supabase credentials (see Supabase Setup section)
   ```

3. **Run the development servers:**
   ```bash
   npm run dev
   ```

This will start:

- Client on http://localhost:5173
- Server on http://localhost:3001

## 🗄️ Supabase Setup

**⚠️ NEXT STEP: Configure Supabase**

You'll need to:

1. Create a new Supabase project
2. Set up the database schema
3. Configure authentication
4. Update the `.env` file with your credentials

## 🛠️ Development Commands

```bash
# Run both client and server in development mode
npm run dev

# Run only the client
npm run client:dev

# Run only the server
npm run server:dev

# Build for production
npm run build

# Install dependencies for all projects
npm run install:all
```

## 🎯 Current Status

✅ **Phase 1 Foundation Complete:**

- [x] Project structure setup
- [x] React frontend with Vite + TypeScript
- [x] Node.js backend with Express + TypeScript
- [x] WebSocket integration (Socket.io)
- [x] Tailwind CSS setup
- [x] Shared types and constants
- [x] Development scripts

✅ **Supabase Integration Complete:**

- [x] Database schema (9 tables with relationships)
- [x] Row Level Security policies
- [x] Database functions for game management
- [x] Server-side database service layer
- [x] REST API endpoints for game operations
- [x] Connection testing and validation

✅ **Phase 2 Game Systems Complete:**

- [x] Frontend game management UI
- [x] Map generation and rendering system
  - Backend: Procedural map tile generation with configurable sizes
  - Frontend: Isometric tile rendering with Phaser.js
  - Interactive: Camera controls, tile selection, hover effects
- [x] React Router navigation with URL-based routing
- [x] Isometric map display with Phaser.js integration
- [x] Database constraint fixes for game state management

🔄 **Next Steps:**

- [ ] Enhanced terrain generation (varied terrain types, resources)
- [ ] Unit movement and game logic implementation
- [ ] Real-time multiplayer synchronization
- [ ] Combat system and city management

## 🧪 Testing the Setup

1. Start the development servers: `npm run dev`
2. Open http://localhost:5173
3. You should see the CivJS welcome page with a connection status indicator
4. If the indicator is green, the client and server are communicating successfully

### API Testing

**Available Endpoints:**

```
GET    /health              - Health check
GET    /api/games           - List available games
POST   /api/games           - Create new game
GET    /api/games/:id       - Get game details
POST   /api/games/:id/join  - Join a game
POST   /api/games/:id/start - Start game (generates map)
GET    /api/games/:id/state - Get full game state
```

See `docs/test-api.md` for detailed testing examples.

## 📚 Technology Stack

**Frontend:**

- React 18 + TypeScript
- Vite (build tool)
- Tailwind CSS (styling)
- React Router (URL-based navigation)
- Phaser.js (2D game rendering and isometric maps)
- Socket.io-client (real-time communication)
- Zustand (state management)

**Backend:**

- Node.js + Express + TypeScript
- Socket.io (WebSocket server)
- Supabase (database and auth)
- Zod (validation)

**Shared:**

- TypeScript types and constants
- Game configuration and rules

---

Ready for the next phase: **Supabase Setup** 🚀
