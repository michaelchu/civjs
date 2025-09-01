/**
 * Terrain ruleset configuration for CivJS
 * @reference freeciv/data/classic/terrain.ruleset
 * @reference freeciv/common/terrain.h:136-147
 *
 * This file now uses JSON-based rulesets loaded at runtime.
 * The original hardcoded data has been migrated to apps/shared/data/rulesets/classic/terrain.json
 *
 * For backward compatibility, this file re-exports the compatibility layer
 * that maintains the same synchronous API.
 */

// Re-export everything from the compatibility layer
export {
  MapgenTerrainProperty,
  MapgenTerrainPropertyEnum,
  TerrainType,
  TerrainRuleset,
  TERRAIN_RULESET,
  pickTerrain,
  getTerrainProperties,
  terrainHasProperty,
  getTerrainTransform,
  initializeTerrainRuleset,
  isTerrainRulesetInitialized,
  resetTerrainRuleset,
} from '../../../../shared/data/rulesets/TerrainRulesetCompat';

// Type compatibility between MapTypes and schema types is ensured
// by the re-exports above. TerrainType from schemas must match
// TerrainType from MapTypes for backward compatibility.
