-- Deterministic c2c3 reference fixture for Explode Nuclear. The Nuclear
-- actor is intentionally created with zero movement fragments: the source
-- self action has no MinMoveFrags requirement. Civ2Civ3's default topology is
-- ISO|HEX, so a squared blast radius of two reaches its first hex ring. The
-- effect value itself is asserted separately by the CivJS effect fixture.
--
-- @reference reference/freeciv/data/civ2civ3/actions.ruleset:173-187
-- @reference reference/freeciv/data/civ2civ3/actions.ruleset:765-770
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:4135-4141
-- @reference reference/freeciv/server/unithand.c:4739-4805
-- @reference reference/freeciv/server/unittools.c:3039-3065

local player = nil
local origin = nil
local hex_neighbor = nil

for candidate in players_iterate() do
  player = candidate
  break
end

assert(player, "The c2c3 nuclear oracle fixture could not resolve a started player")

local function unit_count(tile)
  local count = 0
  for _ in tile:units_iterate() do
    count = count + 1
  end
  return count
end

for candidate in whole_map_iterate() do
  if not candidate:city() and unit_count(candidate) == 0 then
    for neighbor in candidate:circle_iterate(2) do
      if candidate:sq_distance(neighbor) == 1 and not neighbor:city() and unit_count(neighbor) == 0 then
        origin = candidate
        hex_neighbor = neighbor
        break
      end
    end
  end
  if origin then
    break
  end
end

assert(origin and hex_neighbor, "Could not find empty adjacent hex tiles for the c2c3 nuclear fixture")
local grassland = find.terrain("Grassland")
local nuclear_type = find.unit_type("Nuclear")
local warrior_type = find.unit_type("Warriors")
local explode_nuclear = find.action("Explode Nuclear")

assert(grassland and nuclear_type and warrior_type and explode_nuclear,
       "The c2c3 nuclear fixture could not resolve its ruleset objects")
edit.change_terrain(origin, grassland)
edit.change_terrain(hex_neighbor, grassland)

local nuclear = edit.create_unit(player, origin, nuclear_type, 0, nil, 0)
local defender = edit.create_unit(player, hex_neighbor, warrior_type, 0, nil, -1)
assert(nuclear and defender, "Could not create c2c3 nuclear fixture units")
assert(nuclear:perform_action(explode_nuclear, origin),
       "Explode Nuclear should be enabled with zero movement fragments")

log.normal("CIVJS_ORACLE_RESULT nuclear_self_action_succeeded=1")
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT nuclear_self_origin_units_removed=%d",
    unit_count(origin) == 0 and 1 or 0
  )
)
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT nuclear_self_hex_neighbor_destroyed=%d",
    unit_count(hex_neighbor) == 0 and 1 or 0
  )
)
