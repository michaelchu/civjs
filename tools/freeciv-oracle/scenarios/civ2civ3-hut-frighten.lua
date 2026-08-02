--
-- Deterministic c2c3 reference fixture for the HutFrighten movement result.
-- It performs the server's hut-frighten movement consequence instead of
-- invoking the Lua callback directly, so hut removal and the inherited script
-- signal run through the Freeciv server.
--
-- @reference reference/freeciv/data/civ2civ3/actions.ruleset:1402-1428
-- @reference reference/freeciv/server/unittools.c:3357-3380
-- @reference reference/freeciv/data/default/default.lua:177-185

local player = nil
local origin = nil
local target = nil

for candidate in players_iterate() do
  player = candidate
  break
end

assert(player, "The c2c3 oracle fixture could not resolve a started player")

for candidate in whole_map_iterate() do
  if not candidate:city() then
    for neighbor in candidate:circle_iterate(1) do
      if candidate:sq_distance(neighbor) == 1 and not neighbor:city() then
        origin = candidate
        target = neighbor
        break
      end
    end
  end
  if origin then
    break
  end
end

assert(origin and target, "Could not find adjacent empty tiles for the c2c3 hut fixture")
-- change_terrain returns false when a selected tile is already Grassland;
-- both return paths leave these empty tiles suitable for the fixture.
local grassland = find.terrain("Grassland")
assert(grassland, "The c2c3 hut fixture could not resolve Grassland")
edit.change_terrain(origin, grassland)
edit.change_terrain(target, grassland)
origin:show(player)
target:show(player)

local fighter_type = find.unit_type("Fighter")

assert(fighter_type, "The c2c3 oracle fixture could not resolve Fighter")

target:create_extra("Hut")
assert(target:has_extra("Hut"), "The c2c3 oracle fixture could not create a Hut")

local fighter = edit.create_unit(player, origin, fighter_type, 0, nil, -1)
assert(fighter, "The c2c3 oracle fixture could not create Fighter")

local unit_survived = fighter:move(target, 1, nil, false, false, false, false, true)
assert(unit_survived, "The c2c3 HutFrighten movement consequence destroyed Fighter")

log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT hut_frighten_unit_survived=%d",
    unit_survived and 1 or 0
  )
)
log.normal(
  string.format("CIVJS_ORACLE_RESULT hut_frighten_hut_removed=%d", target:has_extra("Hut") and 0 or 1)
)
