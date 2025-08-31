import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { GameState, ClientState, GameTab, MapViewport } from '../types';

export type TurnProcessingState = 'idle' | 'processing' | 'completed' | 'error';

export interface TurnProcessingStep {
  id: string;
  label: string;
  completed: boolean;
  active: boolean;
}

interface GameStore extends GameState {
  // Client state
  clientState: ClientState;
  currentGameId: string | null;
  activeTab: GameTab;
  viewport: MapViewport;
  selectedUnitId: string | null;
  selectedCityId: string | null;

  // Turn processing state
  turnProcessingState: TurnProcessingState;
  turnProcessingSteps: TurnProcessingStep[];

  // Actions
  setClientState: (state: ClientState) => void;
  setActiveTab: (tab: GameTab) => void;
  updateGameState: (partialState: Partial<GameState>) => void;
  setViewport: (viewport: Partial<MapViewport>) => void;
  selectUnit: (unitId: string | null) => void;
  selectCity: (cityId: string | null) => void;

  // Turn processing actions
  setTurnProcessingState: (state: TurnProcessingState) => void;
  updateTurnProcessingSteps: (steps: TurnProcessingStep[]) => void;
  startTurnProcessing: () => void;
  completeTurnProcessing: () => void;
  resetTurnProcessing: () => void;

  // Computed getters
  getCurrentPlayer: () => ReturnType<typeof getCurrentPlayer>;
  getSelectedUnit: () => ReturnType<typeof getSelectedUnit>;
  getSelectedCity: () => ReturnType<typeof getSelectedCity>;
}

// Helper functions for computed values
const getCurrentPlayer = (state: GameStore) => {
  return state.players[state.currentPlayerId] || null;
};

const getSelectedUnit = (state: GameStore) => {
  return state.selectedUnitId ? state.units[state.selectedUnitId] || null : null;
};

const getSelectedCity = (state: GameStore) => {
  return state.selectedCityId ? state.cities[state.selectedCityId] || null : null;
};

export const useGameStore = create<GameStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial game state
    turn: 0,
    phase: 'movement',
    players: {},
    currentPlayerId: '',
    map: {
      width: 0,
      height: 0,
      tiles: {},
    },
    units: {},
    cities: {},
    technologies: {},

    // Initial client state
    clientState: 'initial',
    currentGameId: null,
    activeTab: 'map',
    viewport: {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    },
    selectedUnitId: null,
    selectedCityId: null,

    // Turn processing initial state
    turnProcessingState: 'idle',
    turnProcessingSteps: [],

    // Actions
    setClientState: (state: ClientState) => {
      set({ clientState: state });
    },

    setActiveTab: (tab: GameTab) => {
      set({ activeTab: tab });
    },

    updateGameState: (partialState: Partial<GameState>) => {
      set(partialState);
    },

    setViewport: (viewport: Partial<MapViewport>) => {
      set(state => ({
        viewport: { ...state.viewport, ...viewport },
      }));
    },

    selectUnit: (unitId: string | null) => {
      set({ selectedUnitId: unitId });
    },

    selectCity: (cityId: string | null) => {
      set({ selectedCityId: cityId });
    },

    // Turn processing actions
    setTurnProcessingState: (state: TurnProcessingState) => {
      set({ turnProcessingState: state });
    },

    updateTurnProcessingSteps: (steps: TurnProcessingStep[]) => {
      set({ turnProcessingSteps: steps });
    },

    startTurnProcessing: () => {
      const initialSteps: TurnProcessingStep[] = [
        { id: 'validate', label: 'Validating turn actions', completed: false, active: true },
        { id: 'units', label: 'Processing unit movements', completed: false, active: false },
        { id: 'cities', label: 'Processing city production', completed: false, active: false },
        { id: 'research', label: 'Calculating research progress', completed: false, active: false },
        { id: 'events', label: 'Processing random events', completed: false, active: false },
        { id: 'advance', label: 'Advancing to next turn', completed: false, active: false },
      ];

      set({
        turnProcessingState: 'processing',
        turnProcessingSteps: initialSteps,
      });

      // Simulate turn processing steps with delays
      const get = useGameStore.getState;
      setTimeout(() => {
        const steps = get().turnProcessingSteps.map((step, i) =>
          i === 0
            ? { ...step, completed: true, active: false }
            : i === 1
              ? { ...step, active: true }
              : step
        );
        get().updateTurnProcessingSteps(steps);
      }, 300);

      setTimeout(() => {
        const steps = get().turnProcessingSteps.map((step, i) =>
          i <= 1
            ? { ...step, completed: true, active: false }
            : i === 2
              ? { ...step, active: true }
              : step
        );
        get().updateTurnProcessingSteps(steps);
      }, 600);

      setTimeout(() => {
        const steps = get().turnProcessingSteps.map((step, i) =>
          i <= 2
            ? { ...step, completed: true, active: false }
            : i === 3
              ? { ...step, active: true }
              : step
        );
        get().updateTurnProcessingSteps(steps);
      }, 900);

      setTimeout(() => {
        const steps = get().turnProcessingSteps.map((step, i) =>
          i <= 3
            ? { ...step, completed: true, active: false }
            : i === 4
              ? { ...step, active: true }
              : step
        );
        get().updateTurnProcessingSteps(steps);
      }, 1200);

      setTimeout(() => {
        const steps = get().turnProcessingSteps.map((step, i) =>
          i <= 4
            ? { ...step, completed: true, active: false }
            : i === 5
              ? { ...step, active: true }
              : step
        );
        get().updateTurnProcessingSteps(steps);
      }, 1500);

      setTimeout(() => {
        get().completeTurnProcessing();
      }, 1800);
    },

    completeTurnProcessing: () => {
      const allCompleted = get().turnProcessingSteps.map(step => ({
        ...step,
        completed: true,
        active: false,
      }));

      set({
        turnProcessingState: 'completed',
        turnProcessingSteps: allCompleted,
      });

      // Auto-hide after 2 seconds
      setTimeout(() => {
        get().resetTurnProcessing();
      }, 2000);
    },

    resetTurnProcessing: () => {
      set({
        turnProcessingState: 'idle',
        turnProcessingSteps: [],
      });
    },

    // Computed getters
    getCurrentPlayer: () => getCurrentPlayer(get()),
    getSelectedUnit: () => getSelectedUnit(get()),
    getSelectedCity: () => getSelectedCity(get()),
  }))
);
