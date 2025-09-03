# CivJS - Modern Civilization Game

[![Server Coverage](https://img.shields.io/badge/Server%20Coverage-Loading...-lightgrey)](https://github.com/michaelchu/civjs/actions)

A modern web-based civilization game built with TypeScript, React, and Node.js. This project ports the freeciv-web 2D client with a modern React architecture while maintaining compatibility with civilization game mechanics.

## 🏗️ Architecture

This is a monorepo containing:

- **`apps/client`** - React/TypeScript frontend with Canvas 2D rendering
- **`apps/server`** - Node.js/Socket.IO backend with PostgreSQL and Redis

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Git

### Development Setup

1. **Clone the repository**
   ```bash
   git clone git@github.com:michaelchu/civjs.git
   cd civjs
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start with Docker (recommended)**
   ```bash
   npm run docker:build
   ```

4. **Or start locally**
   ```bash
   # Start both client and server
   npm run dev
   
   # Or start individually
   npm run dev:client  # http://localhost:3000
   npm run dev:server  # http://localhost:3001
   ```

## 🐳 Docker Setup

The project includes a complete Docker setup with:

- **Frontend**: React app on port 3000
- **Backend**: Node.js server on port 3001  
- **Database**: PostgreSQL on port 5432
- **Cache**: Redis on port 6379

```bash
# Start all services
docker-compose up --build

# Stop all services  
docker-compose down
```

## 📁 Project Structure

```
civjs/
├── apps/
│   ├── client/              # React frontend
│   │   ├── src/
│   │   │   ├── components/  # React components
│   │   │   ├── services/    # API clients
│   │   │   ├── store/       # State management (Zustand)
│   │   │   └── types/       # Local type definitions
│   │   ├── Dockerfile.dev
│   │   └── package.json
│   └── server/              # Node.js backend
│       ├── src/
│       │   ├── game/        # Game logic managers
│       │   ├── network/     # Socket.IO handlers
│       │   ├── database/    # PostgreSQL & Redis
│       │   └── types/       # Server type definitions
│       ├── Dockerfile
│       └── package.json
├── docker-compose.yml       # Multi-container setup
└── package.json            # Root scripts and dev dependencies
```

## 🎮 Features

### Client (React/TypeScript)
- **Modern React Architecture** - React 19 with TypeScript
- **Canvas 2D Rendering** - Ported from freeciv-web with HTML5 Canvas
- **Real-time Communication** - Socket.IO for live multiplayer
- **State Management** - Zustand for client-side game state
- **Modern UI** - Tailwind CSS with responsive design
- **Hot Reload** - Vite development server

### Server (Node.js/TypeScript)
- **Socket.IO Server** - Real-time multiplayer communication
- **PostgreSQL Database** - Game state persistence with Drizzle ORM
- **Redis Cache** - Session management and caching
- **Game Managers** - Modular game logic (Cities, Units, Turn, etc.)
- **TypeScript** - Fully typed server implementation

### Development Tools
- **Code Quality** - ESLint, Prettier, and comprehensive testing setup
- **Type Safety** - Full TypeScript coverage across client and server
- **Hot Reload** - Fast development with Vite and nodemon

## 🛠️ Development

### Available Scripts

```bash
# Development
npm run dev              # Start both client and server
npm run dev:client       # Start only frontend
npm run dev:server       # Start only backend

# Building
npm run build            # Build all packages
npm run build:client     # Build frontend only
npm run build:server     # Build backend only

# Testing
npm run test             # Run all tests
npm run test:client      # Test frontend only
npm run test:server      # Test backend only

# Code Quality
npm run lint             # Lint all packages
npm run lint:fix         # Fix linting issues
npm run typecheck        # Type checking

# Docker
npm run docker:build     # Build and start containers
npm run docker:up        # Start existing containers
npm run docker:down      # Stop all containers

# Utilities
npm run clean            # Clean all build artifacts
```

### Adding Dependencies

```bash
# Add to client
cd apps/client && npm install <package>

# Add to server  
cd apps/server && npm install <package>

# Add to both client and server
cd apps/client && npm install <package> && cd ../server && npm install <package>

# Add to root (dev dependencies)
npm install <package> --save-dev
```

## 🎯 Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Zustand, Socket.IO Client
- **Backend**: Node.js, TypeScript, Socket.IO, Express, Drizzle ORM
- **Database**: PostgreSQL 16, Redis 7
- **DevOps**: Docker, Docker Compose
- **Tools**: ESLint, Prettier, Jest, Vitest

## 🔧 Configuration

### Environment Variables

Create `.env` files in respective apps:

**`apps/server/.env`**
```
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://civjs:civjs_secret@localhost:5432/civjs
REDIS_URL=redis://localhost:6379
SOCKET_CORS_ORIGIN=http://localhost:3000
```

**`apps/client/.env`**
```
VITE_SERVER_URL=http://localhost:3001
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'Add my feature'`
4. Push to branch: `git push origin feature/my-feature`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Freeciv Project** - Original civilization game implementation
- **Freeciv-web** - Web client implementation that inspired this port
- **Civilization Series** - Game mechanics and design inspiration

## 📞 Support

For questions, issues, or contributions:
- Open an issue on GitHub
- Check the [documentation](docs/)
- Review existing discussions and PRs

---

Built with ❤️ using modern web technologies