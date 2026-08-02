-- Deterministic c2c3 fixture for ruleset-derived technology base costs.
-- Tech_Type:cost() intentionally has no player context, so it reports the
-- precomputed ruleset cost before player-specific Tech_Cost_Factor, leakage,
-- AI difficulty, or science-box adjustments.
--
-- @reference reference/freeciv/common/tech.c:225-275
-- @reference reference/freeciv/common/tech.c:544-606
-- @reference reference/freeciv/data/civ2civ3/game.ruleset:308-339

local technologies = {
  alphabet = "Alphabet",
  writing = "Writing",
  electricity = "Electricity",
  advanced_flight = "Advanced Flight",
  fusion_power = "Fusion Power",
}

for id, name in pairs(technologies) do
  local technology = find.tech_type(name)
  assert(technology, string.format("Could not resolve c2c3 technology %s", name))
  log.normal(
    string.format("CIVJS_ORACLE_RESULT research_base_cost_%s=%d", id, technology:cost())
  )
end
