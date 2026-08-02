# Headless simulator scenario fixtures

These configs use the packaged `earth-small` scenario and the controlled
`scenarioSetup` bootstrap. Player references are the runtime player numbers
(`1..N`), not zero-based array indexes.

Run one against an isolated PostgreSQL database:

```sh
npm run --silent simulation:run -- \
  --config ../../docs/simulation-scenarios/earth-small-bootstrap.json \
  --output ../artifacts/earth-small-bootstrap \
  --database-url postgresql://civjs:civjs_secret@127.0.0.1:5432/civjs_test \
  --no-persist
```

Inspect `run.json` after completion:

```sh
jq '{result, firstCheckpoint: .replay.turns[0].snapshot}' \
  ./artifacts/earth-small-bootstrap/run.json
```

Add an `expect` block to make a run fail when gameplay does not reach the
intended outcome. Expectations are checked against the final replay state;
`diplomacyEvents` scans all completed checkpoints, so it can distinguish a
seeded war from an AI declaration:

```json
{
  "expect": {
    "endReason": "max_turns",
    "players": [{ "playerNumber": 1, "minCities": 2 }],
    "diplomacy": [
      {
        "playerNumber": 1,
        "otherPlayerNumber": 2,
        "state": "war"
      }
    ],
    "diplomacyEvents": [
      {
        "type": "war_declared",
        "playerNumber": 1,
        "otherPlayerNumber": 2
      }
    ]
  }
}
```

An expectation failure is written to `diagnostics.expectations`, emitted as a
`run_failed` progress record, and exits with code `6`.

Every completed replay checkpoint is also checked against the reference
server's per-turn sanity checks. The result is written to
`diagnostics.invariants`:

```json
{
  "passed": true,
  "checkedTurns": 20,
  "violations": []
}
```

When a check fails, each violation includes a stable `code`, turn number,
snapshot `path`, message, and reference source path. The runner emits a
`run_failed` record with code `INVARIANT_FAILED` and exits with code `7`.
Inspect both kinds of checks together:

```sh
jq '{status: .result.status, failure, invariants: .diagnostics.invariants, expectations: .diagnostics.expectations}' \
  ./artifacts/earth-small-bootstrap/run.json
```

The always-on checks currently cover map shape and coordinates, player and
ownership identity, city size and references, trade-route reciprocity, unit
health/movement/home-city references, transport reciprocity, diplomatic
state symmetry, and research targets. These are structural and legality
checks; scenario `expect` rules remain the right tool for gameplay outcomes
such as declaring war, founding a city, completing research, or winning.

The checks are based on Freeciv's turn-level sanity pass in
`reference/freeciv/server/sanitycheck.c:171-220,223-356,412-505,537-572,629-687`,
with unit identity rules from
`reference/freeciv/common/unit.h:264-271` and diplomatic state ordering from
`reference/freeciv/server/diplhand.c:81-112`.

For deterministic AI decision tests, `scenarioSetup.aiDiplomacy` can seed a
player's persisted diplomacy memory (including `warDesire` and
`warCountdown`). This is useful for exercising a specific decision path;
heuristic behavior should still be tested with an unseeded setup.

| Fixture                            | Focus                                             |
| ---------------------------------- | ------------------------------------------------- |
| `earth-small-city-founding.json`   | Default settlers and AI city founding             |
| `earth-small-war.json`             | Seeded war relation and military turns            |
| `earth-small-war-declaration.json` | AI war countdown and declaration event            |
| `earth-small-research.json`        | Different science rates and seeded technologies   |
| `earth-small-victory.json`         | Scenario-declared winner flag                     |
| `earth-small-bootstrap.json`       | Combined state bootstrap and deterministic replay |

`maxTurns` is an absolute hard turn cap. If `initialTurn` is greater than 1,
set `maxTurns` above it to allow turns to execute. Repeating a run with the
same config and build should produce identical `result.stateHashes`.

Run every checked-in fixture sequentially, with one output directory per
fixture:

```sh
npm run --silent simulation:run:scenarios -- \
  --database-url postgresql://civjs:civjs_secret@127.0.0.1:5432/civjs_test \
  --no-persist \
  --output apps/artifacts/simulation-scenarios
```

The suite stops at the first failure by default. Add `--continue-on-error` to
collect failures from every fixture. Use `--max-turns` or `--timeout-ms` to
apply the same run limit to all fixtures.

For a repeatable reference-gap investigation workflow, see
[`REFERENCE_GAP_WORKFLOW.md`](./REFERENCE_GAP_WORKFLOW.md).
