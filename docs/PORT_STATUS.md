# CivJS Port Status

**Supported ruleset:** Freeciv `civ2civ3` only.

**Parity target:** the checked-in `reference/freeciv/data/civ2civ3/` source
tree. See [C2C3 Parity Baseline](CIV2CIV3_PARITY_BASELINE.md) for the pinned
reference and differential-oracle setup.

## Product scope

CivJS is a server-authoritative C2C3 game with a React/Canvas client. The
supported play surface includes game creation and recovery, map generation,
cities, units, combat, research, governments, diplomacy, AI, turn processing,
and end-game reporting.

Ruleset selection is intentionally not a product feature. A saved game whose
ruleset is not C2C3 is rejected rather than remapped. Generated runtime data,
API options, scenarios, fixtures, and ruleset-specific compatibility paths are
limited to C2C3.

## Evidence status

The runtime has broad functional coverage and source-mapped tests across the
core gameplay domains. Differential fixtures use one native Freeciv server
session as an oracle, so they remain practical in CI. This is not yet a claim
of complete whole-game parity: every surface still needs sufficient
source-backed normal, rejected, boundary, turn-state, and differential cases.

The current evidence classification and remaining proof gaps are maintained in
[Test Evidence Audit](TEST_EVIDENCE_AUDIT.md). Concrete implementation gaps
belong in [Gameplay Gaps](GAMEPLAY_GAPS.md).

## Intentional exclusions

- Supporting alternative Freeciv rulesets.
- Silently translating a saved game from another ruleset into C2C3.
- A line-for-line rewrite of the Freeciv C server.
- Mid-game civil-war player creation; CivJS retains a fixed lobby.

## Verification

Run the narrowest affected test while iterating. The standard handoff gate is:

```sh
npm run verify
npm run test:integration
npm run test:e2e
```

Use `npm run check:civ2civ3-oracle` when changing a covered differential
surface. The non-strict metadata audit runs in CI; the strict certificate
command remains intentionally blocked until the audit reports no missing
evidence.
