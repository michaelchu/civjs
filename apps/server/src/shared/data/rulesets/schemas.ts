/**
 * @module server/shared/data/rulesets/schemas
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
// Terrain IDs are ruleset-defined: classic's familiar names are not a
// universal Freeciv vocabulary (alien, civ1 and stub prove this directly).
export const TerrainTypeSchema = z.string().min(1);

// Individual terrain ruleset schema
export const TerrainRulesetSchema = z
  .object({
    name: TerrainTypeSchema,
    graphic: z.string(),
    graphic_alt: z.string().optional(),
    graphic_alt2: z.string().optional(),
    properties: z.record(z.string(), z.number()).optional().default({}),
    moveCost: z.number().min(0),
    defense: z.number().min(0),
    food: z.number().min(0),
    shields: z.number().min(0),
    trade: z.number().min(0),
    roadTime: z.number().min(0).default(0),
    irrigationFoodIncr: z.number().min(0).default(0),
    irrigationTime: z.number().min(0).default(0),
    miningShieldIncr: z.number().min(0).default(0),
    miningTime: z.number().min(0).default(0),
    cultivateTo: TerrainTypeSchema.optional(),
    cultivateTime: z.number().min(0).default(0),
    plantTo: TerrainTypeSchema.optional(),
    plantTime: z.number().min(0).default(0),
    transformTo: TerrainTypeSchema.optional(),
    transformTime: z.number().min(0).optional(),
    canHaveRiver: z.boolean().optional(),
    notGenerated: z.boolean().optional(),
  })
  .passthrough();

// Terrain ruleset file schema
export const TerrainRulesetFileSchema = z
  .object({
    datafile: z.object({
      description: z.string(),
      options: z.string(),
      format_version: z.number(),
    }),
    about: z.object({
      name: z.string(),
      summary: z.string(),
    }),
    terrain_control: z
      .object({
        move_fragments: z.number().int().positive().optional(),
        igter_cost: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
    terrains: z.record(z.string(), TerrainRulesetSchema),
  })
  .passthrough();

// Unit schemas - Enhanced for full freeciv compatibility
// Unit classes are ruleset-defined. Classic uses Land, Sea, Air, and related
// classes; Civ2Civ3 also defines Merchant for trade units.
export const UnitClassSchema = z.string().min(1);

/**
 * Unit-class catalogue fields loaded from the classic ruleset.
 * @reference reference/freeciv/data/classic/units.ruleset:97-112
 * @reference reference/freeciv/data/classic/units.ruleset:143-188
 */
export const UnitClassRulesetSchema = z
  .object({
    id: UnitClassSchema,
    name: UnitClassSchema,
    min_speed: z.number().min(0),
    hp_loss_pct: z.number().min(0),
    flags: z.array(z.string()),
  })
  .passthrough();

export const UnitRoleSchema = z.enum([
  'FirstBuild',
  'Explorer',
  'Hut',
  'HutTech',
  'Partisan',
  'DefendOk',
  'DefendGood',
  'Ferryboat',
  'Barbarian',
  'BarbarianTech',
  'BarbarianBoat',
  'BarbarianBuild',
  'BarbarianBuildTech',
  'BarbarianLeader',
  'BarbarianSea',
  'CitiesStartUnit',
  'WorkerStartUnit',
  'ExplorerStartUnit',
  'BarbarianStartUnit',
  'Diplomat',
  'Hunter',
  // Additional freeciv classic roles
  'AirCarrier',
  'AttackFast',
  'AttackOk',
  'AttackStrong',
  'HelpWonder',
  'Marines',
  'Settlers',
  'TradeRoute',
]);

export const UnitTypeFlagSchema = z.enum([
  'TradeRoute',
  'HelpWonder',
  'IgZOC',
  'NonMil',
  'IgTer',
  'OneAttack',
  'PickTarget',
  'Partial_Invis',
  'Settlers',
  'Diplomat',
  'Trireme',
  'Nuclear',
  'Spy',
  'Transform',
  'Paratroopers',
  'Airborne',
  'Marines',
  'Helicopter',
  'Fighter',
  'Bomber',
  'AWACS',
  'Stealth',
  'Cant_Fortify',
  'No_Land_Attack',
  'AddToCity',
  'Fanatic',
  'GameLoss',
  'Unique',
  'Unbribable',
  'Undisbandable',
  'SuperSpy',
  'NoVeteran',
  'CityBuster',
  'NoBuild',
  'BadWallAttacker',
  'BadCityDefender',
  'BarbarianOnly',
  'Shield2Gold',
  'NewCityGamesOnly',
  'NoHome',
  'GainVeteran',
  'Capturable',
  'HasInitialVeteran',
  // Additional freeciv classic flags
  'AEGIS',
  'Airbase',
  'Cities',
  'FieldUnit',
  'HasNoZOC',
  'Horse',
  'Workers',
]);

export const UnitTypeRulesetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    internal_name: z.string().optional(),
    cost: z.number().positive(),
    movement: z.number().min(0).optional(), // Legacy field
    move_rate: z.number().min(0).optional(), // Freeciv field
    attack: z.number().min(0), // Separate attack from defense
    defense: z.number().min(0), // Separate defense from attack
    hitpoints: z.number().positive(), // Unit health
    firepower: z.number().positive().optional().default(1),
    bombard_rate: z.number().min(0).optional().default(0),
    paratroopers_range: z.number().min(0).optional().default(0),
    vision_radius_sq: z.number().min(0).optional().default(1),
    vision_layer: z.enum(['Main', 'Stealth', 'Subsurface']).optional().default('Main'),
    transport_cap: z.number().min(0).optional().default(0),
    cargo: z.array(UnitClassSchema).optional().default([]),
    targets: z
      .union([z.array(UnitClassSchema), UnitClassSchema])
      .transform(value => (Array.isArray(value) ? value : [value]))
      .optional()
      .default([]),
    bonuses: z
      .array(
        z.object({
          flag: z.string(),
          type: z.string().min(1),
          value: z.number(),
        })
      )
      .optional()
      .default([]),
    fuel: z.number().min(0).optional().default(0),
    uk_happy: z.number().min(0).optional().default(0), // Unhappiness from unit
    uk_shield: z.number().min(0).optional().default(1), // Shield upkeep cost
    uk_food: z.number().min(0).optional().default(0), // Food upkeep cost
    uk_gold: z.number().min(0).optional().default(0), // Gold upkeep cost
    unit_class: UnitClassSchema,
    roles: z.array(z.string()).optional().default([]),
    flags: z.array(z.string()).optional().default([]),
    required_tech: z.string().optional(),
    obsolete_by: z.string().optional(), // Technology that obsoletes this unit
    build_cost: z.number().positive().optional(), // Alternative to cost
    pop_cost: z.number().min(0).optional().default(0), // Population cost for settlers
    convert_to: z.string().optional(), // Unit to convert to
    convert_time: z.number().optional(), // Time to convert
    veteran_levels: z.number().min(1).optional().default(1), // Number of veteran levels
    // Per-unit veteran systems override the ruleset-wide veteran_system
    // section. Secfile conversion preserves single values and comma-delimited
    // lists in their original shapes, so retain both forms here.
    veteran_names: z.union([z.string(), z.array(z.string())]).optional(),
    veteran_base_raise_chance: z
      .union([z.number(), z.string(), z.array(z.number()), z.array(z.string())])
      .optional(),
    veteran_work_raise_chance: z
      .union([z.number(), z.string(), z.array(z.number()), z.array(z.string())])
      .optional(),
    veteran_power_fact: z
      .union([z.number(), z.string(), z.array(z.number()), z.array(z.string())])
      .optional(),
    veteran_move_bonus: z
      .union([z.number(), z.string(), z.array(z.number()), z.array(z.string())])
      .optional(),
    graphic: z.string().optional(),
    graphic_alt: z.string().optional(),
    sound_move: z.string().optional(),
    sound_move_alt: z.string().optional(),
    sound_fight: z.string().optional(),
    sound_fight_alt: z.string().optional(),
    helptext: z.string().or(z.array(z.string())).optional(),

    // Backward compatibility fields (deprecated)
    combat: z.number().min(0).optional(), // Keep for backward compatibility
    range: z.number().min(0).optional().default(0), // Keep for backward compatibility
    sight: z.number().positive().optional(), // Keep for backward compatibility
    canFoundCity: z.boolean().optional(), // Keep for backward compatibility
    canBuildImprovements: z.boolean().optional(), // Keep for backward compatibility
    unitClass: UnitClassSchema.optional(), // Keep for backward compatibility
    requiredTech: z.string().optional(), // Keep for backward compatibility
  })
  .passthrough();

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
  veteran_system: z.record(z.string(), z.unknown()).optional(),
  unit_classes: z.record(z.string(), UnitClassRulesetSchema),
  units: z.record(z.string(), UnitTypeRulesetSchema),
});

// Building schemas
export const BuildingEffectsSchema = z.object({
  defenseBonus: z.number().optional(),
  happinessBonus: z.number().optional(),
  foodBonus: z.number().optional(),
  scienceBonus: z.number().optional(),
  goldBonus: z.number().optional(),
  maxCitySize: z.number().optional(),
  unlimitedCitySize: z.boolean().optional(),
  oceanFood: z.number().optional(),
  oceanShields: z.number().optional(),
  immediateTechs: z.number().optional(),
  techParasitePlayers: z.number().optional(),
  corruptionReduction: z.number().optional(),
});

export const BuildingGenusSchema = z.enum([
  'Improvement',
  'SmallWonder',
  'GreatWonder',
  'Special',
  'Convert',
]);

export const BuildingCultureRequirementSchema = z.object({
  type: z.literal('MinCulture'),
  value: z.number().int().min(0),
  range: z.enum(['City', 'Player']),
  present: z.boolean().optional().default(true),
});

export const BuildingTypeRulesetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    genus: BuildingGenusSchema.optional().default('Improvement'),
    cost: z.number().positive(),
    upkeep: z.number().min(0),
    sabotage: z.number().min(0).optional(),
    requiredTech: z.string().optional(),
    requires: z.array(z.string()).optional(),
    cultureRequirements: z.array(BuildingCultureRequirementSchema).optional(),
    playable: z.boolean().optional().default(false),
    // Authoritative building behavior is expressed in effects.json. This
    // legacy-shaped field is optional only for older converted catalogues and
    // must not substitute for raw Freeciv effects in c2c3.
    effects: BuildingEffectsSchema.optional().default({}),
  })
  .passthrough();

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
export const TechnologyRulesetSchema = z
  .object({
    id: z.string(),
    freeciv_id: z.number().optional(),
    name: z.string(),
    internal_name: z.string().optional(),
    // Freeciv only reads per-tech costs for the Classic+ and Experimental+
    // styles. Other styles derive them from the dependency graph at runtime.
    cost: z.number().positive().optional(),
    req1: z.string().optional(), // First requirement (freeciv dual system)
    req2: z.string().optional(), // Second requirement (freeciv dual system)
    requirements: z.array(z.string()), // Derived array from req1/req2
    root_req: z.string().nullable().optional(), // Root requirement for advanced dependencies
    flags: z.array(z.string()).optional().default([]),
    graphic: z.string().optional(),
    position: z
      .object({
        x: z.number(),
        y: z.number(),
      })
      .optional(),
    helptext: z.string().or(z.array(z.string())).optional(),
    bonus_message: z.string().optional(),
    order: z.number().optional(),
    description: z.string().optional(), // Keep for backward compatibility
  })
  .passthrough();

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
  control: z.record(z.string(), z.unknown()).optional(),
  techs: z.record(z.string(), TechnologyRulesetSchema),
});

// Type exports for use in TypeScript code
export type MapgenTerrainProperty = z.infer<typeof MapgenTerrainPropertySchema>;
export type TerrainType = z.infer<typeof TerrainTypeSchema>;
export type TerrainRuleset = z.infer<typeof TerrainRulesetSchema>;
export type TerrainRulesetFile = z.infer<typeof TerrainRulesetFileSchema>;

export type UnitClass = z.infer<typeof UnitClassSchema>;
export type UnitClassRuleset = z.infer<typeof UnitClassRulesetSchema>;
export type UnitTypeRuleset = z.infer<typeof UnitTypeRulesetSchema>;
export type UnitsRulesetFile = z.infer<typeof UnitsRulesetFileSchema>;

export type BuildingEffects = z.infer<typeof BuildingEffectsSchema>;
export type BuildingCultureRequirement = z.infer<typeof BuildingCultureRequirementSchema>;
export type BuildingTypeRuleset = z.infer<typeof BuildingTypeRulesetSchema>;
export type BuildingsRulesetFile = z.infer<typeof BuildingsRulesetFileSchema>;

export type TechnologyRuleset = z.infer<typeof TechnologyRulesetSchema>;
export type TechsRulesetFile = z.infer<typeof TechsRulesetFileSchema>;

// Government schemas
// These are the requirement kinds with concrete handlers in EffectsManager.
// Freeciv evaluates requirements by universal kind and rejects unsupported
// kinds while loading rulesets.
// @reference reference/freeciv/common/requirements.c:1108-1120
export const GovernmentRequirementTypeSchema = z.enum([
  'Activity',
  'Age',
  'Building',
  'CityStatus',
  'CityTile',
  'Extra',
  'Gov',
  'Government',
  'MaxUnitsOnTile',
  'NationGroup',
  'OutputType',
  'Player',
  'Specialist',
  'Tech',
  'Terrain',
  'TerrainClass',
  'UnitClass',
  'UnitClassFlag',
  'UnitType',
  'UnitTypeFlag',
  'tech',
]);

export const GovernmentRequirementSchema = z.object({
  type: GovernmentRequirementTypeSchema,
  name: z.string(),
  range: z.string(),
});

export const GovernmentRulesetSchema = z
  .object({
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
  })
  .passthrough();

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

// Requirement kinds currently represented by the ported classic effects data.
// @reference reference/freeciv/data/classic/effects.ruleset:50-710
// @reference reference/freeciv/common/requirements.c:4803-4828
export const EffectRequirementTypeSchema = z.enum([
  'AI',
  'Achievement',
  'Action',
  'Activity',
  'Age',
  'Building',
  'BuildingFlag',
  'BuildingGenus',
  'CityStatus',
  'CityTile',
  'Counter',
  'DiplRel',
  'Extra',
  'ExtraFlag',
  'Gov',
  'MaxDistanceSq',
  'MaxRegionTiles',
  'MaxUnitsOnTile',
  'MinCulture',
  'MinSize',
  'MinTechs',
  'MinVeteran',
  'MinYear',
  'Nation',
  'NationGroup',
  'OutputType',
  'Specialist',
  'Tech',
  'Terrain',
  'TerrainAlter',
  'TerrainClass',
  'TerrainFlag',
  'TileRel',
  'Topology',
  'UnitClass',
  'UnitClassFlag',
  'UnitState',
  'UnitType',
  'UnitTypeFlag',
]);

export const EffectRequirementSchema = RequirementSchema.extend({
  type: EffectRequirementTypeSchema,
});

// Requirement rows retained from classic actions, extras, and styles. These
// are the universal kinds present in the shipped source files, rather than a
// hand-picked subset of the kinds already consumed by EffectsManager.
// @reference reference/freeciv/common/requirements.c:4803-4828
// Preserve unfamiliar requirement kinds from other reference rulesets. The
// evaluator reports unsupported kinds at runtime instead of rejecting data.
export const RulesetRequirementTypeSchema = z.string().min(1);

export const RulesetRequirementRangeSchema = z.string().min(1);

export const RulesetRequirementSchema = z.object({
  type: RulesetRequirementTypeSchema,
  name: z.union([z.string(), z.number()]).transform(String),
  range: RulesetRequirementRangeSchema,
  present: z.boolean().optional().default(true),
});

const RulesetMetadataSchema = z.object({
  source: z.string().min(1),
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number(),
  }),
});

export const ActionEnablerSchema = z.object({
  id: z.string().startsWith('enabler_'),
  action: z.string().min(1),
  actor_reqs: z.array(RulesetRequirementSchema),
  target_reqs: z.array(RulesetRequirementSchema),
  comment: z.string().optional(),
});

export const ActionsRulesetFileSchema = RulesetMetadataSchema.extend({
  auto_attack: z
    .object({
      if_attacker: z.array(RulesetRequirementSchema).default([]),
      attack_actions: z.array(z.string()).default([]),
    })
    .passthrough(),
  settings: z.record(z.string(), z.unknown()),
  action_properties: z.record(z.string(), z.record(z.string(), z.unknown())),
  enablers: z.array(ActionEnablerSchema),
});

export const ExtraRulesetSchema = z
  .object({
    name: z.string(),
    rule_name: z.string().optional(),
    category: z.string(),
    causes: z.union([z.string(), z.array(z.string())]).optional(),
    rmcauses: z.union([z.string(), z.array(z.string())]).optional(),
    flags: z.union([z.string(), z.array(z.string())]).optional(),
    buildable: z.boolean().optional(),
    build_time: z.number().min(0).optional(),
    removal_time: z.number().min(0).optional(),
    graphic: z.string().optional(),
    graphic_alt: z.string().optional(),
    reqs: z.array(RulesetRequirementSchema).optional(),
  })
  .passthrough();

export const ResourceRulesetSchema = z
  .object({
    extra: z.string().optional(),
    reveal_tech: z.string().min(1).optional(),
  })
  .passthrough();

export const ExtrasRulesetFileSchema = RulesetMetadataSchema.extend({
  resources: z.record(z.string(), ResourceRulesetSchema),
  extras: z.record(z.string(), ExtraRulesetSchema),
  bases: z.record(z.string(), z.record(z.string(), z.unknown())),
  roads: z.record(z.string(), z.record(z.string(), z.unknown())),
  terrain_extra_settings: z.record(
    z.string(),
    z.object({
      terrain: z.string(),
      extra_settings: z.array(
        z.object({
          extra: z.string(),
          removal_time: z.number().min(0),
        })
      ),
    })
  ),
});

export const NationStyleSchema = z.object({
  name: z.string(),
  rule_name: z.string().optional(),
});

export const RulesetCityStyleSchema = z
  .object({
    name: z.string(),
    rule_name: z.string().optional(),
    graphic: z.string(),
    graphic_alt: z.string().optional(),
    citizens_graphic: z.string().optional(),
    reqs: z.array(RulesetRequirementSchema),
  })
  .passthrough();

export const MusicStyleSchema = z.object({
  music_peaceful: z.string(),
  music_combat: z.string(),
  reqs: z.array(RulesetRequirementSchema).default([]),
});

export const StylesRulesetFileSchema = RulesetMetadataSchema.extend({
  nation_styles: z.record(z.string(), NationStyleSchema),
  city_styles: z.record(z.string(), RulesetCityStyleSchema),
  music_styles: z.record(z.string(), MusicStyleSchema),
});

// Game rules and parameters schemas
export const GameParametersSchema = z.object({
  init_city_radius_sq: z.number(),
  init_vis_radius_sq: z.number(),
  base_bribe_cost: z.number().default(0),
  base_incite_cost: z.number().default(0),
  incite_improvement_factor: z.number(),
  incite_unit_factor: z.number(),
  incite_total_factor: z.number(),
  ransom_gold: z.number(),
  upgrade_veteran_loss: z.number(),
  autoupgrade_veteran_loss: z.number(),
  pillage_select: z.boolean(),
  tech_steal_allow_holes: z.boolean(),
  tech_trade_allow_holes: z.boolean(),
  tech_trade_loss_allow_holes: z.boolean(),
  tech_parasite_allow_holes: z.boolean(),
  tech_loss_allow_holes: z.boolean(),
  gameloss_style: z
    .union([z.string(), z.array(z.string())])
    .transform(value => (Array.isArray(value) ? value.join(',') : value)),
  paradrop_to_transport: z.boolean(),
  gold_upkeep_style: z.enum(['City', 'Mixed', 'Nation']),
  output_granularity: z.number().positive(),
  airlift_from_always_enabled: z.boolean(),
  airlift_to_always_enabled: z.boolean(),
});

export const CivstyleSchema = z.object({
  base_pollution: z.number().default(0),
  happy_cost: z.number().default(0),
  food_cost: z.number().default(0),
  granary_food_ini: z.union([z.number(), z.array(z.number()).min(1)]),
  granary_food_inc: z.number(),
  min_city_center_food: z.number(),
  min_city_center_shield: z.number(),
  min_city_center_trade: z.number(),
});

export const GameOptionsSchema = z.object({
  global_init_techs: z
    .union([z.string(), z.array(z.string())])
    .transform(value => (Array.isArray(value) ? value.join(',') : value)),
  global_init_buildings: z
    .union([z.string(), z.array(z.string())])
    .transform(value => (Array.isArray(value) ? value.join(',') : value)),
});

export const ResearchRulesSchema = z.object({
  tech_cost_style: z.string(),
  base_tech_cost: z.number(),
  min_tech_cost: z.number(),
  tech_leakage: z.string(),
  tech_upkeep_style: z.enum(['None', 'Basic', 'Cities']),
  tech_upkeep_divider: z.number().positive().default(1),
  free_tech_method: z.string(),
});

export const CombatRulesSchema = z.object({
  tired_attack: z.boolean(),
  only_killing_makes_veteran: z.boolean(),
  only_real_fight_makes_veteran: z.boolean(),
  combat_odds_scaled_veterancy: z.boolean(),
  damage_reduces_bombard_rate: z.boolean(),
  low_firepower_badwallattacker: z.number().int().min(0),
  low_firepower_pearl_harbor: z.number().int().min(0),
  low_firepower_combat_bonus: z.number().int().min(0),
  low_firepower_nonnat_bombard: z.number().int().min(0),
  nuke_pop_loss_pct: z.number().min(0).max(100),
  nuke_defender_survival_chance_pct: z.number().min(0).max(100),
});

export const BorderRulesSchema = z.object({
  radius_sq_city: z.number().int().min(0),
  size_effect: z.number().int(),
  radius_sq_city_permanent: z.number().int(),
});

export const CultureRulesSchema = z.object({
  victory_min_points: z.number().int().min(0),
  victory_lead_pct: z.number().min(0),
  history_interest_pml: z.number().int(),
  migration_pml: z.number().int(),
});

export const CalendarRulesSchema = z.object({
  start_year: z.number().int().default(-4000),
  skip_year_0: z.boolean(),
  fragments: z.number().int().min(0),
  fragment_names: z.array(z.string()),
  positive_label: z.string(),
  negative_label: z.string(),
});

export const DisasterRulesSchema = z.object({
  name: z.string(),
  reqs: z.array(RulesetRequirementSchema).optional().default([]),
  frequency: z.number().int().min(0),
  effects: z.union([z.string(), z.array(z.string())]),
});

export const TradeSettingSchema = z.object({
  type: z.string(),
  pct: z.number().int().min(0),
  cancelling: z.enum(['Active', 'Inactive', 'Cancel']),
  bonus: z.enum(['None', 'Gold', 'Science', 'Both']),
});

export const TradeRulesSchema = z.object({
  settings: z.array(TradeSettingSchema),
  min_trade_route_val: z.number().int().min(0),
  reveal_trade_partner: z.boolean(),
  goods_selection: z.enum(['Leaving', 'Arrival']),
});

export const GameRulesetFileSchema = z.object({
  source: z.string(),
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number(),
  }),
  ruledit: z.object({
    description_file: z.string().default(''),
    std_tileset_compat: z.boolean(),
  }),
  about: z.object({
    name: z.string(),
    summary: z.string(),
    description: z.string().default(''),
  }),
  options: GameOptionsSchema,
  tileset: z.record(z.string(), z.unknown()),
  soundset: z.record(z.string(), z.unknown()),
  musicset: z.record(z.string(), z.unknown()),
  civstyle: CivstyleSchema,
  capabilities: z.array(z.string()),
  game_parameters: GameParametersSchema,
  wonder_visibility: z.object({ small_wonders: z.enum(['Always', 'Never', 'Embassy']) }),
  illness: z.object({
    illness_on: z.boolean(),
    illness_base_factor: z.number().int().min(0),
    illness_min_size: z.number().int().min(0),
    illness_trade_infection: z.number().int().min(0),
    illness_pollution_factor: z.number().int().min(0),
  }),
  combat_rules: CombatRulesSchema,
  borders: BorderRulesSchema,
  research: ResearchRulesSchema,
  culture: CultureRulesSchema,
  world_peace: z.object({ victory_turns: z.number().int().min(0) }),
  calendar: CalendarRulesSchema,
  disasters: z.record(z.string(), DisasterRulesSchema),
  trade: TradeRulesSchema,
  goods: z.record(z.string(), z.record(z.string(), z.unknown())),
  access_area: z.object({ access_unit: z.string() }),
  diplomacy_clauses: z.record(
    z.string(),
    z.object({
      type: z.string(),
      giver_reqs: z.array(RulesetRequirementSchema).optional(),
      receiver_reqs: z.array(RulesetRequirementSchema).optional(),
      either_reqs: z.array(RulesetRequirementSchema).optional(),
    })
  ),
  player_colors: z.object({
    'background.r': z.number().int().min(0).max(255),
    'background.g': z.number().int().min(0).max(255),
    'background.b': z.number().int().min(0).max(255),
    colorlist: z.array(
      z.object({
        r: z.number().int().min(0).max(255),
        g: z.number().int().min(0).max(255),
        b: z.number().int().min(0).max(255),
      })
    ),
  }),
  teams: z.record(z.string(), z.unknown()),
  settings: z.record(z.string(), z.unknown()),
});

// Effects system schemas
// Runtime-supported CivJS effects plus the explicitly inert effect types
// already present in the classic data. Freeciv resolves effect type names to
// its enum and rejects unknown names during ruleset loading.
// @reference reference/freeciv/gen_headers/enums/effects_enums.def:5-167
// @reference reference/freeciv/server/ruleset/ruleload.c:6342-6363
export const EffectTypeSchema = z
  .string()
  .min(1)
  .describe('Freeciv effect type; runtime support is reported by EffectsManager');
/* Runtime-supported effects are enumerated by EffectsManager.EffectType. */
/*
  'Output_Waste',
  'Output_Waste_By_Distance',
  'Output_Waste_By_Rel_Distance',
  'Output_Waste_Pct',
  'Gov_Center',
  'Make_Happy',
  'Make_Content',
  'Make_Content_Mil',
  'Make_Content_Mil_Per',
  'Force_Content',
  'No_Unhappy',
  'Martial_Law_By_Unit',
  'Martial_Law_Max',
  'City_Unhappy_Size',
  'Revolution_Unhappiness',
  'Upkeep_Free',
  'Unit_Upkeep_Free_Per_City',
  'Upkeep_Pct',
  'Unhappy_Factor',
  'Shield2Gold_Pct',
  'Specialist_Output',
  'Output_Bonus',
  'Output_Bonus_2',
  'Output_Add_Tile',
  'Output_Inc_Tile',
  'Output_Inc_Tile_Celebrate',
  'Output_Penalty_Tile',
  'Size_Adj',
  'Size_Unlimit',
  'Rapture_Grow',
  'Max_Rates',
  'Max_Trade_Routes',
  'Pollu_Pop_Pct',
  'Pollu_Pop_Pct_2',
  'Pollu_Prod_Pct',
  'Give_Imm_Tech',
  'Tech_Parasite',
  'Unit_Vision_Radius_Sq',
  'Fortify_Defense_Bonus',
  'Defend_Bonus',
  'Growth_Food',
  'Shrink_Food',
  'Veteran_Build',
  'HP_Regen',
  'Performance',
  'History',
  'National_Performance',
  'National_History',
  'Culture_Pct',
  'Border_Vision',
  'Border_Strength_Pct',
  'Any_Government',
  'No_Anarchy',
  'Has_Senate',
  // Shipped but intentionally inert until their gameplay systems are ported.
  'No_Diplomacy',
  'Turn_Years',
  'Turn_Fragments',
  'Slow_Down_Timeline',
  'Retire_Pct',
  'Tech_Upkeep_Free',
  'Min_HP_Pct',
  'HP_Regen_2',
*/

export const EffectSchema = z.object({
  id: z.string(),
  type: EffectTypeSchema,
  value: z.number(),
  reqs: z.array(EffectRequirementSchema).optional(),
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
  expansionist_min: z.number().default(0),
  expansionist_max: z.number().default(0),
  expansionist_default: z.number().default(0),
  trader_min: z.number().default(0),
  trader_max: z.number().default(0),
  trader_default: z.number().default(0),
  aggressive_min: z.number().default(0),
  aggressive_max: z.number().default(0),
  aggressive_default: z.number().default(0),
  builder_min: z.number().default(0),
  builder_max: z.number().default(0),
  builder_default: z.number().default(0),
});

export const NationRulesetSchema = z
  .object({
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
    legend: z.string().or(z.array(z.string())).optional(),
    flag: z.string().optional(),
    flag_alt: z.string().optional(),
    city_style: z.string().optional(),
    traits: z.record(z.string(), z.number()).optional(),
    groups: z.array(z.string()).optional(),
    sets: z.array(z.string()).optional(),
    conflicts: z.array(z.string()).optional(),
    cities: z.array(z.string()).optional(),
  })
  .passthrough();

export const NationsCompatibilitySchema = z
  .object({
    default_government: z.string(),
    default_nationset: z.string().optional(),
  })
  .passthrough();

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
  nation_sets: z.record(z.string(), z.record(z.string(), z.unknown())).optional().default({}),
  nation_groups: z.record(z.string(), z.record(z.string(), z.unknown())).optional().default({}),
  nations: z.record(z.string(), NationRulesetSchema),
});

// Export inferred types
export type Requirement = z.infer<typeof RequirementSchema>;
export type EffectRequirement = z.infer<typeof EffectRequirementSchema>;
export type RulesetRequirement = z.infer<typeof RulesetRequirementSchema>;
export type RulesetRequirementRange = z.infer<typeof RulesetRequirementRangeSchema>;
export type ActionEnabler = z.infer<typeof ActionEnablerSchema>;
export type ActionsRulesetFile = z.infer<typeof ActionsRulesetFileSchema>;
export type ExtraRuleset = z.infer<typeof ExtraRulesetSchema>;
export type ResourceRuleset = z.infer<typeof ResourceRulesetSchema>;
export type ExtrasRulesetFile = z.infer<typeof ExtrasRulesetFileSchema>;
export type NationStyle = z.infer<typeof NationStyleSchema>;
export type RulesetCityStyle = z.infer<typeof RulesetCityStyleSchema>;
export type MusicStyle = z.infer<typeof MusicStyleSchema>;
export type StylesRulesetFile = z.infer<typeof StylesRulesetFileSchema>;
export type GameParameters = z.infer<typeof GameParametersSchema>;
export type Civstyle = z.infer<typeof CivstyleSchema>;
export type GameOptions = z.infer<typeof GameOptionsSchema>;
export type CombatRules = z.infer<typeof CombatRulesSchema>;
export type BorderRules = z.infer<typeof BorderRulesSchema>;
export type CultureRules = z.infer<typeof CultureRulesSchema>;
export type CalendarRules = z.infer<typeof CalendarRulesSchema>;
export type TradeRules = z.infer<typeof TradeRulesSchema>;
export type GameRulesetFile = z.infer<typeof GameRulesetFileSchema>;

export type Effect = z.infer<typeof EffectSchema>;
export type EffectsRulesetFile = z.infer<typeof EffectsRulesetFileSchema>;

export type Leader = z.infer<typeof LeaderSchema>;
export type TraitRange = z.infer<typeof TraitRangeSchema>;
export type NationRuleset = z.infer<typeof NationRulesetSchema>;
export type NationsCompatibility = z.infer<typeof NationsCompatibilitySchema>;
export type NationsRulesetFile = z.infer<typeof NationsRulesetFileSchema>;

// Cities ruleset schemas - for city styles and founding rules
export const CityStyleSchema = z.object({
  name: z.string(),
  graphic: z.string(),
  graphic_alt: z.string().optional(),
  citizens_graphic: z.string().optional(),
  citizens_graphic_alt: z.string().optional(),
  techreq: z.string().optional(), // Technology requirement
  replaced_by: z.string().optional(), // Which style replaces this one
  oceanic_city_style: z.boolean().optional(),
});

export const CityFoundingRulesSchema = z.object({
  // Terrain restrictions for city founding
  no_cities_terrains: z.array(TerrainTypeSchema).default([]),

  // Units allowed to found cities
  founding_units: z.array(z.string()).default(['Settlers']),

  // Whether cities can be founded on foreign territory
  allow_foreign_territory: z.boolean().default(false),

  // Whether enemy units block city founding
  enemy_units_block: z.boolean().default(true),

  // Minimum exploration requirement (0 = none, 1 = tile must be seen, 2 = tile must be explored)
  exploration_requirement: z.number().min(0).max(2).default(1),
});

export const SpecialistRulesetSchema = z
  .object({
    name: z.string(),
    rule_name: z.string().optional(),
    short_name: z.string(),
    graphic: z.string(),
    reqs: z.array(RequirementSchema).optional().default([]),
    helptext: z.string().or(z.array(z.string())).optional(),
  })
  .passthrough();

export const CitiesRulesetFileSchema = z.object({
  datafile: z.object({
    description: z.string(),
    options: z.string(),
    format_version: z.number(),
  }),
  about: z.object({
    name: z.string(),
    summary: z.string(),
  }),
  specialists: z.record(z.string(), SpecialistRulesetSchema),
  parameters: z.record(z.string(), z.unknown()),
  citizen: z.record(z.string(), z.unknown()),
  city_styles: z.record(z.string(), CityStyleSchema),
  founding_rules: CityFoundingRulesSchema,
});

export type CityStyle = z.infer<typeof CityStyleSchema>;
export type CityFoundingRules = z.infer<typeof CityFoundingRulesSchema>;
export type CitiesRulesetFile = z.infer<typeof CitiesRulesetFileSchema>;
