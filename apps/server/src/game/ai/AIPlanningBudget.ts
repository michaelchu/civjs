/**
 * @module server/game/ai/AIPlanningBudget
 * Bounds synchronous AI planning work without relying on asynchronous
 * cancellation. The pathfinder consumes the search portions of this budget;
 * planners consume the broader planning-step portion around candidate work.
 */
import type { PathfindingBudget } from '@game/managers/PathfindingManager';

export interface AIPlanningBudgetOptions {
  maxPlanningMs?: number;
  maxPathQueries?: number;
  maxSearchNodes?: number;
  maxPlanningSteps?: number;
}

export interface AIPlanningBudgetSnapshot {
  elapsedMs: number;
  maxPlanningMs: number;
  pathQueries: number;
  maxPathQueries: number;
  searchNodes: number;
  maxSearchNodes: number;
  planningSteps: number;
  maxPlanningSteps: number;
  exhausted: boolean;
}

export interface AIPlanningBudgetLike {
  consumePlanningStep(): boolean;
}

export const DEFAULT_AI_PLANNING_BUDGET: Required<AIPlanningBudgetOptions> = {
  maxPlanningMs: 10_000,
  maxPathQueries: 2_048,
  maxSearchNodes: 750_000,
  maxPlanningSteps: 100_000,
};

/**
 * A cooperative budget for synchronous AI work. A budget check is deliberately
 * performed inside the path search and planner loops; Promise.race cannot
 * interrupt JavaScript that is already executing on the server's event loop.
 */
export class AIPlanningBudget implements PathfindingBudget, AIPlanningBudgetLike {
  private readonly startedAt = Date.now();
  private readonly limits: Required<AIPlanningBudgetOptions>;
  private pathQueries = 0;
  private searchNodes = 0;
  private planningSteps = 0;

  constructor(options: AIPlanningBudgetOptions = {}) {
    this.limits = { ...DEFAULT_AI_PLANNING_BUDGET, ...options };
  }

  canStartSearch(): boolean {
    if (this.isExhausted()) return false;
    if (this.pathQueries >= this.limits.maxPathQueries) return false;
    this.pathQueries++;
    return true;
  }

  consumeSearchNode(): boolean {
    if (this.isExhausted()) return false;
    if (this.searchNodes >= this.limits.maxSearchNodes) return false;
    this.searchNodes++;
    return true;
  }

  consumePlanningStep(): boolean {
    if (this.isExhausted()) return false;
    if (this.planningSteps >= this.limits.maxPlanningSteps) return false;
    this.planningSteps++;
    return true;
  }

  isExhausted(): boolean {
    return (
      Date.now() - this.startedAt >= this.limits.maxPlanningMs ||
      this.pathQueries >= this.limits.maxPathQueries ||
      this.searchNodes >= this.limits.maxSearchNodes ||
      this.planningSteps >= this.limits.maxPlanningSteps
    );
  }

  snapshot(): AIPlanningBudgetSnapshot {
    return {
      elapsedMs: Date.now() - this.startedAt,
      maxPlanningMs: this.limits.maxPlanningMs,
      pathQueries: this.pathQueries,
      maxPathQueries: this.limits.maxPathQueries,
      searchNodes: this.searchNodes,
      maxSearchNodes: this.limits.maxSearchNodes,
      planningSteps: this.planningSteps,
      maxPlanningSteps: this.limits.maxPlanningSteps,
      exhausted: this.isExhausted(),
    };
  }
}
