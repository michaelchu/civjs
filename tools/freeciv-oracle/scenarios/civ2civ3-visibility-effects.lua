-- Deterministic c2c3 fixture for player map-knowledge and city-vision effects.
-- The server's turn processor applies map knowledge separately; this fixture
-- compares the source effect values that drive that turn-time behavior.
--
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:387-405
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:2899-2905
-- @reference reference/freeciv/data/civ2civ3/effects.ruleset:3544-3550

local owner = edit.create_player("Visibility Oracle", find.nation_type("Romans"), nil)
assert(owner, "Could not create c2c3 visibility fixture player")

local tile = nil
local city = nil
local grassland = find.terrain("Grassland")
for candidate in whole_map_iterate() do
  if not candidate:city() then
    edit.change_terrain(candidate, grassland)
    if edit.city_create(owner, candidate, "Visibility City", nil) then
      tile = candidate
      city = candidate:city()
      break
    end
  end
end

assert(tile and city, "Could not create c2c3 visibility fixture city")
local apollo = find.building_type("Apollo Program")
local internet = find.building_type("Internet")
local electricity = find.tech_type("Electricity")
assert(apollo and internet and electricity, "Missing c2c3 visibility fixture rules")

log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT reveal_map_without_apollo=%d",
    effects.player_bonus(owner, "Reveal_Map")
  )
)
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT reveal_cities_without_internet=%d",
    effects.player_bonus(owner, "Reveal_Cities")
  )
)
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT city_vision_base=%d",
    effects.city_bonus(city, "City_Vision_Radius_Sq")
  )
)

edit.create_building(city, apollo)
edit.create_building(city, internet)
assert(edit.give_tech(owner, electricity, 0, false, "script"))

log.normal(
  string.format("CIVJS_ORACLE_RESULT reveal_map_apollo=%d", effects.player_bonus(owner, "Reveal_Map"))
)
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT reveal_cities_internet=%d",
    effects.player_bonus(owner, "Reveal_Cities")
  )
)
log.normal(
  string.format(
    "CIVJS_ORACLE_RESULT city_vision_electricity=%d",
    effects.city_bonus(city, "City_Vision_Radius_Sq")
  )
)
