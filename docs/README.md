# CivJS Documentation

This directory contains all database schemas, migrations, and development utilities for the CivJS project.

## 📁 Directory Structure

```
docs/
├── migrations/           # Versioned database migrations
│   ├── README.md        # Migration history and instructions
│   ├── 001_initial_schema.sql
│   ├── 002_rls_policies.sql
│   ├── 003_add_seed_generation.sql  ✨ NEW
│   └── 004_database_functions.sql
│
├── dev-utilities/       # Development tools and test data
│   ├── insert-test-user.sql
│   └── test-api.md
│
└── README.md           # This file
```

## 🚀 Recent Changes

### Seed-Based Map Generation (Migration 003)

- **Performance**: 99.97% reduction in database storage for maps
- **Architecture**: Client-side procedural generation using deterministic seeds
- **Compatibility**: Backward compatible with existing `map_tiles` data

**Before**: 80×80 map = 6,400 database records  
**After**: Any size map = 1 database record

## 📋 Migration Workflow

1. **Apply in Order**: Run migrations sequentially (001 → 002 → 003 → ...)
2. **Development**: Test on staging environment first
3. **Production**: Backup database before applying migrations
4. **Verification**: Check tables created successfully after each migration

## 🗄️ Database Schema Overview

### Core Tables

- `profiles` - User accounts (extends Supabase auth)
- `games` - Game instances and settings
- `game_players` - Player participation in games

### Game State Tables

- `game_seeds` - ✨ **NEW**: Deterministic map generation seeds
- `units` - Player units and positions
- `cities` - Player cities and buildings
- `player_state` - Resources, research, etc.

### Legacy Tables

- `map_tiles` - Individual terrain tiles (being phased out)
- `explored_tiles` - Future fog of war implementation

### Event Tracking

- `game_events` - Turn-by-turn game history
- `player_research` - Technology progress

## 🔧 Development Utilities

- **insert-test-user.sql** - Creates test user for development
- **test-api.md** - API testing documentation

## 🎯 Next Steps

1. ✅ **Migration 003 Applied** - Seed generation enabled
2. 🔄 **Server Updates** - Update `getGameState()` to return seeds
3. 🎮 **Testing** - Verify new games use seed generation
4. 🧹 **Cleanup** - Eventually remove `map_tiles` dependency

## 📊 Performance Monitoring

Track these metrics after migration:

- Database size reduction
- Game load times
- Client-side map generation performance
- Network payload reduction
