-- Deterministic c2c3 fixture for the world effect that enables spaceship
-- construction. It runs in the existing batched native-server
-- process, so no individual Jest test needs to start Freeciv. The runner
-- prioritizes it before fixtures that construct Apollo Program because its
-- world-scoped effect survives its source building.
--
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:2907-2913

-- The batch already contains a randomly selected AI player. Let Freeciv pick
-- a compatible nation; no result below depends on nation.
local owner = edit.create_player("Spaceship Oracle", nil, nil)
assert(owner, "Could not create c2c3 spaceship fixture player")

local grassland = find.terrain("Grassland")
local apollo = find.building_type("Apollo Program")
assert(grassland and apollo, "Missing c2c3 spaceship fixture rules")

local city = nil
for candidate in whole_map_iterate() do
  if not candidate:city() then
    -- change_terrain may report false when this is already Grassland; either
    -- path leaves a legal, controlled tile for the fixture city.
    edit.change_terrain(candidate, grassland)
    if edit.city_create(owner, candidate, "Spaceship Oracle City", nil) then
      city = candidate:city()
      break
    end
  end
end
assert(city, "Could not create c2c3 spaceship fixture city")

log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT spaceship_enable_space_without_apollo=%d",
    effects.player_bonus(owner, "Enable_Space")
  )
)

edit.create_building(city, apollo)
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT spaceship_enable_space_with_apollo=%d",
    effects.player_bonus(owner, "Enable_Space")
  )
)
