-- Deterministic c2c3 fixture for default-AI love effects.
-- It reads the player-scoped bonuses that daidiplomacy.c applies to each
-- already-met rival during an AI diplomacy phase.
--
-- @reference reference/freeciv/ai/default/daidiplomacy.c:1129-1138
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:3041-3048

local owner = edit.create_player("AI Love Oracle", nil, nil)
assert(owner, "Could not create c2c3 AI-love fixture player")

local tile = nil
local city = nil
local grassland = find.terrain("Grassland")
for candidate in whole_map_iterate() do
  if not candidate:city() then
    edit.change_terrain(candidate, grassland)
    if edit.city_create(owner, candidate, "AI Love City", nil) then
      tile = candidate
      city = candidate:city()
      break
    end
  end
end

assert(tile and city, "Could not create c2c3 AI-love fixture city")
local eiffel = find.building_type("Eiffel Tower")
local apollo = find.building_type("Apollo Program")
assert(eiffel and apollo, "Missing c2c3 AI-love fixture rules")

log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT gain_ai_love_without_wonder=%d",
    effects.player_bonus(owner, "Gain_AI_Love")
  )
)

edit.create_building(city, eiffel)
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT gain_ai_love_eiffel=%d",
    effects.player_bonus(owner, "Gain_AI_Love")
  )
)

edit.create_building(city, apollo)
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT gain_ai_love_apollo=%d",
    effects.player_bonus(owner, "Gain_AI_Love")
  )
)
