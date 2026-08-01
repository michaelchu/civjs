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

| Fixture                          | Focus                                             |
| -------------------------------- | ------------------------------------------------- |
| `earth-small-city-founding.json` | Default settlers and AI city founding             |
| `earth-small-war.json`           | Seeded war relation and military turns            |
| `earth-small-research.json`      | Different science rates and seeded technologies   |
| `earth-small-victory.json`       | Scenario-declared winner flag                     |
| `earth-small-bootstrap.json`     | Combined state bootstrap and deterministic replay |

`maxTurns` is an absolute hard turn cap. If `initialTurn` is greater than 1,
set `maxTurns` above it to allow turns to execute. Repeating a run with the
same config and build should produce identical `result.stateHashes`.
