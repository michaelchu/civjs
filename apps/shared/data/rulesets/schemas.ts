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

// Government schemas
export const GovernmentRulesetSchema = z.object({
  id: z.string(),
  name: z.string(),
  rule_name: z.string().optional(),
  reqs: z.array(z.object({
    type: z.string(),
    name: z.string(),
    range: z.string().optional()
  })).optional(),
  graphic: z.string(),
  graphic_alt: z.string(),
  sound: z.string(),
  sound_alt: z.string().optional(),
  sound_alt2: z.string().optional(),
  ai_better: z.string().optional(),
  ruler_male_title: z.string(),
  ruler_female_title: z.string(),
  helptext: z.string().optional()
});

export const GovernmentsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number()
  }),
  about: z.object({
    name: z.string(),
    summary: z.string()
  }),
  governments: z.object({
    during_revolution: z.string(),
    types: z.record(z.string(), GovernmentRulesetSchema)
  })
});

// Nation schemas
export const NationTraitsSchema = z.object({
  expansionist_min: z.number().optional(),
  expansionist_max: z.number().optional(),
  expansionist_default: z.number().optional(),
  trader_min: z.number().optional(),
  trader_max: z.number().optional(),
  trader_default: z.number().optional(),
  aggressive_min: z.number().optional(),
  aggressive_max: z.number().optional(),
  aggressive_default: z.number().optional(),
  builder_min: z.number().optional(),
  builder_max: z.number().optional(),
  builder_default: z.number().optional()
});

export const NationRulesetSchema = z.object({
  id: z.string(),
  name: z.string(),
  plural: z.string(),
  adjective: z.string(),
  class: z.string().optional(),
  style: z.string().optional(),
  init_government: z.string().optional(),
  leaders: z.array(z.object({
    name: z.string(),
    sex: z.enum(['Male', 'Female'])
  })).optional(),
  cities: z.array(z.string()).optional(),
  traits: NationTraitsSchema.optional(),
  flag: z.string().optional(),
  flag_alt: z.string().optional(),
  civilwar_nations: z.array(z.string()).optional(),
  legend: z.string().optional()
});

export const NationsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number()
  }),
  about: z.object({
    name: z.string(),
    summary: z.string()
  }),
  compatibility: z.object({
    default_government: z.string()
  }),
  default_traits: NationTraitsSchema.optional(),
  nations: z.record(z.string(), NationRulesetSchema)
});

// Game rules schemas
export const CivStyleSchema = z.object({
  base_pollution: z.number(),
  happy_cost: z.number(),
  food_cost: z.number(),
  granary_food_ini: z.number(),
  granary_food_inc: z.number(),
  min_city_center_food: z.number(),
  min_city_center_shield: z.number(),
  min_city_center_trade: z.number().optional()
});

export const GameRulesSchema = z.object({
  global_init_techs: z.string(),
  global_init_buildings: z.string(),
  civstyle: CivStyleSchema,
  calendar: z.object({
    skip_year_0: z.boolean().optional(),
    start_year: z.number().optional(),
    fragments: z.array(z.object({
      name: z.string(),
      abbreviation: z.string(),
      months: z.number()
    })).optional()
  }).optional()
});

export const GameRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number()
  }),
  about: z.object({
    name: z.string(),
    summary: z.string(),
    description: z.string().optional()
  }),
  options: z.object({
    global_init_techs: z.string(),
    global_init_buildings: z.string()
  }),
  civstyle: CivStyleSchema,
  capabilities: z.array(z.string()).optional()
});

// Effects system schemas
export const RequirementSchema = z.object({
  type: z.string(),
  name: z.string(),
  range: z.string().optional(),
  present: z.boolean().optional()
});

export const EffectSchema = z.object({
  id: z.string(),
  type: z.string(),
  value: z.number(),
  multiplier: z.string().optional(),
  reqs: z.array(RequirementSchema).optional(),
  comment: z.string().optional()
});

export const EffectsRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number()
  }),
  about: z.object({
    name: z.string(),
    summary: z.string()
  }),
  user_effects: z.record(z.string(), z.object({
    type: z.string(),
    ai_valued_as: z.string().optional()
  })).optional(),
  effects: z.record(z.string(), EffectSchema)
});

// Requirements system (standalone for reuse)
export const RequirementTypeSchema = z.enum([
  'Tech', 'Building', 'Government', 'Terrain', 'Nation', 'UnitType', 
  'City', 'Player', 'World', 'Age', 'TerrainClass', 'NationGroup',
  'Specialist', 'OutputType', 'MinSize', 'MaxUnitsOnTile', 'CityTile'
]);

export const RequirementRangeSchema = z.enum([
  'Local', 'Adjacent', 'City', 'Player', 'World', 'Tile', 'Continent'
]);

export const DetailedRequirementSchema = z.object({
  type: RequirementTypeSchema,
  name: z.string(),
  range: RequirementRangeSchema.optional(),
  present: z.boolean().optional(),
  survives: z.boolean().optional()
});

// Type exports for government system
export type GovernmentRuleset = z.infer<typeof GovernmentRulesetSchema>;
export type GovernmentsRulesetFile = z.infer<typeof GovernmentsRulesetFileSchema>;

// Type exports for nation system
export type NationTraits = z.infer<typeof NationTraitsSchema>;
export type NationRuleset = z.infer<typeof NationRulesetSchema>;
export type NationsRulesetFile = z.infer<typeof NationsRulesetFileSchema>;

// Type exports for game rules
export type CivStyle = z.infer<typeof CivStyleSchema>;
export type GameRules = z.infer<typeof GameRulesSchema>;
export type GameRulesetFile = z.infer<typeof GameRulesetFileSchema>;

// Type exports for effects system
export type Requirement = z.infer<typeof RequirementSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type EffectsRulesetFile = z.infer<typeof EffectsRulesetFileSchema>;

// Type exports for requirements system
export type RequirementType = z.infer<typeof RequirementTypeSchema>;
export type RequirementRange = z.infer<typeof RequirementRangeSchema>;
export type DetailedRequirement = z.infer<typeof DetailedRequirementSchema>;