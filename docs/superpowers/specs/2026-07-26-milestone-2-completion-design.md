# Milestone 2 Completion Design

## Goal

Complete the finite Milestone 2 contract in `docs/PORTING_PLAYBOOK.md`: classic
ruleset data must drive the Milestone 1 playable loop, invalid or unsupported
definitions must fail validation, and representative tests must prove that
changing loaded data changes authoritative gameplay.

## Scope boundary

Milestone 2 includes:

- Units, buildings, technologies, governments, terrain, game parameters, and
  effects used by the Milestone 1 loop.
- Effect contexts used by authoritative city, unit, visibility, production,
  research, and movement paths.
- Cross-file ruleset integrity checks.
- Representative fixture parity and mutation tests.
- Removal of TypeScript constants that duplicate already-loaded classic data.

It does not include the complete upstream effect catalogue. Effects that depend
on unported systems remain inert and documented: diplomacy, unit retirement,
tile extras, worker improvements, capture/incite, trade-rate UI, and visible
wall rendering belong to later milestones.

## Architecture

`RulesetLoader` remains the only JSON parser and gains whole-ruleset integrity
validation after all files pass their individual Zod schemas. Runtime services
consume data through the existing ruleset services and a shared
`EffectsManager`. `EffectsManager` remains the sole requirement evaluator;
the unused duplicate evaluator in `RulesetLoader` is removed.

City calculations receive one complete effect context containing player,
government, technology, buildings, city coordinates, and output/specialist
properties. Corruption is computed once through `EffectsManager`, using the
nearest actual `Gov_Center`. Happiness uses ruleset martial-law and size
effects. Specialist output uses `Specialist_Output`.

Terrain movement, base yields, food cost, building upkeep/name, unit-class
flags, and veteran factors are loaded rather than copied into TypeScript.
Compatibility proxies may remain, but their values must originate in JSON.

## Validation

Individual schemas reject malformed values and unknown effect or requirement
types. Whole-ruleset validation rejects unresolved:

- unit required technologies and obsolete unit IDs;
- building required technologies and prerequisite buildings;
- effect references to technologies, buildings, units, and governments.

CivJS-only entities must be explicitly marked as extensions and remain
non-playable; otherwise classic catalogues must match the reference data.

## Evidence

Tests are divided into:

1. Static parity tests for representative entities and classic source values.
2. Runtime tests proving those values affect movement, combat, city output,
   happiness, production, and research.
3. Mutation tests using an isolated ruleset loader to prove a changed JSON
   value changes an authoritative result.
4. Validation tests covering all nine JSON families plus broken cross-file
   references and unsupported effect/requirement types.

Milestone 2 is complete only after formatting, lint, type checking, all unit
tests, and available integration tests pass, and the playbook/status documents
record exact evidence.

## Error handling

Missing runtime context continues to fail closed. Invalid rulesets fail during
loading with the entity and broken reference in the error. Authoritative
services do not silently fall back to classic constants when a ruleset cannot
load; initialization failure is preferable to running with mixed authorities.
