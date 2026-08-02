-- Deterministic c2c3 fixture for the player-wide Magellan's Expedition
-- Veteran_Combat effect. The chance calculation itself is stochastic, so the
-- oracle pins the source effect value that the authoritative combat path uses.
--
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:3372-3380
-- @reference reference/freeciv/server/unittools.c:238-278

local owner = edit.create_player("Veterancy Oracle", find.nation_type("Spanish"), nil)
assert(owner, "Could not create c2c3 veterancy fixture player")

local city_tile = nil
local city = nil
local grassland = find.terrain("Grassland")
for candidate in whole_map_iterate() do
  if not candidate:city() then
    edit.change_terrain(candidate, grassland)
    if edit.city_create(owner, candidate, "Veterancy City", nil) then
      city_tile = candidate
      city = candidate:city()
      break
    end
  end
end

assert(city_tile and city, "Could not create c2c3 veterancy fixture city")
local magellans = find.building_type("Magellan's Expedition")
local destroyer_type = find.unit_type("Destroyer")
local ocean = find.terrain("Ocean")
assert(magellans and destroyer_type and ocean, "Missing c2c3 veterancy fixture rules")
edit.create_building(city, magellans)

local destroyer = nil
for candidate in whole_map_iterate() do
  if candidate ~= city_tile and not candidate:city() then
    edit.change_terrain(candidate, ocean)
    destroyer = edit.create_unit(owner, candidate, destroyer_type, 0, nil, -1)
    if destroyer then
      break
    end
  end
end

assert(destroyer, "Could not create c2c3 veterancy fixture Destroyer")
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT magellans_veteran_combat=%d",
    effects.unit_bonus(destroyer, nil, "Veteran_Combat")
  )
)
