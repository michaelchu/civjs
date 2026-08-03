-- Deterministic c2c3 fixture for tile-output effects used by city economy.
-- The Lua API exposes the same target-effect contexts used by Freeciv's
-- city tile-output calculation, letting CivJS compare the condition-driven
-- effect values in one already-running native server session.
--
-- @reference reference/freeciv/common/city.c:1281-1371
-- @reference reference/freeciv/common/scriptcore/api_game_effects.c:116-179
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:2831-2857
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:3803-3809
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:3863-3974

local owner = edit.create_player("City Tile Oracle", find.nation_type("Greeks"), nil)
assert(owner, "Could not create c2c3 city-tile fixture player")

local grassland = find.terrain("Grassland")
local inaccessible = find.terrain("Inaccessible")
local supermarket = find.building_type("Supermarket")
assert(grassland and inaccessible and supermarket, "Missing c2c3 city-tile fixture rules")

local center = nil
local city = nil
for candidate in whole_map_iterate() do
  if not candidate:city() then
    -- change_terrain returns false when the tile is already Grassland; either
    -- result leaves it in the controlled terrain required by the fixture.
    edit.change_terrain(candidate, grassland)
    if edit.city_create(owner, candidate, "Tile Effect City", nil) then
      center = candidate
      city = candidate:city()
      break
    end
  end
end

assert(center and city, "Could not create c2c3 city-tile fixture city")

log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT city_center_irrigation_pct=%d",
    effects.tile_bonus(center, city, "Food", "Irrigation_Pct")
  )
)
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT city_center_shield_add=%d",
    effects.tile_bonus(center, city, "Shield", "Output_Add_Tile")
  )
)
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT grassland_tile_workable=%d",
    effects.tile_bonus(center, city, nil, "Tile_Workable")
  )
)

edit.create_building(city, supermarket)
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT city_center_supermarket_food_pct=%d",
    effects.tile_bonus(center, city, "Food", "Output_Per_Tile")
  )
)

edit.create_extra(center, "Pollution")
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT city_center_pollution_punish_pct=%d",
    effects.tile_bonus(center, city, "Food", "Output_Tile_Punish_Pct")
  )
)

edit.create_extra(center, "Mine")
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT city_center_mining_pct=%d",
    effects.tile_bonus(center, city, "Shield", "Mining_Pct")
  )
)

local inaccessible_tile = nil
for candidate in whole_map_iterate() do
  if not candidate:city() then
    edit.change_terrain(candidate, inaccessible)
    inaccessible_tile = candidate
    break
  end
end

assert(inaccessible_tile, "Could not find an empty tile for the workability fixture")
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT inaccessible_tile_workable=%d",
    effects.tile_bonus(inaccessible_tile, city, nil, "Tile_Workable")
  )
)
