-- Deterministic c2c3 fixture for a mobility-specialist land unit entering
-- an adjacent Helicopter on a non-livable Ocean tile. Alpine Troops explicitly
-- embarks the Helicopter class, so this uses the Transport Embark action rather
-- than city-only Transport Board.
--
-- @reference reference/freeciv/data/civ2civ3/actions.ruleset:1354-1364
-- @reference reference/freeciv/data/civ2civ3/units.ruleset:913-943
-- @reference reference/freeciv/data/civ2civ3/units.ruleset:1693-1725
-- @reference reference/freeciv/server/unithand.c:976-1005

local owner = nil
local origin = nil
local target = nil

for player in players_iterate() do
  owner = player
  break
end

assert(owner, "The c2c3 transport-embark fixture could not resolve a player")

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
local grassland = find.terrain("Grassland")
local ocean = find.terrain("Ocean")
local alpine_troops_type = find.unit_type("Alpine Troops")
local helicopter_type = find.unit_type("Helicopter")
local embark_action = find.action("Transport Embark")
assert(grassland and ocean and alpine_troops_type and helicopter_type and embark_action,
       "Could not resolve c2c3 transport-embark fixture rules")

edit.change_terrain(origin, grassland)
edit.change_terrain(target, ocean)

local cargo = edit.create_unit(owner, origin, alpine_troops_type, 0, nil, -1)
local transport = edit.create_unit(owner, target, helicopter_type, 0, nil, -1)
assert(cargo and transport, "Could not create c2c3 transport-embark fixture units")
assert(cargo:perform_action(embark_action, transport),
       "Civ2Civ3 Transport Embark should succeed for the fixture Alpine Troops")

log.normal("CIVJS_ORACLE_RESULT transport_embark_succeeded=1")
log.normal(
  string.format("CIVJS_ORACLE_RESULT transport_embark_transported=%d",
                cargo:transporter() and 1 or 0)
)
