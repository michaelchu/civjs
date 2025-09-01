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

  // Government actions
  requestGovernmentChange: (governmentId: string) => void;
  startRevolution: (requestedGovernment: string) => void;

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
    governments: {},

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
      // Initialize processing state - server will drive the actual step updates
      set({
        turnProcessingState: 'processing',
        turnProcessingSteps: [], // Will be populated by server packets
      });
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

    // Government actions
    requestGovernmentChange: (governmentId: string) => {
      // This would send a packet to server
      // For now, just a placeholder - actual networking will be handled elsewhere
      console.log('Requesting government change to:', governmentId);
    },

    startRevolution: (requestedGovernment: string) => {
      // This would send a revolution packet to server
      // For now, just a placeholder - actual networking will be handled elsewhere
      console.log('Starting revolution to:', requestedGovernment);
    },

    // Computed getters
    getCurrentPlayer: () => getCurrentPlayer(get()),
    getSelectedUnit: () => getSelectedUnit(get()),
    getSelectedCity: () => getSelectedCity(get()),
  }))
);
