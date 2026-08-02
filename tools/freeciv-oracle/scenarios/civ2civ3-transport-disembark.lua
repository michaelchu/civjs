-- Deterministic c2c3 fixture for a land unit leaving a sea transport from a
-- non-native tile. The actor has two movement points so the fixture detects
-- the action-success cost separately from the one-point Grassland movement
-- cost. Freeciv evaluates the UnitState requirement after the actor reaches
-- the target tile, then exhausts its remaining movement.
--
-- @reference reference/freeciv/data/civ2civ3/actions.ruleset:1344-1352
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:4534-4542
-- @reference reference/freeciv/common/unit.c:2199-2217
-- @reference reference/freeciv/server/actiontools.c:64-110
-- @reference reference/freeciv/server/unithand.c:918-941

local owner = nil
local origin = nil
local target = nil
local followup = nil

for player in players_iterate() do
  owner = player
  break
end

assert(owner, "The c2c3 transport-disembark fixture could not resolve a player")

local function unit_count(tile)
  local count = 0
  for _ in tile:units_iterate() do
    count = count + 1
  end
  return count
end

for candidate in whole_map_iterate() do
  if not candidate:city() and unit_count(candidate) == 0 then
    for neighbor in candidate:circle_iterate(1) do
      if candidate:sq_distance(neighbor) == 1
          and not neighbor:city()
          and unit_count(neighbor) == 0 then
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

assert(origin and target, "Could not find adjacent empty tiles for the c2c3 transport fixture")
for neighbor in target:circle_iterate(1) do
  if target:sq_distance(neighbor) == 1
      and neighbor ~= origin
      and not neighbor:city()
      and unit_count(neighbor) == 0 then
    followup = neighbor
    break
  end
end
assert(followup, "Could not find a follow-up tile for the c2c3 transport fixture")
local ocean = find.terrain("Ocean")
local grassland = find.terrain("Grassland")
local trireme_type = find.unit_type("Trireme")
local horsemen_type = find.unit_type("Horsemen")
local disembark_action = find.action("Transport Disembark 2")
local unit_move_action = find.action("Unit Move")
assert(ocean and grassland and trireme_type and horsemen_type and disembark_action and unit_move_action,
       "Could not resolve c2c3 transport-disembark fixture rules")

edit.change_terrain(origin, ocean)
edit.change_terrain(target, grassland)
edit.change_terrain(followup, grassland)

local transport = edit.create_unit(owner, origin, trireme_type, 0, nil, -1)
local cargo = edit.create_unit_full(owner, origin, horsemen_type, 0, nil, 12, 10, transport)
assert(transport and cargo and cargo:transporter():exists(),
       "Could not create loaded c2c3 transport-disembark fixture units")
assert(cargo:perform_action(disembark_action, target),
       "Civ2Civ3 Transport Disembark 2 should succeed for the fixture Horsemen")

log.normal("CIVJS_ORACLE_RESULT non_native_disembark_succeeded=1")
log.normal(
  string.format("CIVJS_ORACLE_RESULT non_native_disembark_transported=%d",
                cargo:transporter() and 1 or 0)
)
log.normal(
  string.format("CIVJS_ORACLE_RESULT non_native_disembark_followup_move_succeeded=%d",
                cargo:perform_action(unit_move_action, followup) and 1 or 0)
)
