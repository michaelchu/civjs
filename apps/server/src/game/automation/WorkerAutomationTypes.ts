import { ActionType } from '@app-types/shared/actions';

export type UnitAutomationMode = 'explore' | 'worker';

export interface WorkerAutomationTask {
  action: ActionType;
  targetX: number;
  targetY: number;
  assignedTurn: number;
  requestCityId?: string;
}

const WORKER_AUTOMATION_ACTIONS = new Set<ActionType>([
  ActionType.BUILD_ROAD,
  ActionType.BUILD_RAILROAD,
  ActionType.BUILD_IRRIGATION,
  ActionType.BUILD_MINE,
  ActionType.CULTIVATE,
  ActionType.PLANT,
  ActionType.TRANSFORM_TERRAIN,
  ActionType.CLEAN_POLLUTION,
]);

export function isWorkerAutomationTask(value: unknown): value is WorkerAutomationTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const task = value as Partial<WorkerAutomationTask>;
  return (
    typeof task.action === 'string' &&
    WORKER_AUTOMATION_ACTIONS.has(task.action as ActionType) &&
    Number.isInteger(task.targetX) &&
    Number.isInteger(task.targetY) &&
    Number.isInteger(task.assignedTurn) &&
    (task.requestCityId === undefined || typeof task.requestCityId === 'string')
  );
}
