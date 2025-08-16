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
- [x] Supabase integration
  - Database schema (9 tables with relationships)
  - Row Level Security policies
  - Database functions for game management
  - Server-side database service layer
  - REST API endpoints for game operations
  - Connection testing and validation

✅ **Phase 2 Game Systems Complete:**

**Game CRUD Operations:**

- [x] Complete game lifecycle management (Create, Read, Update, Delete)
- [x] Game creation with configurable settings (map size, turn timer, spectators)
- [x] Game listing with status indicators (waiting, active, completed)
- [x] Game joining and player management
- [x] Game deletion with confirmation modal and permissions
- [x] Comprehensive game state persistence and retrieval

**Map Generation & Rendering:**

- [x] Procedural map generation with multiple terrain types
  - Configurable map sizes (small: 40x40, medium: 60x60, large: 80x80)
  - Varied terrain: grassland, hills, mountains, forest, water
  - Resource placement and strategic positioning
- [x] Isometric tile rendering with Phaser.js
  - High-performance canvas-based rendering using polygon geometry
  - Smooth tile transitions and visual effects
  - Dynamic terrain coloring (programmatic color generation)

**Mouse & Keyboard Controls:**

- [x] Camera controls and navigation
  - WASD keyboard movement
  - Mouse drag panning
  - Zoom in/out with mouse wheel
  - Edge scrolling support
- [x] Interactive tile system
  - Hover effects with tile highlighting
  - Click-to-select tile functionality
  - Coordinate display and tile information
- [x] Responsive UI integration
  - Seamless React-Phaser integration
  - Mobile-friendly touch controls
  - Performance-optimized rendering pipeline

**Additional Systems:**

- [x] React Router navigation with URL-based routing
- [x] Database constraint fixes for game state management
- [ ] Enhanced terrain generation (varied terrain types, resources)

🔄 **Phase 3 - Core Game Mechanics:**

**Unit System:**

- [ ] Unit types and stats (Warriors, Settlers, Scouts, Workers)
- [ ] Unit movement system with pathfinding
- [ ] Unit actions (move, attack, fortify, sleep)
- [ ] Unit experience and promotions
- [ ] Unit stacking and combat mechanics

**City System:**

- [ ] City founding and expansion
- [ ] Population growth and management
- [ ] Building construction (granary, barracks, library, etc.)
- [ ] City production queue system
- [ ] City borders and territory control
- [ ] City specialization (production, science, culture)

**Resource System:**

- [ ] Strategic resources (iron, horses, oil)
- [ ] Luxury resources (gold, gems, spices)
- [ ] Resource extraction and trading
- [ ] Resource requirements for units/buildings
- [ ] Trade routes between cities

**Technology System:**

- [ ] Tech tree with dependencies
- [ ] Science point generation and allocation
- [ ] Technology unlocks (units, buildings, improvements)
- [ ] Era progression (Ancient, Classical, Medieval, etc.)

**Game Loop & Turn Management:**

- [ ] Turn-based gameplay mechanics
- [ ] Player turn order and synchronization
- [ ] Turn timer and automatic progression
- [ ] End turn conditions and validation
- [ ] Game state synchronization across players

**Combat System:**

- [ ] Unit vs unit combat mechanics
- [ ] Combat strength calculations
- [ ] Terrain combat bonuses/penalties
- [ ] City siege and capture mechanics
- [ ] Naval and air combat (later eras)

**Diplomacy & Victory:**

- [ ] Basic diplomacy system (peace, war, trade)
- [ ] Victory conditions (conquest, science, culture, economic)
- [ ] Score tracking and leaderboards
- [ ] Game end conditions and results

🔄 **Phase 4 - Advanced Features:**

- [ ] Real-time multiplayer synchronization
- [ ] Advanced AI opponents
- [ ] Multiplayer lobby and matchmaking
- [ ] Save/load game functionality
- [ ] Replay system and game analysis
- [ ] Modding support and custom scenarios
- [ ] Custom sprite assets and tileset.tileOffset migration for enhanced visual fidelity

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
