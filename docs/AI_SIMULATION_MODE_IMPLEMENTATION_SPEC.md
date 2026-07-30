# AI Simulation Mode Implementation Specification

## Status

Proposed implementation specification. This document defines the required
behavior and architecture for the first CivJS AI-versus-AI simulation mode. It
does not claim that the feature is currently implemented.

The authoritative random-stream prerequisite described below is implemented.
Simulation mode must reuse it rather than introduce a simulation-only random
source or deterministic keyed-decision scheme.

## Objective

Add a first-class **Simulation Game** mode in which every civilization is
controlled by the native CivJS AI and one or more authenticated users watch as
omniscient spectators.

Simulation mode is both a spectator experience and the primary supported
environment for diagnosing AI, turn-processing, persistence, diplomacy,
visibility, and long-running game-lifecycle defects. A developer or authorized
AI coding agent must be able to identify a run, inspect its exact configuration,
seek to the relevant turn, compare authoritative state across turns, inspect AI
inputs/outputs and phase telemetry, and export a machine-readable diagnostic
bundle without mutating the game.

The initial release must:

- create and start a game containing only AI civilizations;
- advance turns automatically on the authoritative server;
- support host-controlled pause, resume, single-step, and playback speed;
- provide an omniscient spectator UI designed around observation rather than
  empire management;
- persist enough live state to resume safely after a server restart;
- retain completed-turn checkpoints, events, and AI summaries for later
  turn-by-turn replay;
- persist structured diagnostic telemetry and failures that remain queryable
  after the process exits;
- expose a read-only, machine-readable diagnostic interface suitable for both
  the UI and an AI coding agent;
- introduce a strategy-provider boundary so an LLM-backed strategic planner can
  be added later without replacing authoritative game execution.

The native AI remains the only enabled strategy provider in this implementation.

## Non-goals

The first implementation does not include:

- actual LLM API calls, model configuration, API keys, or usage billing;
- LLM-generated narration;
- action-by-action cinematic replay;
- human participation in a simulation civilization;
- multiplayer host transfer;
- editing a running civilization's personality;
- disabling fog of war for the AI itself;
- a distributed or multi-process simulation scheduler;
- replay branching or resuming a new game from an old replay turn.

External observability-vendor integration is also out of scope. Diagnostic data
must first be durable and queryable through CivJS-owned schemas and services;
logs alone are not an acceptable diagnostic record.

## Existing foundations

The implementation must build on the existing architecture rather than create a
parallel game engine:

- `FreecivAIOrchestrator` already processes every `isAI` player through
  authoritative controllers and managers.
- `TurnManager` already serializes turn processing, persists turn records and
  phases, creates replay snapshots, and evaluates end-game conditions.
- `GameReplayService` already exposes completed turns, phases, events, and
  authoritative snapshots and rejects incomplete replay checkpoints.
- observer connections already receive a complete, omniscient map/unit/city
  snapshot before readiness is acknowledged.
- `GameSessionCoordinator` already distinguishes player and observer session
  intent.
- `recentDecisionTrace` already records native AI phase inputs, candidate
  scores, selected actions, economic deltas, errors, and action counts.
- each game already owns a port of Freeciv's `fc_rand()` stream. Its complete
  state and the Freeciv-style identity counter are persisted at authoritative
  turn/phase boundaries and restored during recovery.
- AI fuzziness and gameplay outcomes already consume that shared stream in
  authoritative call order. Generated maps use their separate seeded generator
  without consuming or replacing the gameplay stream.

The existing paired AI regression gate runs three fixed seeds for 12 turns,
swaps hard/easy starting positions, and currently expects exact aggregate
results of `hardTotal = 110`, `easyTotal = 98`, and `hardWins = 2`. These are
versioned regression expectations, not statistical minimums. Change them only
after reviewing an intentional AI or gameplay change and its decision traces;
do not loosen them to absorb nondeterministic execution.

The current assumptions that must be changed are:

- `GAME_CREATE` always joins the creator as a human player;
- `GameRoute` attempts a player join before falling back to observation;
- turn advancement is released by human turn completion or the normal turn
  timer;
- the game header and empire tabs assume a valid `currentPlayerId`;
- the live AI decision trace is rolling state, not a durable replay history.

## Product behavior

### Main menu

Add a **Simulation Game** button to the CivJS home screen. It navigates to
`/create-simulation`.

The existing **Start New Game**, **Quick Start**, and **Browse Games** behavior
must remain unchanged.

### Simulation setup

The simulation creation screen must collect:

- game name;
- AI civilization count: 2, 3, 4, 6, or 8;
- AI difficulty;
- map size;
- terrain-generation settings;
- initial simulation speed;
- selectable victory goals and a hard maximum-turn cap;
- AI strategy provider;
- diagnostic telemetry level.

The only enabled strategy-provider option is **Native AI**. The UI may display
**LLM Strategy (Coming Later)** as disabled explanatory text, but it must not
submit an unsupported provider.

Recommended defaults:

```ts
{
  aiPlayerCount: 6,
  aiLevel: 'normal',
  mapSize: 'standard',
  speed: 'normal',
  maxTurns: 500,
  victoryConditions: ['conquest'],
  strategyProvider: 'native',
  spectatorVisibility: 'omniscient',
  diagnostics: {
    level: 'standard'
  }
}
```

The creator does not choose a player nation and does not receive a human
civilization. Authentication is still required because the creator owns the
simulation and its runtime controls.

Use a simulation-specific creation store or form model. Do not add fake player
name/nation values to the existing standard-game form to satisfy its
validation.

### Live simulation

After successful creation:

1. the server has persisted the game and all requested AI players;
2. the game is active and has a ready runtime;
3. the creator's connection has role `spectator`;
4. the creator has received a complete observer snapshot;
5. the client navigates to `/simulation/:gameId`;
6. the server schedules the next simulation turn.

The browser must not be responsible for advancing turns. Closing every
spectator browser must not stop a running simulation.

### Runtime controls

The simulation host can:

- pause after the current in-progress turn;
- resume;
- process one turn while paused;
- choose slow, normal, or fast speed.

Other spectators can watch but cannot control the simulation.

Recommended delays between completed turns:

| Speed  |   Delay |
| ------ | ------: |
| Slow   | 3000 ms |
| Normal | 1000 ms |
| Fast   |  200 ms |

The delay is between turns, not a deadline for AI work. A slow turn must finish
before the next one can begin.

### Simulation end conditions

Simulation setup must distinguish selectable victory goals from the hard turn
cap. Victory goals can end the game early. The hard cap always ends a
simulation that has not already reached a selected goal.

Supported selectable goals:

| UI label         | Server value  | Result                                                          |
| ---------------- | ------------- | --------------------------------------------------------------- |
| Conquest         | `conquest`    | One surviving civilization/team remains                         |
| Science victory  | `science`     | A completed spaceship reaches its arrival turn                  |
| Cultural victory | `culture`     | Ruleset culture threshold and required lead are reached         |
| World peace      | `world_peace` | All survivors remain out of war for the ruleset-required period |
| Allied victory   | `allied`      | All surviving civilizations are mutually allied                 |

Scenario victory is available only when a selected scenario declares/supports
it. Team victory is the result of conquest by a surviving team and is not a
separate checkbox. `spaceship`, `worldpeace`, and `allied_victory` remain
accepted server aliases for compatibility but the client submits canonical
values.

The default is **Conquest** with a **500-turn hard cap**. Conquest is the
intended victory; if it has not occurred by turn 500, the highest authoritative
score wins and exact score ties share the win.

Provide presets:

| Preset              |   Turns | Intended use                                      |
| ------------------- | ------: | ------------------------------------------------- |
| Smoke test          |      50 | Lifecycle, early expansion, and crash detection   |
| Short diagnostic    |     200 | Mid-game AI behavior and faster regression runs   |
| Standard simulation |     500 | Default complete-game observation and comparison  |
| Long simulation     |    1000 | Endurance, stalemate, and late-game investigation |
| Custom              | 10–5000 | Explicit advanced value                           |

`maxTurns` remains a separate mandatory authoritative safety cap rather than
being implemented as a selectable victory goal or score-planner objective. It
ends the game even when no selectable victory goal is enabled or reached.

Validation rules:

1. Simulation creation always requires `maxTurns` in the supported positive
   range; the normal UI does not offer an unlimited option.
2. Every supported victory goal can be selected or deselected independently.
3. If no victory goal is selected, submit
   `victoryConditions: ['max_turns']` rather than an empty array. The current
   end-game evaluator treats an empty condition list as legacy conquest
   default.
4. `max_turns` is a protocol normalization sentinel, not a checkbox.
5. Unsupported/scenario-only conditions fail runtime validation.
6. The normalized condition set and cap are persisted in the immutable run
   manifest and replay manifest.

The existing authoritative evaluation order remains:

```text
scenario → science → world peace → conquest/team → allied → culture → turn limit
```

Therefore, if a special victory and the turn cap occur on the same turn, the
special victory wins according to this order. The final report must retain the
actual reason and standings.

When Conquest is deselected, eliminating all rivals does not end the simulation
early; the run continues until another selected goal or the hard cap. The setup
screen should explain this consequence.

A critical processing failure pauses the runner and marks the run failed or
degraded for diagnostics; it is not converted into a victory. Deleting or
explicitly abandoning a simulation is an administrative lifecycle action, not
a win condition.

### Reference score parity

The existing CivJS score formula is not in parity with Freeciv
`server/score.c`. Simulation standings and hard-cap winners must not treat the
current approximation as the final reference implementation.
This prerequisite is tracked as `GP-035` in
[`GAMEPLAY_GAPS.md`](GAMEPLAY_GAPS.md) and in the scoring section of
[`PORTING_INVENTORY.md`](PORTING_INVENTORY.md).

Port the reference civilization score into one shared authoritative
`ScoreService` used by live standings, end-game evaluation, replay, and
diagnostics.

The reference total is:

```text
total citizens
+ known technologies × 2
+ great wonders × 5
+ arrived spaceship score
+ floor(units built / 10)
+ floor(units killed / 3)
+ floor(culture / 50)
```

Known-technology scoring must preserve Freeciv's future-technology adjustment:
the technology count receives `floor(futureTechs × 5 / 2)` before the complete
technology term is multiplied by two. Integer truncation must match the
reference.

The current CivJS approximation:

```text
population × 10
+ cities × 100
+ current units × 20
+ technologies × 50
+ history
```

must be removed from winner selection once the parity service is wired. It
weights shared categories differently, scores city/current-unit counts that the
reference total does not directly include, and omits great wonders, built/killed
unit history, future-technology weighting, and arrived-spaceship score.

Required supporting work:

- persist monotonic per-player units-built, units-killed, and units-lost
  counters at authoritative lifecycle boundaries;
- count citizens, including normal specialists, with reference-equivalent
  semantics;
- identify owned great wonders from loaded ruleset genus and current ownership;
- extend spaceship state as needed to represent the reference arrived-ship
  population and success-rate score rather than inventing a part-count score;
- use the authoritative culture/history accumulator with reference `/ 50`
  integer scaling;
- expose reference score categories and total to live simulation/replay views;
- calculate hard-cap team rankings from the sum of living,
  non-surrendered/non-conceded member scores, matching Freeciv interruption
  ranking rather than comparing only individual players;
- document and test tie behavior explicitly against selected reference
  fixtures.

Additional report-only metrics such as cities, population, production, land,
literacy, current units, treasury, and spaceship parts may still be displayed,
but they must not silently change the parity total.

### Spectator visibility

Simulation spectators and replay viewers are omniscient:

- every map tile is known and currently visible;
- all units, cities, borders, ownership, and public player statistics are
  visible;
- fog rendering is disabled in the spectator projection;
- ongoing broadcasts remain complete, not only the initial snapshot.

Fog of war and information handicaps remain active internally for each AI.
Neither the native strategy provider nor a future LLM strategy provider may
receive spectator-only information. Strategy snapshots must be built from the
AI player's visible/known state and configured handicaps.

### Spectator navigation

Retain the existing tabbed game shell and map renderer, but replace
player-management tabs in simulation and replay modes.

Required simulation tabs:

| Tab           | Purpose                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Map           | Omniscient map; clicking a city, unit, or civilization can change observer focus without issuing gameplay commands |
| Overview      | Global standings, leaders, wars, victory progress, and comparative trends                                          |
| Civilizations | Personality, economy, government, research, city/unit counts, strategic goals, and recent decisions                |
| Diplomacy     | Global relationship graph/table, wars, alliances, treaties, grievances, and attitude changes                       |
| Timeline      | Major events and AI summaries; becomes the turn navigator in replay mode                                           |
| Diagnostics   | Run identity, warnings/errors, phase timing, state hashes, data completeness, and diagnostic export                |

Settings remain available through the game menu.

Add an observer focus field independent of player authority:

```ts
selectedObserverPlayerId: string | null;
```

With no selection, panels show global information. With a selection, panels
filter or highlight that civilization. Observer focus must never populate
`currentPlayerId` or grant mutation authority.

The live header must show:

- current turn and year;
- running, paused, or ended state;
- current speed;
- pause/resume;
- step while paused;
- speed selector;
- game menu.

When a turn or subsystem fails, the header must show a persistent diagnostic
indicator linking to the failing turn and Diagnostics tab. A transient toast is
not sufficient.

Do not render player-only controls in simulation or replay mode, including:

- Turn Done;
- production or citizen mutations;
- research selection;
- tax/government changes;
- diplomacy proposal/response controls;
- unit orders and context actions;
- concession or control-transfer actions.

Mutation prevention must also be enforced on the server; hiding controls is not
authorization.

## Domain model

### Game mode and persistent configuration

Keep the existing `gameType` semantics for standard single-player and
multiplayer games. Add a separate mode discriminator rather than teaching every
`gameType === 'single'` branch about simulations.

```ts
export type GameMode = 'standard' | 'simulation';

export type SimulationSpeed = 'slow' | 'normal' | 'fast';
export type SimulationRunState = 'running' | 'paused' | 'ended';
export type SimulationDiagnosticLevel = 'standard' | 'verbose';
export type AIStrategyProviderId = 'native' | 'llm';
export type SimulationVictoryCondition =
  'max_turns' | 'conquest' | 'science' | 'culture' | 'world_peace' | 'allied' | 'scenario';

export interface SimulationConfig {
  enabled: true;
  aiPlayerCount: number;
  speed: SimulationSpeed;
  runState: SimulationRunState;
  maxTurns: number;
  victoryConditions: SimulationVictoryCondition[];
  spectatorVisibility: 'omniscient';
  strategy: {
    provider: AIStrategyProviderId;
    reviewIntervalTurns: number;
    eventDrivenReviews: boolean;
  };
  diagnostics: {
    level: SimulationDiagnosticLevel;
    schemaVersion: number;
  };
}
```

Persist the first version under `games.gameState.simulation`. Persisted JSON
must be runtime-validated during normal load and recovery. An invalid
simulation configuration must fail closed with an operator-visible error.

`llm` is reserved in the type and provider registry, but creation/control
validation must reject it as unavailable until a provider is installed and
enabled server-side.

Keep `games.status` as the game lifecycle state. Pausing simulation scheduling
sets `simulation.runState = 'paused'`; it does not change an active game into a
human-disconnect pause. This allows a host to single-step without temporarily
changing the authoritative game lifecycle state.

### Diagnostic run identity

Every simulation is also a diagnostic run. Persist an immutable run manifest at
creation so an observed failure can be tied to the exact executable and
configuration that produced it:

```ts
interface SimulationRunManifest {
  runId: string;
  gameId: string;
  createdAt: Date;
  codeVersion: string;
  protocolVersion: number;
  diagnosticSchemaVersion: number;
  rulesetId: string;
  rulesetHash: string;
  mapSeed: string;
  authoritativeRandomSeed: number;
  normalizedConfig: SimulationConfig;
  aiImplementationVersion: string;
  randomizationVersion: string;
}
```

`runId` is stable and distinct from a socket/session ID. `codeVersion` should be
the deployed commit/build identifier when available and an explicit
`development-unknown` value otherwise. Hashes and version fields are diagnostic
metadata, not security claims.

`mapSeed` and `authoritativeRandomSeed` are intentionally separate. Map
generation must remain isolated from authoritative gameplay randomness, as in
Freeciv's temporary map-random state. `randomizationVersion` identifies the
generator and stream-consumption contract, not merely the initial seed.

Every durable diagnostic, AI summary, failure, and replay frame must be
correlatable by `runId`, `gameId`, turn number, and—where applicable—player,
phase, and monotonic sequence.

Standard telemetry stores turn/phase aggregates, state hashes, significant
events, failures, and compact AI summaries. Verbose telemetry may additionally
retain bounded planner alternatives and redacted provider input/output. Verbose
mode must remain bounded and must not record credentials or unrestricted
process environment data.

### Transient scheduler state

Timer handles and in-progress promises are process-local and must not be stored
in JSON:

```ts
interface SimulationRuntime {
  gameId: string;
  timer: NodeJS.Timeout | null;
  processing: Promise<void> | null;
  generation: number;
}
```

The generation/token value invalidates callbacks scheduled before a pause,
speed change, recovery replacement, cleanup, or end-game transition.

The game's random generator and identity allocator are not transient scheduler
state. They are authoritative state and must remain attached to the recovered
`GameInstance`.

### Personality presets

Use existing `AITraits` as the behavioral input. Add stable preset metadata so
the spectator UI can explain the assigned profile.

Initial presets:

- balanced;
- expansionist;
- builder;
- militarist;
- trader;
- aggressive.

Preset assignment must be deterministic from the authoritative game seed and
stable player-slot creation order. If assignment requires randomness, it must
consume the game's shared authoritative stream; it must not derive ordering
from random UUIDs or introduce a second AI-only generator. Persist both the
preset ID and resulting trait values. A replay or server restart must not
reroll personalities.

The default native AI path must continue to use the existing difficulty and
trait behavior.

## Server architecture

### Typed protocol

Add typed, runtime-validated, correlated request/reply packets. Do not introduce
uncorrelated Socket.IO events for the new command family.

Required logical operations:

```text
SIMULATION_CREATE
SIMULATION_CREATE_REPLY
SIMULATION_GET_STATE
SIMULATION_STATE
SIMULATION_CONTROL
SIMULATION_CONTROL_REPLY
REPLAY_GET_MANIFEST
REPLAY_MANIFEST
REPLAY_GET_TURN
REPLAY_TURN
SIMULATION_GET_DIAGNOSTICS
SIMULATION_DIAGNOSTICS
SIMULATION_EXPORT_DIAGNOSTICS
SIMULATION_EXPORT_DIAGNOSTICS_REPLY
```

Exact packet numbers must be appended without renumbering existing packet
values. All replies echo `requestId`.

The packet interface powers the authenticated UI. The same
`SimulationDiagnosticsService` must also expose a read-only CLI/export adapter
for local development agents; diagnostic query logic must not be duplicated in
the client, handler, and script.

`SIMULATION_CONTROL` accepts one of:

```ts
type SimulationControlCommand =
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'step' }
  | { action: 'set_speed'; speed: SimulationSpeed };
```

### Creation command

Implement simulation creation as an application-level command rather than a
sequence of client requests.

The command must:

1. authenticate and identify the host;
2. validate configuration and provider availability;
3. create the game;
4. create exactly `aiPlayerCount` AI records;
5. assign unique nations/colors and deterministic personalities;
6. initialize AI state;
7. start and fully initialize the game runtime;
8. mark the socket as a spectator and join the game room;
9. send a complete observer snapshot;
10. acknowledge readiness;
11. schedule the first turn.

The operation must not call the standard creator auto-join path.

Refactor the AI-record insertion currently embedded in
`PlayerConnectionManager.ensureMinimumPlayers` into a reusable exact-count
service. Standard games must retain their existing minimum-player behavior.

Creation/start must be idempotent under a correlated retry. Do not create a
second game or duplicate AI rows if the client retries after losing the reply.
Align this work with the atomic-start and single-flight recovery constraints in
`SERVER_CORE_ARCHITECTURE_ROADMAP.md`.

### Simulation runner

Add a server-owned `SimulationRunner` with one runtime entry per recovered live
simulation.

Required invariants:

1. At most one scheduled timer exists per game.
2. At most one `TurnManager.processTurn()` promise executes per game.
3. A timer callback re-reads authoritative simulation state before processing.
4. Pausing cancels pending scheduling but does not interrupt a turn already in
   progress.
5. Step is accepted only while paused and processes exactly one turn.
6. Resume schedules one future turn; repeated resume requests are idempotent.
7. A speed change invalidates and reschedules a pending timer.
8. A successful turn schedules the next turn only after all turn completion,
   persistence, end-game evaluation, and broadcasts finish.
9. A failed turn leaves the simulation paused and emits an operator/spectator
   error; it does not spin in a retry loop.
10. Ended, deleted, or cleaned-up games have no timer or processing callback.

Use the existing turn-processing lease as an additional durable guard. Do not
rely only on an in-memory boolean.

Integrate scheduling with the existing turn-advanced callback instead of
installing a competing callback. Simulation games must skip normal human turn
timer restoration/start; otherwise the normal timer and simulation runner can
both attempt to advance the same turn.

### Recovery

After a simulation runtime is fully recovered:

- validate and load `SimulationConfig`;
- restore the persisted Freeciv random state and identity counter before any AI
  or gameplay work can execute;
- recreate the `SimulationRunner` entry;
- leave paused simulations unscheduled;
- schedule running simulations from a fresh full delay;
- do not schedule ended games;
- do not publish or schedule a partially hydrated runtime.

Recovery must be single-flight per game as required by the server architecture
roadmap. Scheduler creation occurs after cities, units, research, diplomacy,
visibility, callbacks, and replay state are ready.

### Authorization

Gameplay handlers continue rejecting spectator mutations.

Simulation controls are a separate host capability:

- the requester must be authenticated;
- the game must be a simulation;
- the requester user ID must equal `games.hostId`;
- step/resume/pause/speed validation must be state-aware;
- authorization is checked for every command, not cached only in client state.

`SIMULATION_STATE` may include a recipient-specific `canControl` boolean.

### Spectator read model

Provide one typed simulation read model instead of asking the client to infer
authority, standings, or AI state from unrelated packets:

```ts
interface SimulationStateView {
  gameId: string;
  turn: number;
  year: number;
  runState: SimulationRunState;
  speed: SimulationSpeed;
  canControl: boolean;
  civilizations: Array<{
    playerId: string;
    nation: string;
    leaderName: string;
    color: string;
    alive: boolean;
    personalityId: string;
    aiLevel: string;
    government: string;
    gold: number;
    science: number;
    history: number;
    cityCount: number;
    unitCount: number;
    currentResearch?: string;
    victoryProgress?: Record<string, number>;
    recentSummary?: AITurnSummaryView;
  }>;
  relationships: SimulationRelationshipView[];
  recentEvents: SimulationEventView[];
}
```

Do not use the currently hard-coded player packet score of zero as a simulation
standing. Either calculate an authoritative comparable standing or present
named underlying metrics.

Broadcast a refreshed simulation state after:

- creation/start;
- every completed turn;
- pause/resume/step/speed control;
- elimination or game end;
- spectator resync.

### Diagnostic telemetry service

Add a read-only `SimulationDiagnosticsService` as the single query/export
boundary for the Diagnostics tab, replay diagnostics, tests, operators, and AI
coding agents.

Durable telemetry must be structured and schema-versioned. Console logs may
mirror it, but console logs are not the source of truth.

At minimum, record:

- run lifecycle transitions and correlation/request IDs;
- scheduler state transitions, requested delay, actual delay, and generation;
- turn start/end, total duration, success/failure, and pre/post state hash;
- every turn phase's duration, status, action count, warning/error count, and
  affected player when applicable;
- per-AI phase action counts, accepted strategic-plan identity, fallback use,
  and compact selected-action summary;
- city/unit/player counts and aggregate economic totals before and after each
  turn;
- persistence checkpoint and AI-summary write status;
- replay-frame completeness;
- recovery start/end/failure and restored scheduler state;
- invariant violations, caught exceptions, and forced-pause reason;
- future strategy-provider latency, cache result, token usage, and cost.

Use a monotonic `sequence` within each run/turn so diagnostics from concurrent
subsystems have a stable order. Store wall-clock timestamps for operations, but
do not use timestamps as the only ordering mechanism.

Recommended durable record:

```ts
interface SimulationDiagnosticRecord {
  id: string;
  runId: string;
  gameId: string;
  turnId?: string;
  turn?: number;
  sequence: number;
  playerId?: string;
  phase?: string;
  category:
    | 'lifecycle'
    | 'scheduler'
    | 'turn'
    | 'phase'
    | 'ai'
    | 'persistence'
    | 'recovery'
    | 'invariant'
    | 'failure';
  severity: 'debug' | 'info' | 'warning' | 'error' | 'critical';
  code: string;
  durationMs?: number;
  payload: Record<string, unknown>;
  createdAt: Date;
}
```

Failure records must include a stable error code, subsystem/stage, turn, phase,
player when relevant, message, exception type, redacted stack, causal
correlation ID, last completed checkpoint, and a bounded structured context.
They must not include API keys, authorization credentials, database URLs, raw
environment variables, or unredacted future model secrets.

When turn processing fails after partially mutating in-memory state, the server
may persist a diagnostic-only partial snapshot or state hash. It must be clearly
marked non-authoritative and must never be used for recovery or normal replay.
The last completed checkpoint remains the live recovery authority.

Diagnostic persistence failure must not silently disappear. Emit a structured
server error and mark the run's diagnostic completeness as degraded. Avoid
recursively attempting to persist a failure about diagnostic persistence.

### Machine-readable diagnostic export

An authorized host/operator or local development agent must be able to export a
bounded diagnostic bundle for an entire run or selected turn range.

Provide a command with equivalent behavior to:

```sh
npm run simulation:diagnostics -- --game-id <id> --from-turn 40 --to-turn 50
```

The export is read-only and contains:

```text
manifest.json
turns.ndjson
phases.ndjson
events.ndjson
ai-turn-summaries.ndjson
diagnostics.ndjson
failures.ndjson
snapshots/
```

Each file must include a schema version. The manifest records omitted sections,
redactions, completeness, and the requested/exported turn range. NDJSON ordering
must be deterministic so two exports of unchanged data produce semantically
equivalent output.

The service must also support a concise diagnostic summary suitable for pasting
into an issue or agent prompt: run/build identity, configuration, failing turn
and phase, last successful checkpoint, top warnings/errors, affected
civilization, and references to the detailed records.

Exports default to host/operator authorization. Local CLI access follows the
project's database/environment access controls and must not create a public
unauthenticated diagnostics endpoint.

### Strategy-provider seam

Do not overload `AIDecisionSource`; it adapts the game's shared authoritative
Freeciv random stream for fuzziness and random sampling, not strategic
planning. Decision keys may remain diagnostic labels but must not select an
independent random value.

Add:

```ts
interface AIStrategyProvider {
  readonly id: AIStrategyProviderId;
  createPlan(context: AIStrategicContext): Promise<AIStrategicPlan>;
}

interface AIStrategicPlan {
  provider: AIStrategyProviderId;
  createdTurn: number;
  expiresTurn: number;
  priorities: string[];
  productionBias: Record<string, number>;
  researchBias: Record<string, number>;
  diplomaticStances: Record<string, string>;
  rationale?: string;
}
```

Add an `AIStrategyCoordinator` invoked by `FreecivAIOrchestrator` before the
existing per-player controller phases. It:

- reuses an unexpired plan;
- asks the configured provider for a replacement when due;
- validates and clamps every plan field;
- persists the accepted plan in `FreecivAIState`;
- falls back to the native provider on provider failure;
- never allows provider output to mutate game state directly.

The initial `NativeStrategyProvider` returns neutral bounded modifiers so the
existing native AI behavior remains unchanged. Wire production, research, and
diplomacy planning inputs to accept the bounded plan modifiers, with neutral
values preserving existing results exactly.

Provider contexts must be compact, deterministic structured data derived from
the AI's legal knowledge. Future LLM implementation details such as model,
budget, cache, tokens, and API key remain server-only.

## Persistence

### Live save

The existing normalized game/player/city/unit/research/diplomacy persistence
remains authoritative. Persist simulation settings and AI strategic plans with
the same completed-turn lifecycle as other game state.

At minimum, a recoverable save includes:

- game lifecycle state, current turn, year, and map;
- players, cities, units, research, government, economy, and diplomacy;
- per-player native AI state and personality metadata;
- the authoritative random seed, complete Freeciv random state, and
  Freeciv-style identity counter;
- current accepted strategic plan;
- simulation run state and speed;
- immutable diagnostic run identity and schema version;
- diagnostic completeness/degradation status and last durable sequence;
- end-game status/report.

Do not persist timer handles or wall-clock assumptions. On recovery, a running
simulation receives a new full inter-turn delay.

### Replay checkpoints

Continue treating completed `gameTurns` records as immutable replay frames:

- turn and year;
- authoritative state snapshot;
- player actions;
- statistics;
- completed phase records;
- ordered turn events.
- the post-turn authoritative random state and identity counter needed to
  reproduce the next turn.

Only a turn with successful required phases and a non-null completion marker is
replayable. Never expose an in-progress checkpoint as a completed replay turn.

The first replay viewer is turn-by-turn. Full state snapshots per completed
turn are acceptable initially. Do not introduce checkpoint/delta compression
until measured storage warrants the additional reconstruction complexity.

### Durable AI summaries

`recentDecisionTrace` remains useful live rolling state but is not sufficient
as permanent history.

Persist one compact AI turn summary per civilization per completed turn. A
dedicated `ai_turn_summaries` table is preferred over embedding an unbounded
array in player state.

Required fields:

```ts
interface AITurnSummaryRecord {
  id: string;
  gameId: string;
  turnId: string;
  playerId: string;
  turn: number;
  provider: AIStrategyProviderId;
  personalityId: string;
  goals: unknown;
  phaseActions: unknown;
  selectedActions: unknown;
  economicDelta: unknown;
  rationale: string | null;
  errors: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicros: number | null;
  createdAt: Date;
}
```

Token/cost fields remain null for the native provider and reserve a stable
future reporting contract.

Avoid storing every full candidate-score map indefinitely. Store selected
actions, goals, aggregate phase counts, errors, and a bounded set of meaningful
alternatives. The detailed rolling trace may remain in the live AI state.

Write summaries as part of completed-turn finalization so a replay never shows
AI reasoning for a turn whose authoritative state did not complete.

### Durable diagnostic records

Add a `simulation_diagnostics` table for schema-versioned records that must
survive process exit and remain queryable independently of transient logs.
Index at least:

- `(game_id, turn, sequence)`;
- `(run_id, severity, created_at)`;
- `(game_id, category, code)`;
- `(player_id, turn)` where player ID is present.

Persist the immutable run manifest either in a dedicated `simulation_runs`
table or a separately validated immutable game-state section. Prefer a
dedicated table if doing so avoids rewriting mutable `games.gameState` to
preserve creation metadata.

Completed turn snapshots should include or be accompanied by a canonical state
hash. The hashing format must be versioned and must exclude unstable fields such
as wall-clock timestamps and database-generated record ordering. The purpose is
to detect state divergence and compare reproductions, not to replace snapshot
validation.

Retention defaults to the lifetime of the simulation/replay. Any future pruning
must preserve the run manifest, failures, completed-turn metadata, end-game
report, and explicit completeness markers. Deleting a game may continue to
cascade its diagnostics when the user explicitly confirms deletion.

## Replay

### Replay library

Active simulations expose **Watch Live**. Completed simulations expose **Watch
Replay**. Active simulations may also expose replay through their latest
completed turn.

Add `/replay/:gameId`.

### Replay transport

Extend `GameReplayService` or add a narrow replay query facade returning:

- manifest: game metadata, available turn range, players/personalities,
  end-game report, and major event index;
- individual completed turn frame: snapshot, phases, events, statistics, and
  AI summaries;
- diagnostic records and state hashes associated with the requested frame.

Fetch frames on demand. Do not send an entire long game replay in one payload.
The client may prefetch the adjacent turn.

### Replay client state

Use a dedicated replay store. Do not load replay frames into the live
authoritative `gameStore` in a way that can trigger normal gameplay effects or
send commands.

Required replay controls:

- play/pause;
- previous/next turn;
- timeline scrub/jump;
- slow, normal, and fast replay speed;
- jump to major event;
- observer civilization filter;
- omniscient view by default.
- diagnostics overlay/filter for the selected turn.

The existing map renderer should consume a read-only adapter/view model shared
between live observer and replay state where practical.

Replay playback changes client frames only. It never calls
`TurnManager.processTurn()` and never recovers the historical snapshot as a
live game.

### Replay fidelity

The first release displays the authoritative end state of each completed turn.
It does not animate every movement or combat action.

Future action-level replay requires ordered events with a monotonic sequence
within each turn/phase. New simulation-relevant events should therefore record
an explicit sequence rather than depend on timestamps for ordering.

Replay is also the primary visual debugger. From any warning, error, invariant,
or AI summary, a viewer must be able to jump to its turn, select the affected
civilization, inspect the before/after aggregate state and hashes, and open the
underlying structured record. A replay must visibly indicate missing or
degraded telemetry rather than presenting an incomplete run as complete.

## Client architecture

### Routes

Add:

```text
/create-simulation
/simulation/:gameId
/replay/:gameId
```

`/simulation/:gameId` must begin with observer intent and must never attempt a
player join.

Direct observer navigation must authenticate before requesting
`observe_game`; the current player-first fallback happens to authenticate
before observing and cannot be relied on after adding an explicit observer
route.

### Session and stores

Expose explicit rendered session metadata:

```ts
sessionRole: 'player' | 'spectator';
gameMode: GameMode;
selectedObserverPlayerId: string | null;
```

Keep simulation creation, live game state, simulation control/read state, and
replay playback state in appropriately separate models. Do not create a second
copy of the live map outside the established client state boundary.

Reset role, mode, observer focus, simulation state, and replay state on explicit
disconnect/exit.

### Rendering

Add a simulation/replay variant of `GameLayout` rather than scattering
`currentPlayerId === ''` checks through player panels.

Shared elements:

- map canvas and renderers;
- page/game chrome;
- notifications;
- game menu;
- player/nation presentation components where read-only.

Simulation/replay elements:

- observer tabs;
- simulation header and controls;
- overview standings;
- civilization details;
- diplomacy overview;
- timeline and replay controls;
- diagnostics filters, record detail, failure navigation, completeness status,
  and export.

Player-only hooks such as keyboard unit control must not be mounted in
simulation/replay mode.

### Fog rendering

The observer map snapshot already represents omniscient tiles as known and
seen. Add explicit render-mode coverage so simulation and replay cannot regress
to player fog due to a missing `currentPlayerId`.

Do not globally alter `VisibilityManager` behavior or player visibility data.

## File-level implementation map

Names below are recommended; an implementation may adjust names while
preserving responsibilities.

### Client

- `apps/client/src/App.tsx`
  - register simulation creation, live simulation, and replay routes.
- `apps/client/src/components/HomePage.tsx`
  - add **Simulation Game**.
- `apps/client/src/components/SimulationCreationDialog.tsx`
  - simulation-specific setup and validation.
- `apps/client/src/store/simulationCreationStore.ts`
  - persisted setup draft independent from standard game creation.
- `apps/client/src/services/GameClient.ts`
  - correlated simulation/replay requests and explicit authenticated observer
    flow.
- `apps/client/src/services/GameSessionCoordinator.ts`
  - preserve explicit observer intent across reconnects.
- `apps/client/src/store/gameStore.ts`
  - rendered session role/mode and observer focus.
- `apps/client/src/store/simulationStore.ts`
  - simulation read model and controls state.
- `apps/client/src/store/replayStore.ts`
  - replay manifest/frame cache and playback state.
- `apps/client/src/components/SimulationRoute.tsx`
  - direct observer session.
- `apps/client/src/components/ReplayRoute.tsx`
  - read-only replay loading.
- `apps/client/src/components/GameUI/SimulationLayout.tsx`
  - observer-oriented shell.
- `apps/client/src/components/Simulation/*`
  - controls, overview, civilization, diplomacy, timeline, and diagnostics
    views.
- `apps/client/src/types/*`
  - shared wire/domain types.

### Server

- `apps/server/src/types/packet.ts`
  - runtime schemas for simulation and replay request/reply payloads.
- packet type/name catalogues
  - append new packet IDs without renumbering.
- `apps/server/src/network/handlers/GameManagementHandler.ts`
  - route simulation commands through narrow application services.
- `apps/server/src/game/services/SimulationGameService.ts`
  - atomic/idempotent creation and authorization orchestration.
- `apps/server/src/game/services/SimulationRunner.ts`
  - scheduling, pause/resume/step/speed, cleanup, and recovery binding.
- `apps/server/src/game/services/SimulationReadService.ts`
  - typed spectator read model.
- `apps/server/src/game/services/ScoreService.ts`
  - reference-parity score categories, total, and hard-cap team ranking.
- `apps/server/src/game/services/SimulationDiagnosticsService.ts`
  - durable diagnostic recording, query, summary, redaction, and export.
- `apps/server/src/game/orchestrators/PlayerConnectionManager.ts`
  - extract reusable exact-count AI creation.
- `apps/server/src/game/orchestrators/GameLifecycleManager.ts`
  - mode-aware initialization, persistence, and timer behavior.
- `apps/server/src/game/services/GameInstanceRecoveryService.ts`
  - restore mode/config before scheduling and publish only complete runtimes.
- `apps/server/src/game/managers/GameManager.ts`
  - own runner/service composition and turn-advanced integration.
- `apps/server/src/game/ai/AIStrategyProvider.ts`
  - provider and strategic plan contracts.
- `apps/server/src/game/ai/NativeStrategyProvider.ts`
  - behavior-preserving native provider.
- `apps/server/src/game/ai/AIStrategyCoordinator.ts`
  - cadence, validation, persistence, and fallback.
- `apps/server/src/game/services/AIOrchestrator.ts`
  - invoke strategy coordination before native controller phases.
- `apps/server/src/game/ai/AIStateStore.ts`
  - validated optional personality and strategic-plan state.
- `apps/server/src/game/services/GameReplayService.ts`
  - manifest/frame queries including AI summaries.
- `apps/server/src/database/schema/ai-turn-summaries.ts`
  - durable compact AI summaries and relations.
- `apps/server/src/database/schema/simulation-diagnostics.ts`
  - durable run diagnostics, failures, ordering, and indexes.
- `apps/server/src/database/schema/simulation-runs.ts`
  - immutable run/build/configuration manifest if not represented by a
    separately validated immutable record.
- `apps/server/src/scripts/export-simulation-diagnostics.ts`
  - read-only local/agent diagnostic bundle export.
- Drizzle migration and metadata
  - create run, summary, diagnostic tables, player score counters, and required
    indexes.

## Implementation sequence

Implement vertical slices in this order.

### Phase 1: Contracts and persistence

1. Reuse and validate the existing persisted authoritative random/identity
   state; do not add a simulation-specific RNG.
2. Add mode/config/provider types and runtime schemas.
3. Add immutable run identity and diagnostic schema versions.
4. Add `ai_turn_summaries`, simulation run, and diagnostic schemas/migrations.
5. Add reference score counters and the shared parity score service.
6. Extend AI state validation for personality and accepted strategic plan.
7. Add focused score, codec, and recovery validation tests.

### Phase 2: AI-only creation

1. Extract reusable exact-count AI creation.
2. Add deterministic personality assignment.
3. Implement idempotent simulation creation/start.
4. Establish the host as spectator and send the full snapshot before reply.
5. Add server handler and integration coverage.

### Phase 3: Authoritative runner

1. Add runner scheduling and generation invalidation.
2. Integrate with turn completion and end-game handling.
3. Bypass normal human timers for simulations.
4. Add control authorization.
5. Restore running/paused state after recovery.

### Phase 4: Client creation and live observer

1. Add the home button and setup route.
2. Add explicit authenticated simulation observer route.
3. Add role/mode/observer-focus state.
4. Build the simulation header, controls, and omniscient map.
5. Gate player-only controls and hooks.

### Phase 5: Observer dashboards

1. Add the simulation read model and broadcasts.
2. Build Overview, Civilizations, Diplomacy, Timeline, and Diagnostics tabs.
3. Add observer focus and map highlighting.
4. Persist and display compact AI turn summaries.

### Phase 6: Turn-level replay

1. Add replay manifest/frame request contracts.
2. Include events, phases, statistics, and AI summaries.
3. Add replay route, store, timeline, and playback controls.
4. Reuse the omniscient simulation layout in read-only replay mode.
5. Link replay frames, telemetry, failures, AI summaries, and state hashes.
6. Add **Watch Live** and **Watch Replay** lobby actions.

### Phase 7: Diagnostic query and export

1. Add the shared diagnostics query/redaction service.
2. Add filtered packet queries for the Diagnostics tab and replay.
3. Add run/turn-range NDJSON diagnostic export.
4. Add concise issue/agent diagnostic summaries.
5. Verify degraded/missing telemetry is explicit and export ordering is stable.

### Phase 8: Strategy-provider seam

1. Add provider registry, native provider, and coordinator.
2. Persist accepted plans and refresh cadence.
3. Pass bounded modifiers to production, research, and diplomacy inputs.
4. Prove neutral modifiers preserve existing native AI behavior.
5. Keep `llm` unavailable with an explicit server error and disabled UI state.

## Acceptance criteria

### Creation and authority

- Creating a six-player simulation persists six AI players and zero human
  players.
- Every AI has a unique nation/color, configured difficulty, deterministic
  personality, and valid initial AI state.
- The run manifest records distinct map and authoritative gameplay seeds plus
  the randomization version.
- The creator is a spectator and receives a complete snapshot before the
  creation reply becomes ready.
- Reloading `/simulation/:gameId` reconnects directly as observer without
  attempting to join as a player.
- Standard game creation and joining remain unchanged.

### Turn scheduling

- A running simulation advances with no connected browser.
- Only one turn processes at a time under repeated timer/control callbacks.
- Pause prevents future automatic turns after an in-progress turn completes.
- Step while paused advances exactly one turn and remains paused.
- Resume is idempotent.
- Speed changes apply to the next scheduled turn.
- Turn failure pauses the simulation and does not retry continuously.
- Game end cancels scheduling permanently.

### End conditions

- New simulations default to `victoryConditions: ['conquest']` with a mandatory
  `maxTurns = 500` hard cap.
- The creation UI supports 50, 200, 500, and 1000-turn presets plus a validated
  custom value.
- Creation is rejected when the mandatory hard cap is outside its supported
  range.
- Each supported victory goal can be selected/deselected independently while
  the hard cap remains active.
- An empty UI selection is never serialized as the legacy empty
  `victoryConditions` array.
- A selected special victory can end the simulation before the cap.
- A special victory reached on the cap turn wins according to the documented
  authoritative evaluation order.
- Turn-cap ties preserve every tied winner in the end-game report.
- The replay/run manifest records selected conditions, cap, actual end reason,
  final turn, and standings.
- Hard-cap standings use the shared reference-parity score service and
  reference-equivalent team aggregation.
- Live, replay, diagnostic, persisted, and end-game totals agree for the same
  completed-turn snapshot.

### Visibility and security

- Spectators see the complete current map and all civilizations with no fog
  overlay.
- AI decisions continue to honor each AI's own visibility and handicaps.
- Spectators cannot submit gameplay mutations.
- Non-host spectators cannot control simulation speed/state.
- The host cannot use simulation controls against a standard game.

### Persistence and recovery

- Running simulations resume scheduling only after complete recovery.
- Paused simulations remain paused after restart.
- Personality, AI state, accepted strategic plans, speed, and run state survive
  restart.
- The exact random stream and identity counter survive restart, including
  recovery from a completed durable phase, so resumed execution produces the
  same next random value and entity ordering.
- An incomplete turn is not exposed as a replay frame.
- Recovery cannot create duplicate runner timers.
- Run identity, failures, completed-turn diagnostics, and state hashes survive
  restart independently from process logs.

### UI

- Simulation mode renders Map, Overview, Civilizations, Diplomacy, Timeline,
  and Diagnostics tabs.
- It does not render Turn Done or empire mutation controls.
- Selecting a civilization changes observer focus without changing authority.
- Live controls reflect authoritative state after acknowledgements and
  reconnects.
- Responsive behavior remains usable at the client-supported viewport sizes.

### Replay

- A completed simulation appears with **Watch Replay**.
- An active simulation can replay through its latest completed turn.
- A viewer can play, pause, seek, and change replay speed.
- Each frame shows its authoritative map/state, events, statistics, and AI
  summaries.
- Replay navigation never sends gameplay or turn-processing commands.
- Replay defaults to omniscient visibility.
- Warning/error records can navigate directly to the corresponding turn and
  affected civilization.
- Missing or degraded diagnostics are visibly identified.

### Diagnostics and agent access

- Every simulation has a stable run ID and immutable build/ruleset/configuration
  manifest.
- Every completed turn has versioned pre/post state hashes and ordered
  phase/turn telemetry.
- A turn-processing failure durably records its code, stage, context, last
  completed checkpoint, and forced-pause result.
- The Diagnostics tab can filter by turn, player, phase, category, severity,
  and code.
- An authorized user can export a selected turn range without loading the
  entire replay into the browser.
- The local diagnostic command emits a documented, deterministic,
  machine-readable bundle that an AI coding agent can inspect.
- The bundle contains no credentials, database URLs, API keys, or unrestricted
  environment data.
- Re-exporting unchanged data produces semantically equivalent ordered records.

### Strategy provider

- The native provider produces behavior-preserving neutral strategic
  modifiers.
- Provider output is validated, bounded, and unable to mutate game state.
- An unavailable LLM provider fails explicitly and falls back only according to
  the documented coordinator policy.
- Provider context contains no spectator-only hidden information.

## Required tests

### Server unit tests

- simulation configuration schema validation;
- end-condition normalization, aliases, no-goal `max_turns` sentinel, and
  mandatory turn-cap bounds;
- reference score category math, integer truncation, future technologies,
  wonders, unit counters, culture, arrived spaceship, team aggregation, and
  tie fixtures;
- deterministic personality assignment;
- Freeciv-compatible generator vectors, range reduction, state round-tripping,
  and identity-counter ordering;
- AI fuzziness consuming `fc_rand(1000)` from the shared stream;
- exact-count AI creation;
- runner pause/resume/step/speed state machine;
- stale timer generation rejection;
- no-overlap processing;
- host authorization;
- native strategy-plan validation and neutral modifiers;
- AI summary compaction;
- replay manifest/frame filtering of incomplete turns;
- canonical state hashing and unstable-field exclusion;
- diagnostic sequence allocation, redaction, filtering, and completeness;
- deterministic diagnostic export ordering.

### Server integration tests

- create simulation → create all AIs → start → observe snapshot;
- process multiple autonomous turns;
- pause/restart/recover/resume;
- fixed-seed paired AI games producing exact, swapped-position benchmark
  totals;
- fixed-seed replay and restart runs producing the same authoritative random
  state, next random value, and identity counter;
- running restart recovery without duplicate turn processing;
- end-game runner shutdown;
- each selectable victory condition and turn-cap-only completion;
- same-turn special-victory/turn-cap precedence and score ties;
- live score → persisted score → replay score → final standing consistency;
- spectator gameplay mutation rejection;
- non-host simulation-control rejection;
- completed-turn replay with AI summaries;
- persisted diagnostic records across recovery;
- turn failure → durable failure record → paused runner → replay/diagnostic
  query;
- diagnostic persistence failure without recursive failure recording;
- host-authorized and unauthorized diagnostic export;
- standard single-player and multiplayer lifecycle regression.

### Client tests

- home button and route;
- setup validation and payload;
- direct authenticated observer flow;
- reconnect preserving simulation observer intent;
- player controls absent in simulation/replay;
- simulation control request/acknowledgement handling;
- omniscient fog rendering;
- observer focus;
- dashboard state rendering;
- diagnostics filtering, failure navigation, and export request state;
- replay frame loading, seeking, playback, and cancellation;
- exit/reset behavior.

### Quality gate

Run checks proportional to each phase and the full gate before completion:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
```

Database integration tests require an isolated `TEST_DATABASE_URL`.

## Observability

Emit structured logs/metrics and corresponding durable diagnostic records where
the information is needed after process exit. Logs are an operational stream;
`simulation_diagnostics`, replay frames, AI summaries, and the run manifest are
the diagnostic authority.

Capture:

- simulation created/started/paused/resumed/stepped/ended;
- run ID, build identity, ruleset hash, map seed, and diagnostic schema version;
- scheduled turn delay and actual turn duration;
- runner generation invalidation;
- duplicate/overlap prevention;
- per-phase duration, action counts, warnings, errors, and state hashes;
- aggregate state deltas and invariant checks;
- turn failure and forced pause;
- recovery and runner restoration;
- checkpoint/AI-summary/diagnostic persistence success or degradation;
- replay frame/manifest load failure;
- strategy-provider latency/failure/fallback;
- future provider token/cost totals.

Use stable diagnostic codes in addition to human-readable messages. High-cardinality
identifiers belong in structured fields, not metric names.

Do not log or export credentials, database URLs, API keys, unrestricted
environment data, or unredacted future model secrets. Redacted verbose strategy
contexts are host/operator diagnostics and must not be included in ordinary
spectator broadcasts.

## Completion handoff

The implementation is complete when:

1. all acceptance criteria are automated or explicitly verified;
2. the full quality gate passes;
3. protocol and database migrations are documented;
4. `CLIENT_ARCHITECTURE.md` reflects simulation/replay session and store
   boundaries;
5. `AI_PORTING_INVENTORY.md` identifies simulation strategy providers as an
   extension, not a replacement for the native Freeciv AI baseline;
6. `PORT_STATUS.md` lists AI simulation and turn-level replay as supported
   player-visible features;
7. a person and a local AI coding agent can diagnose a recorded failure using
   only the documented replay/diagnostic interfaces and exported bundle;
8. no actual LLM provider is enabled.
