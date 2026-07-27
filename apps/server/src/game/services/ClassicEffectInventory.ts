export type ClassicEffectDisposition = 'implemented' | 'pending';

export interface ClassicEffectCoverage {
  disposition: ClassicEffectDisposition;
  consumer: string;
}

const implemented = (consumer: string): ClassicEffectCoverage => ({
  disposition: 'implemented',
  consumer,
});

/**
 * Executable accounting for every effect type shipped in classic/effects.json.
 * Adding or removing a converted effect type requires an explicit runtime
 * classification and keeps silent, schema-only support from being called
 * parity.
 */
export const CLASSIC_EFFECT_COVERAGE: Readonly<Record<string, ClassicEffectCoverage>> = {
  Border_Strength_Pct: implemented('BorderManager'),
  Slow_Down_Timeline: implemented('TurnManager calendar progression'),
  City_Unhappy_Size: implemented('CityHappinessService'),
  Defend_Bonus: implemented('UnitManager combat'),
  Fortify_Defense_Bonus: implemented('UnitManager combat'),
  Give_Imm_Tech: implemented('production completion'),
  Gov_Center: implemented('EffectsManager corruption'),
  Growth_Food: implemented('CityTurnProcessingService'),
  HP_Regen: implemented('UnitManager turn reset'),
  HP_Regen_2: implemented('UnitManager turn reset'),
  Has_Senate: implemented('DiplomacyManager treaty cancellation'),
  History: implemented('CultureManager'),
  Make_Content: implemented('CityHappinessService'),
  Make_Content_Mil: implemented('UnitSupportManager'),
  Martial_Law_By_Unit: implemented('CityHappinessService'),
  Martial_Law_Max: implemented('CityHappinessService'),
  Max_Rates: implemented('EconomicManager'),
  Max_Trade_Routes: implemented('CityTradeRouteService'),
  Min_HP_Pct: implemented('UnitManager turn reset'),
  No_Anarchy: implemented('DiplomacyManager senate waiver'),
  No_Diplomacy: implemented('DiplomacyManager'),
  Output_Add_Tile: implemented('CityTileManagementService'),
  Output_Bonus: implemented('CityCalculationService'),
  Output_Inc_Tile: implemented('CityTileManagementService'),
  Output_Inc_Tile_Celebrate: implemented('CityTileManagementService'),
  Output_Penalty_Tile: implemented('CityTileManagementService'),
  Output_Waste: implemented('EffectsManager corruption'),
  Output_Waste_By_Distance: implemented('EffectsManager corruption'),
  Output_Waste_Pct: implemented('EffectsManager corruption'),
  Pollu_Pop_Pct: implemented('CityCalculationService pollution'),
  Pollu_Pop_Pct_2: implemented('CityCalculationService pollution'),
  Pollu_Prod_Pct: implemented('CityCalculationService pollution'),
  Rapture_Grow: implemented('CityTurnProcessingService'),
  Retire_Pct: implemented('UnitManager turn processing'),
  Revolution_Unhappiness: implemented('CityTurnProcessingService disorder overthrow'),
  Shrink_Food: implemented('CityTurnProcessingService'),
  Size_Adj: implemented('CityTurnProcessingService'),
  Size_Unlimit: implemented('CityTurnProcessingService'),
  Specialist_Output: implemented('city output and happiness'),
  Tech_Parasite: implemented('research turn processing'),
  Tech_Upkeep_Free: implemented('ResearchManager; inert under classic None style'),
  Turn_Years: implemented('TurnManager calendar progression'),
  Unhappy_Factor: implemented('UnitSupportManager'),
  Unit_Upkeep_Free_Per_City: implemented('UnitSupportManager'),
  Unit_Vision_Radius_Sq: implemented('VisibilityManager'),
  Upkeep_Pct: implemented('UnitSupportManager'),
  Veteran_Build: implemented('UnitManager production'),
};
