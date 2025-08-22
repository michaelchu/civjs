export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export enum GameStatus {
  WAITING = 'waiting',
  STARTING = 'starting',
  RUNNING = 'running',
  PAUSED = 'paused',
  ENDED = 'ended',
}

export enum TurnPhase {
  MOVEMENT = 'movement',
  COMBAT = 'combat',
  PRODUCTION = 'production',
  END = 'end',
}

export interface PlayerColor {
  r: number;
  g: number;
  b: number;
}
