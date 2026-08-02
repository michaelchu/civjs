/**
 * @module client/store/gameStore
 * Defines game Store client state and actions.
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { GameState, ClientState, GameTab, MapViewport, ResearchState, Unit } from '../types';
import {
  findBestFocusCandidate,
  addUnitToFocus,
  removeUnitFromFocus,
  addToUrgentFocus,
  getVisuallyFocusedUnits,
  canFocusUnit,
} from '../utils/focusManagement';

export type TurnProcessingState = 'idle' | 'processing' | 'completed' | 'error';

export interface TurnProcessingStep {
  id: string;
  label: string;
  completed: boolean;
  active: boolean;
}

export interface GameNotification {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'error';
}

export interface ChatMessage {
  id: string;
  timestamp: number;
  sender: string;
  message: string;
  channel: 'all' | 'team' | 'private';
  recipient?: string;
}

interface GameStore extends GameState {
  // Client state
  clientState: ClientState;
  currentGameId: string | null;
  activeTab: GameTab;
  viewport: MapViewport;
  hasReceivedUnitSnapshot: boolean;
  // Legacy single selection (maintained for backward compatibility)
  selectedUnitId: string | null;
  selectedCityId: string | null;

  // Multi-unit focus system
  focusedUnits: string[];
  urgentFocusQueue: string[];
  lastFocusedUnit: string | null;

  // Turn processing state
  turnProcessingState: TurnProcessingState;
  turnProcessingSteps: TurnProcessingStep[];
  notifications: GameNotification[];
  chatMessages: ChatMessage[];

  // Actions
  setClientState: (state: ClientState) => void;
  setActiveTab: (tab: GameTab) => void;
  updateGameState: (partialState: Partial<GameState>) => void;
  setViewport: (viewport: Partial<MapViewport>) => void;
  selectUnit: (unitId: string | null) => void;
  selectUnits: (unitIds: string[]) => void;
  toggleUnits: (unitIds: string[]) => void;
  selectCity: (cityId: string | null) => void;

  // Multi-unit focus actions
  addToFocus: (unitId: string, multiSelect?: boolean) => void;
  removeFromFocus: (unitId: string) => void;
  clearFocus: () => void;
  advanceUnitFocus: (sameType?: boolean) => void;
  setUrgentFocus: (unitId: string) => void;
  acknowledgeUrgentFocus: (unitId?: string) => void;

  // Research actions
  updateResearchState: (researchState: Partial<ResearchState>) => void;
  setCurrentResearch: (techId: string | undefined) => void;
  setResearchGoal: (techId: string | undefined) => void;

  // Turn processing actions
  setTurnProcessingState: (state: TurnProcessingState) => void;
  updateTurnProcessingSteps: (steps: TurnProcessingStep[]) => void;
  startTurnProcessing: () => void;
  completeTurnProcessing: () => void;
  resetTurnProcessing: () => void;
  addNotification: (notification: Omit<GameNotification, 'id'>) => void;
  dismissNotification: (id: string) => void;
  addChatMessage: (message: Omit<ChatMessage, 'id'>) => void;

  // Government actions
  requestGovernmentChange: (governmentId: string) => void;
  startRevolution: (requestedGovernment: string) => void;

  // Computed getters
  getCurrentPlayer: () => ReturnType<typeof getCurrentPlayer>;
  getSelectedUnit: () => ReturnType<typeof getSelectedUnit>;
  getSelectedCity: () => ReturnType<typeof getSelectedCity>;
  getFocusedUnits: () => Unit[];
  getPrimaryFocusedUnit: () => Unit | null;
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

const getFocusedUnits = (state: GameStore): Unit[] => {
  return getVisuallyFocusedUnits(state.units, state.focusedUnits);
};

const getPrimaryFocusedUnit = (state: GameStore): Unit | null => {
  return state.focusedUnits.length > 0 ? state.units[state.focusedUnits[0]] || null : null;
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
    presentationEffects: [],
    cities: {},
    technologies: {},
    research: {
      bulbsAccumulated: 0,
      bulbsLastTurn: 0,
      researchedTechs: new Set(),
      availableTechs: new Set(),
      futureTechs: 0,
    },
    governments: {},
    endGameReport: undefined,

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
    hasReceivedUnitSnapshot: false,
    selectedUnitId: null,
    selectedCityId: null,

    // Multi-unit focus initial state
    focusedUnits: [],
    urgentFocusQueue: [],
    lastFocusedUnit: null,

    // Turn processing initial state
    turnProcessingState: 'idle',
    turnProcessingSteps: [],
    notifications: [],
    chatMessages: [],

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
      set(state => ({
        selectedUnitId: unitId,
        selectedCityId: unitId ? null : state.selectedCityId,
        // Sync with focus system for backward compatibility
        focusedUnits: unitId ? [unitId] : [],
      }));
    },

    selectUnits: (unitIds: string[]) => {
      const state = get();
      const validUnitIds = unitIds.filter(unitId =>
        canFocusUnit(state.units[unitId], state.currentPlayerId)
      );
      set({
        selectedUnitId: validUnitIds[0] ?? null,
        selectedCityId: null,
        focusedUnits: validUnitIds,
        lastFocusedUnit: state.focusedUnits[0] ?? null,
      });
    },

    toggleUnits: (unitIds: string[]) => {
      const state = get();
      const validUnitIds = unitIds.filter(unitId =>
        canFocusUnit(state.units[unitId], state.currentPlayerId)
      );
      if (validUnitIds.length === 0) return;

      const currentFocus = state.focusedUnits;
      const allSelected = validUnitIds.every(unitId => currentFocus.includes(unitId));
      const nextFocus = allSelected
        ? currentFocus.filter(unitId => !validUnitIds.includes(unitId))
        : [...currentFocus, ...validUnitIds.filter(unitId => !currentFocus.includes(unitId))];

      set({
        selectedUnitId: nextFocus[0] ?? null,
        selectedCityId: null,
        focusedUnits: nextFocus,
        lastFocusedUnit: currentFocus[0] ?? null,
      });
    },

    selectCity: (cityId: string | null) => {
      set(
        cityId
          ? {
              selectedCityId: cityId,
              selectedUnitId: null,
              focusedUnits: [],
            }
          : { selectedCityId: null }
      );
    },

    // Research actions
    updateResearchState: (researchState: Partial<ResearchState>) => {
      set(state => ({
        research: { ...state.research!, ...researchState },
      }));
    },

    setCurrentResearch: (techId: string | undefined) => {
      set(state => ({
        research: { ...state.research!, currentTech: techId },
      }));
    },

    setResearchGoal: (techId: string | undefined) => {
      set(state => ({
        research: { ...state.research!, techGoal: techId },
      }));
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

    addNotification: notification => {
      set(state => ({
        notifications: [
          ...state.notifications.slice(-3),
          {
            ...notification,
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          },
        ],
      }));
    },

    dismissNotification: id => {
      set(state => ({
        notifications: state.notifications.filter(notification => notification.id !== id),
      }));
    },

    addChatMessage: message => {
      set(state => ({
        chatMessages: [
          ...state.chatMessages.slice(-49),
          {
            ...message,
            id: `${message.timestamp}-${Math.random().toString(36).slice(2)}`,
          },
        ],
      }));
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

    // Multi-unit focus actions
    addToFocus: (unitId: string, multiSelect: boolean = false) => {
      const state = get();
      const unit = state.units[unitId];
      if (!canFocusUnit(unit, state.currentPlayerId)) return;

      const newFocus = addUnitToFocus(state.focusedUnits, unitId, multiSelect);
      set({
        focusedUnits: newFocus,
        selectedUnitId: newFocus[0] || null, // Keep legacy field synced
        lastFocusedUnit: state.focusedUnits.length > 0 ? state.focusedUnits[0] : null,
      });
    },

    removeFromFocus: (unitId: string) => {
      const state = get();
      const { focus, urgentQueue } = removeUnitFromFocus(
        state.focusedUnits,
        state.urgentFocusQueue,
        unitId
      );
      set({
        focusedUnits: focus,
        urgentFocusQueue: urgentQueue,
        selectedUnitId: focus[0] || null, // Keep legacy field synced
      });
    },

    clearFocus: () => {
      set({
        focusedUnits: [],
        selectedUnitId: null,
        lastFocusedUnit: get().focusedUnits[0] || null,
      });
    },

    advanceUnitFocus: (sameType: boolean = false) => {
      const state = get();
      const pendingUnits = Object.fromEntries(
        Object.entries(state.units).filter(
          ([, unit]) =>
            unit.playerId === state.currentPlayerId && unit.movesLeft > 0 && !unit.doneMoving
        )
      );
      const candidate = findBestFocusCandidate(
        pendingUnits,
        state.currentPlayerId,
        false,
        sameType,
        state.focusedUnits
      );

      if (candidate) {
        set({
          focusedUnits: [candidate.id],
          selectedUnitId: candidate.id,
          lastFocusedUnit: state.focusedUnits[0] || null,
        });
      } else {
        // No candidate found - clear focus
        get().clearFocus();
      }
    },

    setUrgentFocus: (unitId: string) => {
      set(state => ({
        urgentFocusQueue: addToUrgentFocus(state.urgentFocusQueue, unitId),
      }));
    },

    acknowledgeUrgentFocus: (unitId?: string) => {
      set(state => ({
        urgentFocusQueue: unitId
          ? state.urgentFocusQueue.filter(id => id !== unitId)
          : state.urgentFocusQueue.slice(1),
      }));
    },

    // Computed getters
    getCurrentPlayer: () => getCurrentPlayer(get()),
    getSelectedUnit: () => getSelectedUnit(get()),
    getSelectedCity: () => getSelectedCity(get()),
    getFocusedUnits: () => getFocusedUnits(get()),
    getPrimaryFocusedUnit: () => getPrimaryFocusedUnit(get()),
  }))
);
