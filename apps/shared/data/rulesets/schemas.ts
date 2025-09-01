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

// Type exports for use in TypeScript code
export type MapgenTerrainProperty = z.infer<typeof MapgenTerrainPropertySchema>;
export type TerrainType = z.infer<typeof TerrainTypeSchema>;
export type TerrainRuleset = z.infer<typeof TerrainRulesetSchema>;
export type TerrainRulesetFile = z.infer<typeof TerrainRulesetFileSchema>;