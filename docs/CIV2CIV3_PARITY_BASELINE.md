# Civ2Civ3 Parity Baseline

The gameplay-parity target is Freeciv's `civ2civ3` ruleset, not the Classic
ruleset. This document pins the reference snapshot that source-backed tests
and generated data must use.

## Pinned reference

- **Reference path:** `reference/freeciv`
- **Freeciv version:** `3.3.90.5-dev` (`reference/freeciv/fc_version`)
- **Reference tree object:** `bb555d7fe91b147d4ec504cf933bcc372b7debc8`
  (`git rev-parse HEAD:reference/freeciv` when this baseline was recorded)
- **Upstream Freeciv commit:** `440b3c9650d3052792296868cb15591bd40612ea`
  (Freeciv `main`, 2025-08-28)
- **Default CivJS ruleset:** `civ2civ3`

The tree object identifies the exact checked-in Freeciv source used for this
baseline. It is a source pin, not a claim that CivJS has complete parity yet.

The bundled reference is intentionally source-only. A path-for-path comparison
against the upstream commit above found no differences in the bundled gameplay
paths (`ai/`, `common/`, `server/`, and `data/civ2civ3/`). Upstream-only asset
files are not part of the gameplay oracle. The pinned upstream commit can
therefore be built to run source-mapped differential scenarios without
silently switching to Classic rules.

## Executable baseline checks

`npm run check:civ2civ3-nations` parses the included c2c3 nation files and
compares the generated CivJS nation JSON with the source-derived result. The
runtime and API tests additionally verify that Freeciv's first nation set,
`core`, is the default, while `all` exposes the Extended roster.

`node tools/convert-rulesets.mjs civ2civ3 --check --diff` verifies the
source-derived projection for the 12 converted c2c3 ruleset files. Building
behavior remains in `effects.json` and technology costs are derived at runtime
from Freeciv's research formula; neither is duplicated as a static c2c3
catalogue adapter. The remaining client tech-tree position field is
presentation-only and is not gameplay evidence.

`npm run audit:civ2civ3-parity` is the executable certificate-readiness
report. It derives the enabled action set from c2c3 data, requires explicit
source-backed normal/rejected/boundary cases for each action, inventories raw
effect types without declared runtime handlers, and reports the adapter and
oracle surface. `npm run certify:civ2civ3-parity` is intentionally strict: it
must fail until the report has no blockers. It is not a normal CI check while
the port remains incomplete; CI runs the non-strict metadata check so action
annotations cannot silently drift from c2c3 source names.

The required gameplay domains and their evidence classes are versioned in
`docs/CIV2CIV3_PARITY_SURFACES.json`. Each domain needs source-mapped normal,
boundary, turn-state, and differential scenarios; action-specific cases also
need an explicit rejected outcome. This keeps a future certificate from being
based solely on a large count of narrow unit tests.

The secfile converter deliberately does not execute ruleset Lua. The
c2c3-local script creates Ruins and map labels, which its own ruleset data
marks as presentation-only; the inherited default script also governs gameplay
hooks for huts and partisans. Those hooks remain in scope for the relevant
action and gameplay-surface scenarios rather than being silently treated as
converted data. `docs/CIV2CIV3_PARITY_SCRIPT_HOOKS.json` inventories every
active signal connection and the audit rejects an unaccounted source hook.

When updating `reference/freeciv`, update this document's tree object and
Freeciv version, regenerate any affected converted data deliberately, and add
or update source-mapped parity scenarios before accepting the new baseline.

## Differential oracle

`tools/run-freeciv-oracle.mjs` runs deterministic fixtures against a local
build of the pinned upstream commit. It requires all three paths so an
arbitrary system Freeciv installation cannot supply misleading evidence:

```bash
FREECIV_ORACLE_SOURCE=/path/to/freeciv \
FREECIV_ORACLE_DATA=/path/to/freeciv/data \
FREECIV_ORACLE_BIN=/path/to/freeciv-server \
npm run check:civ2civ3-oracle
```

The runner checks the bundled reference tree, every bundled gameplay source
file, the upstream source commit, and the binary version before it runs. It
keeps saves in an isolated temporary directory and emits structured results.
CI invokes it once without a scenario filter, so every deterministic fixture
runs in one Freeciv server session. Jest then reads the resulting JSON bundle;
individual parity assertions never start their own native server process.
The fixture set creates a controlled city and ground defender, then confirms
that City Walls produce the reference `Defend_Bonus` of 150 (the normal city
50 plus City Walls 100). It also fixes a three-player state, performs the
c2c3 Diplomat `Establish Embassy Stay` action, confirms the resulting real
embassy, and verifies the Technology Leakage research cost it enables. This
is a working differential-test foundation, not a whole-game certificate; new
scenarios must cover the remaining action and turn-state matrices before a
parity claim is justified.

The turn-time `Have_Contacts` effect is separately source-mapped in
`DiplomacyManager.test.ts`. In c2c3, Marco Polo's Embassy grants that effect
to its owner (`data/civ2civ3/effects.ruleset:3399-3420`); Freeciv applies it
after player-phase processing (`server/srv_main.c:784-798`) through
`make_contact` (`server/plrhand.c:2305-2364`). CivJS evaluates the selected
game ruleset, grants contact only among living players, and refreshes the
contact duration on each diplomacy turn. This is runtime parity evidence, not
yet a native Freeciv differential fixture.
