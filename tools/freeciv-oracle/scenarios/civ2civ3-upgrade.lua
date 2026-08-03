-- Deterministic c2c3 fixture for the Upgrade Unit action. It exercises the
-- action-specific 50 percent old-unit shield value, Invention's price effect,
-- and the ruleset's one-level veteran loss through Freeciv's authoritative
-- action path.
--
-- @reference reference/freeciv/data/civ2civ3/actions.ruleset:1034-1039
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:465-473
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:4618-4625
-- @reference reference/freeciv/common/unittype.c:1757-1771
-- @reference reference/freeciv/server/unittools.c:1558-1597

-- The batch already contains a randomly selected AI player. Let Freeciv pick
-- a compatible nation; no result below depends on nation.
local owner = edit.create_player("Upgrade Oracle", nil, nil)
assert(owner, "Could not create c2c3 upgrade fixture player")

local tile = nil
local city = nil
local grassland = find.terrain("Grassland")
for candidate in whole_map_iterate() do
  if not candidate:city() then
    edit.change_terrain(candidate, grassland)
    if edit.city_create(owner, candidate, "Upgrade City", nil) then
      tile = candidate
      city = candidate:city()
      break
    end
  end
end

assert(tile and city, "Could not create c2c3 upgrade fixture city")
local warrior_type = find.unit_type("Warriors")
local musketeer_type = find.unit_type("Musketeers")
local gunpowder = find.tech_type("Gunpowder")
local invention = find.tech_type("Invention")
local upgrade_action = find.action("Upgrade Unit")
assert(warrior_type and musketeer_type and gunpowder and invention and upgrade_action,
       "Could not resolve c2c3 upgrade fixture rules")

assert(edit.give_tech(owner, gunpowder, 0, false, "script"))
assert(edit.give_tech(owner, invention, 0, false, "script"))
edit.change_gold(owner, 100)

local warrior = edit.create_unit(owner, tile, warrior_type, 2, city, 3)
assert(warrior, "Could not create c2c3 upgrade fixture Warrior")
local gold_before = owner:gold()
assert(edit.perform_action(warrior, upgrade_action, city),
       "Civ2Civ3 Upgrade Unit should succeed for the fixture Warrior")

log.normal("CIVJS_ORACLE_RESULT upgrade_action_succeeded=1")
log.normal(
  string.format("CIVJS_ORACLE_RESULT upgrade_is_musketeer=%d",
    warrior.utype == musketeer_type and 1 or 0)
)
log.normal(
  string.format("CIVJS_ORACLE_RESULT upgrade_veteran_level=%d", warrior.veteran)
)
log.normal(
  string.format("CIVJS_ORACLE_RESULT upgrade_gold_spent=%d", gold_before - owner:gold())
)
