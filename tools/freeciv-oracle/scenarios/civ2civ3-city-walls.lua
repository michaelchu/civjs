--
-- Deterministic c2c3 reference fixture used by tools/run-freeciv-oracle.mjs.
-- The map generator is intentionally irrelevant: the fixture creates its own
-- player, normalizes an otherwise empty tile to Grassland, then constructs the
-- city, building, and defender under test.
--
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:1861-1890

local player = edit.create_player("CivJS Oracle", find.nation_type("English"), nil)
local tile = nil

for candidate in whole_map_iterate() do
  if not candidate:city() then
    tile = candidate
    break
  end
end

assert(tile, "Could not find an empty tile for the c2c3 oracle fixture")
assert(edit.change_terrain(tile, find.terrain("Grassland")))
assert(edit.city_create(player, tile, "Oracle City", nil))

local city = tile:city()
local city_walls = find.building_type("City Walls")
local warrior_type = find.unit_type("Warriors")

assert(city, "The c2c3 oracle fixture did not create its city")
assert(city_walls, "The c2c3 oracle fixture could not resolve City Walls")
assert(warrior_type, "The c2c3 oracle fixture could not resolve Warriors")

edit.create_building(city, city_walls)
local defender = edit.create_unit(player, tile, warrior_type, 0, nil, -1)
local defense_bonus = effects.unit_bonus(defender, nil, "Defend_Bonus")

log.normal(
  string.format("CIVJS_ORACLE_RESULT city_walls_ground_defense=%d", defense_bonus)
)
