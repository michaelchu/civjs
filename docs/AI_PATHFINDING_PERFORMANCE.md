# AI pathfinding performance

The source comparison in this document uses Freeciv `main` at
`eb8c7033aa6a70dfcd4aee828c3ac1ba33092afc` (`3.3.90.14-dev`).

The focused benchmark is available as:

```bash
npm run benchmark:ai-pathfinding
```

It uses a deterministic 32x64 map, five AI players, clustered military
objectives, and repeated city-danger routes. The `linear-baseline` mode models
the former array open set and duplicate target-neighbor/city searches; the
`lattice-route-map-optimized` mode uses the authoritative `PathfindingManager`,
a compact tile-indexed lattice, and one reusable route map per unit/objective
set. Manager construction is outside the timer because topology indexes are
built once when a game is initialized rather than during each AI turn.

Observed locally on 2026-08-13 (median of three samples per mode):

| Mode                        |     Time | Route requests | Searches | Expanded nodes | Cache hits |
| --------------------------- | -------: | -------------: | -------: | -------------: | ---------: |
| Linear baseline             | 2,060 ms |            110 |      110 |              - |          0 |
| Lattice/route-map optimized |  10.6 ms |             80 |       15 |         13,382 |         10 |

This is an algorithm benchmark, not a replay of game
`dad1801e-4b9f-44d9-9d56-35a376b0ba64`; production turn diagnostics now record
per-player and per-decision timings so that workload-specific measurements can
be compared separately. The current synthetic workload is about 195 times
faster than the linear/duplicate-search baseline; results vary with local
CPU/JIT load and this ratio must not be treated as a production-turn speedup.
Production searches also snapshot indexed unit occupancy, city occupancy, and
enemy ZOC once per route-map scope instead of rescanning global collections per
edge. Explorer breadth remains `MAX_PATH_CANDIDATES = 48`; no candidate or AI
behavior reduction was made.

The implementation follows the behavioral boundaries in
`reference/freeciv/common/aicore/path_finding.c:205-234,533-583` (compact
lattice and indexed priority-queue route expansion),
`reference/freeciv/ai/default/daimilitary.c:533-570,1243-1267` (reusable maps
for city danger and attacker valuation), and
`reference/freeciv/server/advisors/autoexplorer.c:163-265` (exploration
desirability). The reference tree remains read-only.
