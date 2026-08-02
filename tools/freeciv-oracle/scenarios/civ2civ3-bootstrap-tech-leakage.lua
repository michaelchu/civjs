--
-- Deterministic c2c3 fixture for embassy-based Technology Leakage.
-- This file sorts before the other fixtures, so it starts from one configured
-- AI player. The runner disables animals and this fixture adds a learner and
-- peer, fixing the Freeciv leakage denominator at three alive players.
--
-- @reference reference/freeciv/common/research.c:941-1038
-- @reference reference/freeciv/common/player.c:205-255
-- @reference reference/freeciv/data/civ2civ3/game.ruleset:340-352
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:3794-3800

local learner = edit.create_player("Leak Learner", find.nation_type("French"), nil)
local peer = edit.create_player("Leak Peer", find.nation_type("Germans"), nil)
assert(learner and peer, "Could not create Technology Leakage fixture players")

local player_count = 0
for _ in players_iterate() do
  player_count = player_count + 1
end
assert(player_count == 3, "Technology Leakage fixture requires exactly three alive players")

local origin = nil
local target = nil
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

assert(origin and target, "Could not find adjacent Technology Leakage fixture tiles")
local grassland = find.terrain("Grassland")
assert(grassland, "Could not resolve Grassland for Technology Leakage fixture")
-- change_terrain returns false when a tile is already Grassland; both paths
-- leave the tile in the deterministic terrain required by the fixture.
edit.change_terrain(origin, grassland)
edit.change_terrain(target, grassland)
assert(edit.city_create(peer, target, "Leak Peer City", nil))

local alphabet = find.tech_type("Alphabet")
local diplomat_type = find.unit_type("Diplomat")
local embassy_action = find.action("Establish Embassy Stay")
assert(alphabet and diplomat_type and embassy_action, "Missing Technology Leakage fixture rules")
assert(edit.give_tech(peer, alphabet, 0, false, "script"))

local diplomat = edit.create_unit(learner, origin, diplomat_type, 0, nil, -1)
assert(diplomat, "Could not create Technology Leakage fixture diplomat")
assert(
  edit.perform_action(diplomat, embassy_action, target:city()),
  "Could not establish Technology Leakage fixture embassy"
)
assert(learner:has_embassy(peer), "Learner has no embassy with Technology Leakage peer")

log.normal(
  string.format("CIVJS_ORACLE_RESULT tech_leakage_embassy_cost=%d", learner:tech_cost(alphabet))
)
