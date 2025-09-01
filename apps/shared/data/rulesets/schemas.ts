/**
 * Zod schemas for ruleset validation
 * Ensures JSON data matches TypeScript interfaces at runtime
 */

import { z } from 'zod';

// Mapgen terrain properties enum schema
export const MapgenTerrainPropertySchema = z.enum([
  'MG_COLD',
  'MG_DRY', 
  'MG_FOLIAGE',
  'MG_FROZEN',
  'MG_GREEN',
  'MG_MOUNTAINOUS',
  'MG_OCEAN_DEPTH',
  'MG_TEMPERATE',
  'MG_TROPICAL',
  'MG_WET',
  'MG_UNUSED'
]);

// Terrain types enum schema
export const TerrainTypeSchema = z.enum([
  'ocean',
  'deep_ocean',
  'coast',
  'lake',
  'tundra',
  'desert',
  'forest',
  'jungle',
  'swamp',
  'grassland',
  'plains',
  'hills',
  'mountains'
]);

// Individual terrain ruleset schema
export const TerrainRulesetSchema = z.object({
  name: TerrainTypeSchema,
  properties: z.record(z.string(), z.number()).optional().default({}),
  moveCost: z.number().positive(),
  defense: z.number().min(0),
  food: z.number().min(0),
  shields: z.number().min(0),
  trade: z.number().min(0),
  transformTo: TerrainTypeSchema.optional(),
  transformTime: z.number().positive().optional(),
  canHaveRiver: z.boolean().optional(),
  notGenerated: z.boolean().optional()
});

// Terrain ruleset file schema
export const TerrainRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number()
  }),
  about: z.object({
    name: z.string(),
    summary: z.string()
  }),
  terrains: z.record(TerrainTypeSchema, TerrainRulesetSchema)
});

// Unit schemas
export const UnitClassSchema = z.enum(['military', 'civilian', 'naval', 'air']);

export const UnitTypeRulesetSchema = z.object({
  id: z.string(),
  name: z.string(),
  cost: z.number().positive(),
  movement: z.number().positive(),
  combat: z.number().min(0),
  range: z.number().min(0),
  sight: z.number().positive(),
  canFoundCity: z.boolean(),
  canBuildImprovements: z.boolean(),
  unitClass: UnitClassSchema,
  requiredTech: z.string().optional()
});

export const UnitsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number()
  }),
  about: z.object({
    name: z.string(),
    summary: z.string()
  }),
  units: z.record(z.string(), UnitTypeRulesetSchema)
});

// Building schemas
export const BuildingEffectsSchema = z.object({
  defenseBonus: z.number().optional(),
  happinessBonus: z.number().optional(),
  foodBonus: z.number().optional(),
  scienceBonus: z.number().optional(),
  goldBonus: z.number().optional()
});

export const BuildingTypeRulesetSchema = z.object({
  id: z.string(),
  name: z.string(),
  cost: z.number().positive(),
  upkeep: z.number().min(0),
  effects: BuildingEffectsSchema
});

export const BuildingsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number()
  }),
  about: z.object({
    name: z.string(),
    summary: z.string()
  }),
  buildings: z.record(z.string(), BuildingTypeRulesetSchema)
});

// Technology schemas
export const TechnologyRulesetSchema = z.object({
  id: z.string(),
  name: z.string(),
  cost: z.number().positive(),
  requirements: z.array(z.string()),
  flags: z.array(z.string()),
  description: z.string()
});

export const TechsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number()
  }),
  about: z.object({
    name: z.string(),
    summary: z.string()
  }),
  techs: z.record(z.string(), TechnologyRulesetSchema)
});

// Type exports for use in TypeScript code
export type MapgenTerrainProperty = z.infer<typeof MapgenTerrainPropertySchema>;
export type TerrainType = z.infer<typeof TerrainTypeSchema>;
export type TerrainRuleset = z.infer<typeof TerrainRulesetSchema>;
export type TerrainRulesetFile = z.infer<typeof TerrainRulesetFileSchema>;

export type UnitClass = z.infer<typeof UnitClassSchema>;
export type UnitTypeRuleset = z.infer<typeof UnitTypeRulesetSchema>;
export type UnitsRulesetFile = z.infer<typeof UnitsRulesetFileSchema>;

export type BuildingEffects = z.infer<typeof BuildingEffectsSchema>;
export type BuildingTypeRuleset = z.infer<typeof BuildingTypeRulesetSchema>;
export type BuildingsRulesetFile = z.infer<typeof BuildingsRulesetFileSchema>;

export type TechnologyRuleset = z.infer<typeof TechnologyRulesetSchema>;
export type TechsRulesetFile = z.infer<typeof TechsRulesetFileSchema>;