# CivJS Release and Recovery Runbook

## Release target

The first supported release target is the classic ruleset, conquest victory,
standard 80×50 maps, and up to eight participants. Turns are simultaneous and
the server is authoritative. Science and culture contribute to the final score
but are not advertised as victory conditions. The supported classic covert
surface includes embassies, city investigation, technology theft, city and
unit sabotage, poisoning, bribery, and incitement.
The supported unit-action surface also includes caravan marketplace/Wonder
outcomes, city joining and home reassignment, treasury-backed upgrades,
shield-recovery disbanding, and ruleset-driven cultivate, plant, fortress, and
airbase activities.

## Pre-deploy

1. Back up PostgreSQL and record the deployed commit SHA.
2. Run `npm ci` in the repository root and both applications.
3. Run `npm run format:check`, `npm run lint`, `npm run typecheck`,
   `npm run test:unit`, `npm run test:e2e`, and `npm run build`.
4. Run all PostgreSQL integration tests in a disposable local service with
   `npm run test:integration:docker`. To use an already isolated database
   instead, run `TEST_DATABASE_URL=... npm run test:integration`.
5. Apply migrations with `npm run db:migrate:prod` from `apps/server`.
6. Start the server only after migrations succeed.

## Browser parity

Install the supported local browser once with `npx playwright install
chromium`, then run `npm run test:e2e`. The suite starts Vite itself and
intercepts only the deterministic ruleset APIs; no PostgreSQL service is
required. It covers desktop and mobile game creation plus the classic canvas
fixture, game-screen navigation, accessibility preferences, and presentation
catalogue consumption.

Browser failures are written beneath `test-results/browser`; traces,
screenshots, and video are retained on failure. CI also uploads that directory
and `playwright-report`. Inspect the trace before accepting a screenshot
change, because a changed image may indicate missing sprites, fog, borders, or
responsive controls rather than an intentional visual update.

CI runs this browser flow and all PostgreSQL integration/recovery suites in the
same release job. The database-backed `SocketGameFlow.integration.test.ts`
clears server memory, restores the active game from PostgreSQL, reconnects the
host, and completes another turn.

Migration `0007_add_game_end_report.sql` is additive and preserves existing
saves. A rollback may run the previous application version without dropping
the new nullable columns.

## Persistence compatibility

| Entity                                                              | Authoritative storage                      | Reload evidence                                                         |
| ------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Game configuration, map, timer, pause state                         | `games`                                    | `GameInstanceRecoveryService.test.ts`, `MapManager.integration.test.ts` |
| Players, economy, government, technology IDs, visibility, diplomacy | `players`                                  | `GameManager.integration.test.ts`, manager and handler unit suites      |
| Cities, citizens, production, buildings, trade, governor state      | `cities`                                   | `CityManager.integration.test.ts`, city recovery/economy suites         |
| Units, health, movement, orders, activities, transport, upgrades    | `units`                                    | `UnitManager.integration.test.ts`, `UnitManager.test.ts`                |
| Research progress                                                   | `research` and player technology IDs       | `ResearchManager.test.ts`                                               |
| Turn audit, actions, events, phase metrics                          | `game_turns`, `turn_events`, `turn_phases` | `TurnManager.test.ts`                                                   |
| Final scores and report                                             | `players.score`, `games.end_game_report`   | `EndGameService.test.ts`                                                |

Ownership, treasury, population, health, and production changes caused by
covert, caravan, and unit-management actions use these same authoritative
player, city, and unit records. Worker terrain/base completion also rewrites
the persisted game map. Their rule and persistence boundaries are covered by
`GameManager.espionage.test.ts`, `CityManager.test.ts`, and
`UnitManager.test.ts`.

Runtime state snapshots carry a version number. Rule entities remain in their
normalized tables; snapshots do not become a competing source of truth.

## Monitoring

- `GET /health` is the liveness probe.
- `GET /ready` verifies PostgreSQL and Redis; remove the instance from service
  when it returns 503.
- `GET /metrics` reports uptime, connected sockets, and process memory.
- Alert on readiness failures, repeated `Turn processing failed` log events,
  memory growth across several turns, and reconnect loops.
- Preserve structured logs with game ID and turn for at least the save-retention
  period so an audit record can be correlated with application events.

## Recovery

1. Stop new traffic and take a database backup before repair.
2. Confirm `/ready` dependencies independently.
3. Restart the application. Active and paused games reconstruct map, players,
   cities, units, research, government, visibility, and timers from PostgreSQL.
4. Rejoin with the original player identity and verify the current turn, city
   totals, unit totals, research target, government, and pause/timer state.
5. For a finished game, rejoin from the game list and verify that the persisted
   end-game report is shown without recreating a live game instance.
6. If recovery fails, restore the pre-deploy backup and previous commit. Do not
   edit an individual save row without retaining the original row and audit log.

## Performance and soak checks

The release gate includes an 80×50 map generated for eight participants,
standard-map pathfinding, and `TurnManager.test.ts`, which processes 100
eight-participant audited turns without turn-number drift. Run:

```sh
cd apps/server
npx jest --runInBand --runTestsByPath \
  tests/game/TerrainGenerationFlowSequence.test.ts \
  tests/game/PathfindingManager.test.ts \
  tests/game/TurnManager.test.ts
```

The automated tests pin dimensions, participant count, turn count, and state
drift. For a deployment soak, repeat that game while sampling `/metrics` to
add process-level readiness and heap evidence. Fail the gate on a
turn-processing error, readiness failure, state mismatch after restart, or
sustained heap growth.
