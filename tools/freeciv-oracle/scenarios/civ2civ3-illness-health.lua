-- Deterministic c2c3 fixture for the Health_Pct effects consumed by the
-- server's city illness calculation.
--
-- @reference reference/freeciv/common/city.c:2849-2918
-- @reference reference/freeciv/common/scriptcore/api_game_effects.c:65-78
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:474-481
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:1751-1757
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:2662-2668
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:2996-3002

local owner = edit.create_player("Illness Health Oracle", nil, nil)
assert(owner, "Could not create c2c3 illness fixture player")

local grassland = find.terrain("Grassland")
local medicine = find.tech_type("Medicine")
local aqueduct = find.building_type("Aqueduct")
local sewer_system = find.building_type("Sewer System")
local cure_for_cancer = find.building_type("Cure For Cancer")
assert(
  grassland and medicine and aqueduct and sewer_system and cure_for_cancer,
  "Missing c2c3 illness fixture rules"
)

local city = nil
for candidate in whole_map_iterate() do
  if not candidate:city() then
    edit.change_terrain(candidate, grassland)
    if edit.city_create(owner, candidate, "Illness Health City", nil) then
      city = candidate:city()
      break
    end
  end
end

assert(city, "Could not create c2c3 illness fixture city")

log.normal(string.format("CIVJS_ORACLE_RESULT health_pct_base=%d", effects.city_bonus(city, "Health_Pct")))
assert(edit.give_tech(owner, medicine, 0, false, "script"))
log.normal(string.format("CIVJS_ORACLE_RESULT health_pct_medicine=%d", effects.city_bonus(city, "Health_Pct")))
edit.create_building(city, aqueduct)
log.normal(string.format("CIVJS_ORACLE_RESULT health_pct_aqueduct=%d", effects.city_bonus(city, "Health_Pct")))
edit.create_building(city, sewer_system)
log.normal(string.format("CIVJS_ORACLE_RESULT health_pct_sewer=%d", effects.city_bonus(city, "Health_Pct")))
edit.create_building(city, cure_for_cancer)
log.normal(string.format("CIVJS_ORACLE_RESULT health_pct_cure=%d", effects.city_bonus(city, "Health_Pct")))
