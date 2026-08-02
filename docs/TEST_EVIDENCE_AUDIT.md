# Test Evidence Audit

## Verdict

**No — the current suite is not sufficient to claim that CivJS gameplay is
fully in parity with the Freeciv reference.**

This is a completed classification audit of every supported gameplay surface
listed in [PORT_STATUS.md](PORT_STATUS.md). It classifies the strength of the
existing evidence; it does not mistake broad feature coverage, source comments,
or line coverage for a parity certificate.

The current checked snapshot is:

| Measure                                    | Result                                                             |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Test files scanned by the evidence checker | 239                                                                |
| Explicit source-mapped parity cases        | 28                                                                 |
| Explicit CivJS stack-contract cases        | 7                                                                  |
| Raw source-reference lines                 | 147 across 36 test files                                           |
| Server unit suite                          | 160 suites, 1,605 tests passing                                    |
| Server unit coverage                       | 67.77% statements, 58.61% branches, 67.95% functions, 69.10% lines |

The coverage command excludes database-backed integration suites. These
numbers show useful general regression coverage, but neither measure is a
measure of behavioral equivalence.

## What the labels mean

- **Parity evidence** is a test-local declaration with an exact Freeciv or
  freeciv-web source range and an assertion that names the shared observable
  rule.
- **Stack evidence** is a test-local declaration of a CivJS responsibility:
  persistence, authoritative state, Socket.IO, packet ordering, recovery, or
  client state.
- **Functional-only evidence** is a valuable CivJS regression test whose
  behavior has not been source-mapped closely enough to claim parity.

[tools/check-test-evidence.mjs](../tools/check-test-evidence.mjs) validates
the declaration shape, source paths, source line ranges, and immediate test
placement through npm run check:test-evidence. It cannot determine whether a
scenario is semantically equivalent; that review is recorded here.

Raw @reference comments do not count as parity evidence. They may be
file-level research notes, setup comments, broad paths without a line range,
or a source citation that does not cover the test's actual assertion.

## Complete gameplay-surface classification

| Gameplay surface                                                       | Direct parity evidence reviewed                                                                                                          | Functional or stack evidence reviewed                                                                                 | Audit decision                                                                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ruleset data and requirements                                          | The c2c3 converter checks 12 generated ruleset files; nation, resource visibility, city founding, raw building effects, and runtime technology costs have direct cases. | Catalogue, mutation, schema, and requirement tests are extensive.                                                     | **Partial.** Static building-effect and research-cost adapters have been removed; remaining raw effect handlers and system behavior still require parity work.           |
| Map generation, terrain, resources, and topology                       | Terrain movement cost is source-mapped.                                                                                                  | Map-generation, topology, smoothing, validation, and scenario tests cover CivJS behavior.                             | **Insufficient.** No deterministic Freeciv-versus-CivJS map-output corpus or distribution comparison exists.                                               |
| Visibility, borders, movement, and pathing                             | Terrain fragment conversion is source-mapped.                                                                                            | Unit, pathfinding, visibility, border, and client feedback tests cover many outcomes.                                 | **Partial.** Important foreign-border and movement regressions are covered, but the complete Freeciv movement/restriction matrix is not source-certified.  |
| Units, transport, combat, and action execution                         | City Walls, representative unit flags, and all three Found City scenario classes are source-mapped.                                      | UnitManager, action, production-validation, and integration tests cover many actions and recent regression fixes.     | **Partial.** c2c3 has 89 enablers across 62 actions; the executable matrix currently completes Found City only.                                            |
| City founding, capture, growth, production, and worklists              | Conquest population/improvement handling is source-mapped.                                                                               | Founding, growth, production lifecycle, rally, name, and recovery tests cover CivJS execution.                        | **Partial.** Production, founding, and worklist rules retain functional tests but lack a complete source-mapped scenario set.                              |
| City yields, corruption, happiness, specialists, and trade             | Government-center corruption, base happiness, classic effect values, and trade multipliers are source-mapped.                            | Output pipeline, tile management, specialists, and ruleset-mutation tests are broad.                                  | **Partial.** The source-mapped cases are representative rather than a complete city-output oracle.                                                         |
| Research, government, and domestic economy                             | Science aggregation, research switching, revolution length, tax-rate validity, and celebration majority are source-mapped.               | Economic lifecycle, government manager, research pacing, and AI orchestration tests cover CivJS state flow.           | **Partial.** The AI government and technology-want planners use simplified CivJS heuristics, so their current tests are not exact Freeciv AI parity proof. |
| Diplomacy and covert actions                                           | The default-AI treaty ladder is source-mapped.                                                                                           | Diplomacy manager, handlers, espionage, and client UI tests cover supported behavior.                                 | **Partial.** Treaty valuation, incident memory, all covert action odds, and client interactions do not have a complete source-parity matrix.               |
| Workers, automation, barbarians, disasters, climate, and random events | No explicit source-mapped test-local parity declaration currently covers these systems.                                                  | Worker automation, barbarian, random-event, disaster, climate, and simulation tests exercise CivJS behavior.          | **Functional-only.** This is a major parity gap despite substantial regression coverage.                                                                   |
| Scoring, victory, end game, and spaceship                              | Score weights, integer truncation, spaceship score, future technology weighting, and interrupted team ranking are source-mapped.         | End-game persistence, launch, recovery, and report tests cover CivJS execution.                                       | **Partial.** The selected formulas are protected, but victory and spaceship behavior still lack a complete differential scenario suite.                    |
| Default AI                                                             | Treasury invariants and treaty-state boundaries are source-mapped.                                                                       | Every planner and orchestrator has focused regression tests and persistent decision tests.                            | **Insufficient for exact AI parity.** Most planners deliberately use smaller TypeScript heuristics than the Freeciv default-AI algorithms.                 |
| Persistence, Socket.IO, and client state                               | These are CivJS architecture, not Freeciv gameplay rules.                                                                                | Database recovery, two-client Socket.IO flow, packet envelopes, and batched map recovery are explicitly stack-tested. | **Stack-covered, not parity evidence.**                                                                                                                    |
| Browser rendering, controls, and freeciv-web behavior                  | No explicit freeciv-web parity declaration exists.                                                                                       | Canvas, HUD, transport, store, and interaction tests are broad.                                                       | **Functional-only.** Client compatibility has no source-backed parity certification.                                                                       |
| Ruleset baseline selection                                             | The exact c2c3 source tree and matching upstream Freeciv build are pinned; Core/Extended nation behavior is source-mapped.               | Civ2Civ3 runtime and validation tests exist.                                                                          | **Partial.** The default target is now correctly pinned, but most gameplay evidence still targets Classic or CivJS-only behavior.                          |

No row is certified as complete reference parity. The phrase “full parity” is
therefore not justified for the supported game as a whole.

## Explicit parity ledger

The nineteen declarations added or reviewed in this audit are deliberately
narrow. They protect real reference rules without implying that their enclosing
subsystem is complete.

| Area                    | Cases | Rules protected                                                                                                             |
| ----------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------- |
| AI domestic economy     |     3 | Strict celebration majority; valid tax, luxury, and science rates totaling 100.                                             |
| AI diplomacy            |     1 | Ceasefire, peace, and alliance treaty-state ladder.                                                                         |
| Movement                |     1 | Terrain move costs convert once into Freeciv movement fragments.                                                            |
| Research and government |     3 | City science aggregation, target-switch penalty, and random revolution length.                                              |
| Cities and trade        |     5 | City capture outcome, government-center distance/waste, base happiness, trade multiplier, and converted city effect values. |
| Units and combat        |     2 | Unit-class flags and City Walls integer defense multiplier.                                                                 |
| Score and ranking       |     4 | Score categories/truncation, spaceship score, future technology weighting, and interrupted team ranking.                    |

The corresponding test-local declarations name the exact source ranges, so a
reference revision or a future behavioral change can be reviewed at the test
that makes the claim.

## Explicit stack ledger

The seven stack cases protect functionality that the C reference cannot
directly specify:

1. Scenario-owned AI economic-rate locks.
2. Persisted AI treasury planning and authorized rush lifecycle.
3. Authoritative multiplayer turn processing and recovery through PostgreSQL.
4. Two-client Socket.IO creation, map delivery, turn advance, and reconnect.
5. Durable map deserialization into the server runtime.
6. Versioned client visibility request envelopes.
7. Client map publication only after the final recovery batch.

These tests are essential, but they answer “does the CivJS stack work?” rather
than “does Freeciv produce the same gameplay outcome?”

## Material audit findings

1. **The default ruleset is now pinned, but the evidence has not caught up.**
   New games use civ2civ3 and the matching upstream Freeciv commit is recorded
   in CIV2CIV3_PARITY_BASELINE.md. A significant share of direct assertions
   still points to classic, which cannot certify a c2civ3 rule that differs in
   data or settings.
2. **The default AI is not exact by construction.** For example,
   AIGovernmentPlanner and AITechnologyWantPlanner cite Freeciv decision
   functions but use different, intentionally smaller scoring models. Their
   tests are functional regression evidence, not exact decision parity.
3. **The executable differential harness is only a foundation.** It now starts
   the pinned Freeciv server and confirms one controlled City Walls result, but
   it does not yet compare deterministic action sequences and turn state across
   the gameplay domains.
4. **Reference comments were previously over-countable.** Before this audit,
   90 raw @reference comments in 26 files were research leads, not reviewed
   parity declarations. The current 147 source-reference lines in 36 test
   files include the new explicit declarations; only 28 checked cases qualify.
5. **The strongest non-parity evidence is still incomplete.** Global server
   unit coverage is below 70 percent, and coverage cannot expose a
   source-behavior mismatch in the lines it does execute.
6. **Client compatibility has no direct Freeciv-web proof.** Current client
   tests protect CivJS behavior and protocol contracts, but no test asserts a
   freeciv-web source rule or rendering/control invariant.
7. **Resolved gameplay-gap entries are regression records, not certificates.**
   The 33 numbered entries in GAMEPLAY_GAPS.md informed this audit, but a
   resolved entry proves its reported symptom is covered, not that the entire
   surrounding Freeciv subsystem is equivalent.
8. **The remaining gaps are now mechanically visible.**
   `npm run audit:civ2civ3-parity` derives the c2c3 action matrix and effect
   inventory from the checked-in ruleset. It currently reports incomplete
   action scenarios and raw effects without declared runtime handlers. The strict
   certificate command remains red until those categories are resolved.
9. **Ruleset scripts are a separate source surface.** The c2c3-local
   `script.lua` only creates visual Ruins and map labels; the inherited
   `default/default.lua` also controls huts, partisans, and notifications.
   The converter does not execute Lua, so the gameplay callbacks must be
   covered in their corresponding action and gameplay-surface scenarios.

## Standard required for a parity certificate

Do not restore a repository-wide full-parity claim until all of the following
are true for the selected civ2civ3 baseline:

1. A generated or golden-data check compares every consumed ruleset entity,
   effect, and active gameplay script against the checked-in Freeciv source,
   with an intentional-difference allowlist.
2. Every enabled action has source-mapped normal, rejected, and boundary
   scenarios. The action inventory alone proves only that names are accounted
   for, not that their rules match.
3. Every domain in CIV2CIV3_PARITY_SURFACES.json has source-mapped normal,
   boundary, turn-state, and differential scenarios.
4. A deterministic differential harness runs the same seed, ruleset, save or
   setup, and action sequence against Freeciv and CivJS, then compares
   authoritative observable state after each turn.
5. Default-AI parity is assessed separately with deterministic decision traces
   and outcome scenarios. If CivJS retains simplified heuristics, document it
   as an intentional compatibility limitation rather than calling it exact
   parity.
6. Freeciv-web client claims have source-mapped control/rendering assertions,
   while CivJS-only transport and state behavior remains tagged as stack
   evidence.

Until then, use “implemented feature coverage with partial source-backed parity
evidence,” not “fully in parity with reference.”

## Maintenance rule

When adding a test that claims Freeciv or freeciv-web compatibility, add an
explicit parity declaration immediately before that test. When adding a
CivJS-specific persistence, transport, simulation, or client contract, add a
stack declaration. Update this audit table when a gameplay surface gains
enough evidence to change classification.
