--
-- Deterministic c2c3 reference fixture used by tools/run-freeciv-oracle.mjs.
-- The map generator is intentionally irrelevant: the fixture creates its own
-- player, normalizes an otherwise empty tile to Grassland, then constructs the
-- city, building, and defender under test.
--
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:1861-1890

local player = edit.create_player("CivJS Oracle", find.nation_type("English"), nil)
local tile = nil
local city = nil
local grassland = find.terrain("Grassland")

for candidate in whole_map_iterate() do
  if not candidate:city() then
    -- change_terrain returns false when the tile is already Grassland; either
    -- outcome leaves the candidate in the terrain required by the fixture.
    edit.change_terrain(candidate, grassland)
    -- Earlier fixtures may already have created a city. Try candidates until
    -- Freeciv accepts one outside the configured citymindist radius.
    if edit.city_create(player, candidate, "Oracle City", nil) then
      tile = candidate
      city = candidate:city()
      break
    end
  end
end

assert(tile and city, "Could not find a legal city tile for the c2c3 oracle fixture")
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
