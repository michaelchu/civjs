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
