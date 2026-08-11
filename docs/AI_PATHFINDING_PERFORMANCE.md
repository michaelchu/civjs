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
`heap-cache-optimized` mode uses the authoritative `PathfindingManager` and
planner reuse.

Observed locally on 2026-08-03 (one sample per mode):

| Mode                 |     Time | Route calls | Scoped cache hits |
| -------------------- | -------: | ----------: | ----------------: |
| Linear baseline      | 6,604 ms |         110 |                 0 |
| Heap/cache optimized | 3,127 ms |          80 |                10 |

This is an algorithm benchmark, not a replay of game
`dad1801e-4b9f-44d9-9d56-35a376b0ba64`; production turn diagnostics now record
per-player and per-decision timings so that workload-specific measurements can
be compared separately. A single run measured a 52.6% reduction in elapsed
time; results vary with local CPU/JIT load. Explorer breadth remains
`MAX_PATH_CANDIDATES = 48`; no candidate reduction was made.

The implementation follows the behavioral boundaries in
`reference/freeciv/common/aicore/path_finding.c:533-583` (priority-queue route
expansion), `reference/freeciv/ai/default/daimilitary.c:533-570` and
`1243-1267` (city danger and attacker valuation), and
`reference/freeciv/server/advisors/autoexplorer.c:163-265` (exploration
desirability). The reference tree remains read-only.
