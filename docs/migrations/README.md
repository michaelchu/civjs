# Database Migrations

This directory contains versioned database migrations for the CivJS project.

## Migration History

- **001_initial_schema.sql** - Initial database schema (tables, constraints, indexes)
- **002_rls_policies.sql** - Row Level Security policies for all tables
- **003_add_seed_generation.sql** - ✅ **NEW: Seed-based map generation**
- **004_database_functions.sql** - Database functions and triggers (future)

## Migration 003: Seed-Based Map Generation

### What Changed

- Added `game_seeds` table to store deterministic seeds instead of individual tiles
- Added `explored_tiles` table for future fog of war implementation
- Replaced tile-by-tile storage with single seed per game

### Performance Impact

- **Before**: 60×60 map = 3,600 database records
- **After**: Any size map = 1 database record
- **Storage reduction**: ~99.97%
- **Network transfer**: Near zero for map data

### Breaking Changes

- ⚠️ **Server**: `getGameState()` now returns `seed` instead of `map` array
- ✅ **Client**: Automatically handles both seed and legacy tile formats
- ✅ **Backward compatible**: Falls back to existing `map_tiles` if no seed exists

### How to Apply

1. **Run in Supabase SQL Editor**:

   ```sql
   -- Copy content from 003_add_seed_generation.sql
   ```

2. **Verify Tables Created**:

   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public'
   AND table_name IN ('game_seeds', 'explored_tiles');
   ```

3. **Test New Games**: Create a new game - it should use seed generation
4. **Old Games**: Continue working with existing `map_tiles` data

### Rollback (if needed)

```sql
DROP TABLE public.explored_tiles;
DROP TABLE public.game_seeds;
-- Old map_tiles table remains untouched
```

## Future Migrations

### Planned Enhancements

- **004_fog_of_war.sql** - Enable exploration tracking with `explored_tiles`
- **005_cleanup_legacy_tiles.sql** - Optional removal of `map_tiles` after full migration
- **006_map_features.sql** - Add rivers, roads, and resources to seed generation

### Migration Guidelines

1. Always create numbered migrations (001, 002, etc.)
2. Include rollback instructions
3. Test on development environment first
4. Document breaking changes clearly
5. Maintain backward compatibility when possible
