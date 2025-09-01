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
  'MG_UNUSED',
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
  'mountains',
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
  notGenerated: z.boolean().optional(),
});

// Terrain ruleset file schema
export const TerrainRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number(),
  }),
  about: z.object({
    name: z.string(),
    summary: z.string(),
  }),
  terrains: z.record(TerrainTypeSchema, TerrainRulesetSchema),
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
  requiredTech: z.string().optional(),
});

export const UnitsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number(),
  }),
  about: z.object({
    name: z.string(),
    summary: z.string(),
  }),
  units: z.record(z.string(), UnitTypeRulesetSchema),
});

// Building schemas
export const BuildingEffectsSchema = z.object({
  defenseBonus: z.number().optional(),
  happinessBonus: z.number().optional(),
  foodBonus: z.number().optional(),
  scienceBonus: z.number().optional(),
  goldBonus: z.number().optional(),
});

export const BuildingTypeRulesetSchema = z.object({
  id: z.string(),
  name: z.string(),
  cost: z.number().positive(),
  upkeep: z.number().min(0),
  effects: BuildingEffectsSchema,
});

export const BuildingsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number(),
  }),
  about: z.object({
    name: z.string(),
    summary: z.string(),
  }),
  buildings: z.record(z.string(), BuildingTypeRulesetSchema),
});

// Technology schemas - Enhanced for full freeciv compatibility
export const TechnologyRulesetSchema = z.object({
  id: z.string(),
  freeciv_id: z.number().optional(),
  name: z.string(),
  internal_name: z.string().optional(),
  cost: z.number().positive(),
  req1: z.string().optional(), // First requirement (freeciv dual system)
  req2: z.string().optional(), // Second requirement (freeciv dual system)
  requirements: z.array(z.string()), // Derived array from req1/req2
  root_req: z.string().optional(), // Root requirement for advanced dependencies
  flags: z.array(z.string()).optional().default([]),
  graphic: z.string().optional(),
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  helptext: z.string().optional(),
  bonus_message: z.string().optional(),
  order: z.number().optional(),
  description: z.string().optional(), // Keep for backward compatibility
});

export const TechsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number(),
  }),
  about: z.object({
    name: z.string(),
    summary: z.string(),
  }),
  techs: z.record(z.string(), TechnologyRulesetSchema),
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

// Government schemas
export const GovernmentRequirementSchema = z.object({
  type: z.string(),
  name: z.string(),
  range: z.string(),
});

export const GovernmentRulesetSchema = z.object({
  id: z.string(),
  name: z.string(),
  rule_name: z.string().optional(), // Internal name for savegames/rulesets
  reqs: z.array(GovernmentRequirementSchema).optional(),
  graphic: z.string(),
  graphic_alt: z.string(),
  sound: z.string(),
  sound_alt: z.string(),
  sound_alt2: z.string(),
  ai_better: z.string().optional(),
  ruler_male_title: z.string(),
  ruler_female_title: z.string(),
  helptext: z.string().or(z.array(z.string())), // Support both single string and array format
  flags: z.array(z.string()).optional(), // Government behavior flags
});

export const GovernmentsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number(),
  }),
  about: z.object({
    name: z.string(),
    summary: z.string(),
  }),
  governments: z.object({
    during_revolution: z.string(),
    types: z.record(z.string(), GovernmentRulesetSchema),
  }),
});

export type GovernmentRequirement = z.infer<typeof GovernmentRequirementSchema>;
export type GovernmentRuleset = z.infer<typeof GovernmentRulesetSchema>;
export type GovernmentsRulesetFile = z.infer<typeof GovernmentsRulesetFileSchema>;

// Requirements system schemas (used across multiple systems)
export const RequirementSchema = z.object({
  type: z.string(),
  name: z.string(),
  range: z.string(),
  present: z.boolean().optional(),
});

// Game rules and parameters schemas
export const GameParametersSchema = z.object({
  init_city_radius_sq: z.number(),
  init_vis_radius_sq: z.number(),
  base_bribe_cost: z.number(),
  ransom_gold: z.number(),
  upgrade_veteran_loss: z.number(),
  autoupgrade_veteran_loss: z.number(),
  pillage_select: z.boolean(),
  tech_steal_allow_holes: z.boolean(),
  tech_trade_allow_holes: z.boolean(),
  tech_trade_loss_allow_holes: z.boolean(),
  tech_parasite_allow_holes: z.boolean(),
  tech_loss_allow_holes: z.boolean(),
  gameloss_style: z.string(),
});

export const CivstyleSchema = z.object({
  base_pollution: z.number(),
  happy_cost: z.number(),
  food_cost: z.number(),
  granary_food_ini: z.number(),
  granary_food_inc: z.number(),
  min_city_center_food: z.number(),
  min_city_center_shield: z.number(),
  min_city_center_trade: z.number(),
});

export const GameOptionsSchema = z.object({
  global_init_techs: z.string(),
  global_init_buildings: z.string(),
});

export const GameRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number(),
  }),
  about: z.object({
    name: z.string(),
    summary: z.string(),
    description: z.string(),
  }),
  options: GameOptionsSchema,
  civstyle: CivstyleSchema,
  capabilities: z.array(z.string()),
  game_parameters: GameParametersSchema,
});

// Effects system schemas
export const EffectSchema = z.object({
  id: z.string(),
  type: z.string(),
  value: z.number(),
  reqs: z.array(RequirementSchema).optional(),
  comment: z.string().optional(),
});

export const EffectsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number(),
  }),
  about: z.object({
    name: z.string(),
    summary: z.string(),
  }),
  user_effects: z.record(z.string(), z.any()).optional(),
  effects: z.record(z.string(), EffectSchema),
});

// Nations system schemas
export const LeaderSchema = z.object({
  name: z.string(),
  sex: z.enum(['Male', 'Female']),
});

export const TraitRangeSchema = z.object({
  expansionist_min: z.number(),
  expansionist_max: z.number(),
  expansionist_default: z.number(),
  trader_min: z.number(),
  trader_max: z.number(),
  trader_default: z.number(),
  aggressive_min: z.number(),
  aggressive_max: z.number(),
  aggressive_default: z.number(),
  builder_min: z.number(),
  builder_max: z.number(),
  builder_default: z.number(),
});

export const NationRulesetSchema = z.object({
  id: z.string(),
  name: z.string(),
  plural: z.string(),
  adjective: z.string(),
  class: z.string(),
  style: z.string(),
  init_government: z.string(),
  leaders: z.array(LeaderSchema),
  init_techs: z.array(z.string()).optional(),
  init_buildings: z.array(z.string()).optional(),
  init_units: z.array(z.string()).optional(),
  civilwar_nations: z.array(z.string()).optional(),
  legend: z.string().optional(),
  flag: z.string().optional(),
  flag_alt: z.string().optional(),
  city_style: z.string().optional(),
  traits: z
    .object({
      expansionist: z.number().optional(),
      trader: z.number().optional(),
      aggressive: z.number().optional(),
      builder: z.number().optional(),
    })
    .optional(),
  groups: z.array(z.string()).optional(),
  conflicts: z.array(z.string()).optional(),
});

export const NationsCompatibilitySchema = z.object({
  default_government: z.string(),
});

export const NationsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number(),
  }),
  about: z.object({
    name: z.string(),
    summary: z.string(),
  }),
  compatibility: NationsCompatibilitySchema,
  default_traits: TraitRangeSchema,
  nations: z.record(z.string(), NationRulesetSchema),
});

// Export inferred types
export type Requirement = z.infer<typeof RequirementSchema>;
export type GameParameters = z.infer<typeof GameParametersSchema>;
export type Civstyle = z.infer<typeof CivstyleSchema>;
export type GameOptions = z.infer<typeof GameOptionsSchema>;
export type GameRulesetFile = z.infer<typeof GameRulesetFileSchema>;

export type Effect = z.infer<typeof EffectSchema>;
export type EffectsRulesetFile = z.infer<typeof EffectsRulesetFileSchema>;

export type Leader = z.infer<typeof LeaderSchema>;
export type TraitRange = z.infer<typeof TraitRangeSchema>;
export type NationRuleset = z.infer<typeof NationRulesetSchema>;
export type NationsCompatibility = z.infer<typeof NationsCompatibilitySchema>;
export type NationsRulesetFile = z.infer<typeof NationsRulesetFileSchema>;
