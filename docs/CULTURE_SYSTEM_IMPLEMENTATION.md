# Culture System Implementation

## Status

The Freeciv culture foundation is implemented. CivJS persists city and national history, evaluates the core culture formulas with Freeciv-compatible integer truncation, processes history during every turn, synchronizes the resulting state to the client, and enforces ruleset-declared minimum-culture requirements for city production.

This is not a culture-victory or cultural-conversion system. Those features are not part of the referenced Freeciv culture calculation module and remain out of scope.

## Reference sources

- `reference/freeciv/common/culture.c`
- `reference/freeciv/common/culture.h`
- `reference/freeciv/common/requirements.c`
- `reference/freeciv/gen_headers/enums/effects_enums.def`
- `reference/freeciv-web/javascript/fc_types.js`

## Implemented behavior

### Culture calculations

`CultureManager` ports the four calculations in `common/culture.c`:

```text
city culture =
  city history + trunc(performance * (100 + culture percentage) / 100)

city history gain =
  trunc(history effect * (100 + culture percentage) / 100)
  + trunc(city history * history interest per mille / 1000)

player culture =
  national history
  + trunc(national performance * (100 + culture percentage) / 100)
  + sum(city culture)

national history gain =
  trunc(national history effect * (100 + culture percentage) / 100)
  + trunc(national history * history interest per mille / 1000)
```

Each division is truncated independently, matching C integer arithmetic. Culture scores are derived values; only accumulated history and the game's per-mille interest rate are persisted.

Supported effect types are:

- `Performance`
- `History`
- `National_Performance`
- `National_History`
- `Culture_Pct`

The effects system does not add an implicit history point. A ruleset must explicitly declare culture effects. The bundled classic ruleset currently declares no culture-generation effects, matching its imported source data, so a new classic game remains at zero history unless history interest applies to an existing non-zero value.

### Turn processing and synchronization

The culture phase runs after city production and before research. For every city and player it:

1. Calculates the turn's history gain.
2. Persists the new history value.
3. Updates the live `CityState` or `PlayerState`.
4. Calculates the derived culture totals.

After successful turn processing, `TurnManager` broadcasts `culture_updated`. City broadcasts also include each city's current `history`. The client merges national history and total culture into its player state and receives city history with normal city updates.

Both newly started and recovered games attach their live city/player maps to `CultureManager`, and recovery restores player history from the database.

### Minimum-culture requirements

Building ruleset data may declare:

```json
{
  "cultureRequirements": [
    {
      "type": "MinCulture",
      "value": 100,
      "range": "City",
      "present": true
    }
  ]
}
```

Supported ranges are `City` and `Player`. The production API evaluates these requirements when listing choices and again when changing production, so a client cannot bypass the gate.

`present: false` reverses the condition. `TradeRoute` minimum-culture evaluation is not exposed by the building schema because partner-route context is not yet implemented.

The bundled classic building ruleset currently declares no minimum-culture requirements. The mechanism is available to rulesets without inventing requirements for classic buildings.

## Persistence

The schema and migrations provide:

- `cities.history`
- `players.history`
- `games.history_interest_pml`

All default to zero. Existing saves therefore remain compatible and begin with no accumulated history unless their stored values say otherwise.

## Related border effects

`Border_Strength_Pct` is implemented by the border system and may be supplied by ruleset effects. It affects border strength; it is not accumulated culture or history and should not be used as evidence of culture growth.

## Known remaining gaps

- `MinCulture` with `TradeRoute` range
- Dedicated culture UI beyond synchronized state
- Culture victory conditions
- Cultural conversion, influence, tourism, Great Works, or tile flipping
- A bundled ruleset that actively uses history-generation or minimum-culture declarations

## Verification

Coverage should protect:

- Exact integer truncation in all four formulas
- Database and live-state updates during culture processing
- New-game and recovery wiring
- City/player minimum-culture production gates
- City and player culture synchronization
- Absence of implicit or locally invented classic culture generation
