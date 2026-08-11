# CivJS Port Status

**Supported ruleset:** Freeciv `civ2civ3` only.

**Parity target:** the checked-in `reference/freeciv/data/civ2civ3/` source
tree. See [C2C3 Parity Baseline](CIV2CIV3_PARITY_BASELINE.md) for the pinned
reference and differential-oracle setup.

**Reference revision audited:** Freeciv `main` at
`eb8c7033aa6a70dfcd4aee828c3ac1ba33092afc` (`3.3.90.14-dev`).

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

The strict C2C3 evidence certificate currently passes: all 62 enabled actions
(89 enablers), all 12 gameplay surfaces, all 3 active script hooks, and all 98
raw effect types meet its source-backed coverage requirements. Differential
fixtures use one native Freeciv server session as an oracle, so they remain
practical in CI. This remains short of a public complete whole-game parity
claim: the certificate validates required evidence shape, while native
fixtures and simplified default-AI behavior do not yet prove every semantic
branch or full turn-state sequence.

The current evidence classification, source mappings, and known limitations
are maintained in [C2C3 Parity Audit](CIV2CIV3_PARITY_AUDIT.md). The historical
pre-certificate assessment remains in [Test Evidence Audit](TEST_EVIDENCE_AUDIT.md).
Concrete implementation gaps belong in [Gameplay Gaps](GAMEPLAY_GAPS.md).
The current server-only comparison is tracked in
[Backend Gameplay Gap Analysis](BACKEND_GAMEPLAY_GAP_ANALYSIS.md).
The current browser rendering and interaction comparison is tracked in
[Frontend Parity Gap Analysis](FRONTEND_PARITY_GAP_ANALYSIS.md).

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

Use `npm run check:civ2civ3-oracle` in a configured native Freeciv environment
when changing a covered differential surface. The non-strict metadata audit
runs in CI; run `npm run certify:civ2civ3-parity` for the strict C2C3 evidence
certificate.
