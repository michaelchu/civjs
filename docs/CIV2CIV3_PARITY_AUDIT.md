# Civ2Civ3 Parity Audit

**Audit date:** 2026-08-11
**Scope:** The supported `civ2civ3` ruleset only.
**Reference commit:** `eb8c7033aa6a70dfcd4aee828c3ac1ba33092afc`
(`3.3.90.14-dev`)
**Status:** The mechanical C2C3 evidence certificate passes. It is ready for
human semantic review, not a claim that every Freeciv gameplay branch is
identical.

The reference source pin and native-oracle setup are recorded in
[C2C3 Parity Baseline](CIV2CIV3_PARITY_BASELINE.md). This audit supersedes the
historical counts in [Test Evidence Audit](TEST_EVIDENCE_AUDIT.md).

## Executable result

`npm run certify:civ2civ3-parity` converts the 12 C2C3 ruleset projections and
runs the strict evidence audit. Its 2026-08-11 result was:

| Check                          | Result                                                                      |
| ------------------------------ | --------------------------------------------------------------------------- |
| Enabled action matrix          | 62/62 actions complete, covering 89 enablers                                |
| Gameplay-surface matrix        | 12/12 surfaces have normal, boundary, turn-state, and differential evidence |
| Active ruleset script hooks    | 3/3 source-backed                                                           |
| Raw C2C3 effect types          | 98/98 have declared runtime handlers                                        |
| Static compatibility adapters  | 0 building-effect and 0 research-cost adapters                              |
| Pinned native-oracle scenarios | 16 deterministic fixtures                                                   |

The certificate checks the source mapping, required scenario shape, generated
ruleset projection, and declared effect-handler coverage. It does not prove
semantic equivalence merely because a test has a valid annotation.

## Source-backed work included in this audit

| Runtime behavior                    | CivJS implementation                                                                                                                                                                  | Freeciv reference                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Fanatic unit upkeep                 | `Fanatics` effects exempt units carrying the `Fanatic` flag from upkeep.                                                                                                              | `common/unittype.c:152-156`; `data/civ2civ3/effects.ruleset:1679-1688`                                            |
| Conquest technology                 | `Conquest_Tech_Pct` resolves against prerequisite-valid victim technologies without rolling back a successful capture.                                                                | `server/citytools.c:2126-2129`; `server/techtools.c:1236-1332`                                                    |
| City illness and recovery           | `Health_Pct` affects city health; damaged units recover only after a stationary turn.                                                                                                 | `common/city.c:2922-2990`; `common/unit.c:2233-2275`; `server/unittools.c:636-654`                                |
| AI diplomacy goodwill               | `Gain_AI_Love` is applied by the C2C3 diplomacy controller.                                                                                                                           | `ai/default/daidiplomacy.c:1112-1119`                                                                             |
| Border tile claims                  | `Tile_Claimable`, tile relation, range, and region requirements participate in border claims.                                                                                         | `server/maphand.c:2088-2104`; `data/civ2civ3/effects.ruleset:4637-4663`                                           |
| Move-state and damage-slow recovery | `movedThisTurn` is persisted through movement, combat, transport actions, reload, and turn reset; combat also recalculates and persists health-dependent movement for both survivors. | `common/movement.c:49-95`; `common/unit.c:2233-2275`; `server/unithand.c:5090-5105`; `server/unittools.c:636-654` |

The native oracle now also includes a C2C3 map-topology fixture for the
wrapped ISO-hex first-ring neighbor set. That is a topology comparison, not a
claim of identical seeded terrain or resource distributions.

## Limits and known deviations

The passing certificate must not be presented as public whole-game parity for
these reasons:

1. The matrices prove that every listed action and surface has source-backed
   scenarios of the required classes. They do not exhaustively compare every
   branch, random sequence, packet, or full turn-state transition with
   Freeciv.
2. The 16 native fixtures are a sampled oracle corpus. Running them requires a
   pinned Freeciv server binary and data tree; CI or another configured native
   environment must execute `npm run check:civ2civ3-oracle` separately.
3. The default-AI controllers intentionally use smaller TypeScript heuristics
   than Freeciv's default AI. Their behavior is not an exact decision-for-
   decision port; see [AI Porting Inventory](AI_PORTING_INVENTORY.md).
4. `ResearchManager.grantTechnology()` deliberately does not grant
   `future_tech`, so a conquest cannot award it. C2C3's default
   `Conquest_Tech_Pct` is zero, so this is unreachable in default baseline
   play unless that effect is changed.
5. Existing saved units receive `movedThisTurn = false` when migration 0028 is
   first applied. If an old save is resumed mid-turn, a previously moved,
   damaged unit can receive one recovery tick; subsequent moves and reloads
   persist the state correctly.
6. Non-C2C3 rulesets are intentionally out of scope and rejected rather than
   translated. This is a product boundary, not evidence of C2C3 behavior.

## Review and maintenance

Use the strict certificate for C2C3 coverage changes:

```sh
npm run certify:civ2civ3-parity
```

Run the native oracle after configuring the pinned Freeciv paths described in
the baseline document. When a C2C3 source revision changes, update the source
pin, regenerate affected projections, re-run the certificate and native
fixtures, and reassess the limitations above before making a stronger parity
claim.
