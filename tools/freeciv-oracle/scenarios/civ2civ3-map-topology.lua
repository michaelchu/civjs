-- Deterministic c2c3 reference fixture for the default generated map's
-- topology. At the wrapped map corner, an ISO|HEX map has six first-ring
-- neighbors; a square, non-hex, or unwrapped topology would not.
--
-- @reference reference/freeciv/data/civ2civ3/game.ruleset:810-815
-- @reference reference/freeciv/common/map.h:390-431
-- @reference reference/freeciv/server/maphand.c:651-668

local corner = nil
for candidate in whole_map_iterate() do
  corner = candidate
  break
end

assert(corner, "The c2c3 topology fixture could not resolve a generated map tile")

local first_ring = 0
for candidate in corner:circle_iterate(1) do
  if corner:sq_distance(candidate) == 1 then
    first_ring = first_ring + 1
  end
end

log.normal(string.format("CIVJS_ORACLE_RESULT map_topology_corner_neighbors=%d", first_ring))
