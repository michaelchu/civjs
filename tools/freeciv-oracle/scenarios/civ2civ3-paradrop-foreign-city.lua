-- Deterministic c2c3 fixture for the ordinary Paradrop Unit Enter risk case
-- at a foreign city. The attacker knows the terrain before the city is built,
-- but has not learned the city itself and has no diplomatic contact.
--
-- @reference reference/freeciv/data/civ2civ3/actions.ruleset:932-1038
-- @reference reference/freeciv/server/unittools.c:3172-3260

local attacker = edit.create_player("Paradrop Attacker", find.nation_type("Americans"), nil)
local defender = edit.create_player("Paradrop Defender", find.nation_type("Russians"), nil)
assert(attacker and defender, "Could not create c2c3 paradrop fixture players")

local source = nil
local target = nil
local grassland = find.terrain("Grassland")
assert(grassland, "The c2c3 paradrop fixture could not resolve Grassland")

for candidate in whole_map_iterate() do
  if not candidate:city() then
    edit.change_terrain(candidate, grassland)
    if edit.city_create(attacker, candidate, "Paradrop Source", nil) then
      for other in whole_map_iterate() do
        local distance_sq = candidate:sq_distance(other)
        if not other:city() and distance_sq >= 36 and distance_sq <= 100 then
          edit.change_terrain(other, grassland)
          -- Make the terrain known before the defender founds its city. The
          -- attacker knows the landing tile but not its subsequently built
          -- city, which is the risk case handled in do_paradrop().
          other:show(attacker)
          if edit.city_create(defender, other, "Paradrop Target", nil) then
            source = candidate
            target = other
            break
          end
        end
      end
      if target then
        break
      end
      edit.remove_city(candidate:city())
    end
  end
end

assert(source and target, "Could not create c2c3 paradrop fixture cities within range")
source:show(attacker)

local paratroopers = find.unit_type("Paratroopers")
local paradrop_enter = find.action("Paradrop Unit Enter")
assert(paratroopers and paradrop_enter, "Could not resolve c2c3 paradrop fixture rules")

local relation = attacker:diplstate(defender)
local target_known_before = target:known(attacker)
local target_seen_before = target:seen(attacker)

local ordinary_paratrooper = edit.create_unit(attacker, source, paratroopers, 0, source:city(), -1)
assert(ordinary_paratrooper, "Could not create ordinary c2c3 Paratroopers fixture unit")
local ordinary_succeeded = ordinary_paratrooper:perform_action(paradrop_enter, target)
local actor_survived = attacker:num_units() > 0

log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT paradrop_stale_city_relation_no_contact=%d",
    relation == "Never met" and 1 or 0
  )
)
log.normal(
  string.format("CIVJS_ORACLE_RESULT paradrop_stale_city_target_known=%d", target_known_before and 1 or 0)
)
log.normal(
  string.format("CIVJS_ORACLE_RESULT paradrop_stale_city_target_seen=%d", target_seen_before and 1 or 0)
)
log.normal(
  string.format("CIVJS_ORACLE_RESULT paradrop_stale_city_enter_succeeded=%d", ordinary_succeeded and 1 or 0)
)
log.normal(
  string.format("CIVJS_ORACLE_RESULT paradrop_stale_city_actor_survived=%d", actor_survived and 1 or 0)
)
