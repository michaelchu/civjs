import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { GameState, ClientState, GameTab, MapViewport } from '../types';
import type {
  Nation,
  NationSet,
  NationGroupDefinition,
  NationCustomization,
  PlayerNationInfo,
  DiplomaticRelation,
  EmbassyStatus,
  SharedVision,
  IntelligenceReport,
  DiplomaticState,
} from '../../../shared/src/types/nations';

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

  // Nation system data (matches freeciv-web nations[] structure)
  nations: Record<string, Nation>;
  nationSets: Record<string, NationSet>;
  nationGroups: Record<string, NationGroupDefinition>;

  // Nation selection state
  availableNations: string[];
  selectedNationId: string | null;
  nationCustomization: NationCustomization | null;

  // Diplomatic state (for Nations tab)
  playerNations: Record<string, PlayerNationInfo>;
  diplomaticRelations: Record<string, DiplomaticRelation[]>;
  embassyStatuses: Record<string, EmbassyStatus[]>;
  sharedVisionStatuses: Record<string, SharedVision[]>;
  intelligenceReports: Record<string, IntelligenceReport>;
  selectedPlayerId: string | null; // For Nations tab player selection

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

  // Nation system actions
  setNations: (nations: Record<string, Nation>) => void;
  setNationSets: (sets: Record<string, NationSet>) => void;
  setNationGroups: (groups: Record<string, NationGroupDefinition>) => void;
  setAvailableNations: (nationIds: string[]) => void;
  selectNation: (nationId: string | null) => void;
  setNationCustomization: (customization: NationCustomization | null) => void;

  // Diplomatic actions (for Nations tab)
  setPlayerNations: (playerNations: Record<string, PlayerNationInfo>) => void;
  updatePlayerNation: (playerId: string, info: Partial<PlayerNationInfo>) => void;
  setDiplomaticRelations: (playerId: string, relations: DiplomaticRelation[]) => void;
  setEmbassyStatuses: (playerId: string, statuses: EmbassyStatus[]) => void;
  setSharedVisionStatuses: (playerId: string, statuses: SharedVision[]) => void;
  setIntelligenceReport: (playerId: string, report: IntelligenceReport) => void;
  selectPlayer: (playerId: string | null) => void; // For Nations tab

  // Computed getters
  getCurrentPlayer: () => ReturnType<typeof getCurrentPlayer>;
  getSelectedUnit: () => ReturnType<typeof getSelectedUnit>;
  getSelectedCity: () => ReturnType<typeof getSelectedCity>;

  // Nation-related getters
  getSelectedNation: () => ReturnType<typeof getSelectedNation>;
  getSelectedPlayerInfo: () => ReturnType<typeof getSelectedPlayerInfo>;
  getAvailableNationsData: () => ReturnType<typeof getAvailableNationsData>;
  getPlayerDiplomaticState: (playerId: string) => ReturnType<typeof getPlayerDiplomaticState>;
  getPlayerEmbassyStatus: (playerId: string) => ReturnType<typeof getPlayerEmbassyStatus>;
  getPlayerSharedVisionStatus: (playerId: string) => ReturnType<typeof getPlayerSharedVisionStatus>;
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

// Nation-related helper functions
const getSelectedNation = (state: GameStore) => {
  return state.selectedNationId ? state.nations[state.selectedNationId] || null : null;
};

const getSelectedPlayerInfo = (state: GameStore) => {
  return state.selectedPlayerId ? state.playerNations[state.selectedPlayerId] || null : null;
};

const getAvailableNationsData = (state: GameStore) => {
  return state.availableNations
    .map(id => state.nations[id])
    .filter((nation): nation is Nation => nation !== undefined);
};

const getPlayerDiplomaticState = (state: GameStore, playerId: string): DiplomaticState | null => {
  const relations = state.diplomaticRelations[state.currentPlayerId];
  if (!relations) return null;

  const relation = relations.find(r => r.playerId === playerId);
  return relation?.state || null;
};

const getPlayerEmbassyStatus = (state: GameStore, playerId: string): EmbassyStatus | null => {
  const statuses = state.embassyStatuses[state.currentPlayerId];
  if (!statuses) return null;

  return statuses.find(s => s.playerId === playerId) || null;
};

const getPlayerSharedVisionStatus = (state: GameStore, playerId: string): SharedVision | null => {
  const statuses = state.sharedVisionStatuses[state.currentPlayerId];
  if (!statuses) return null;

  return statuses.find(s => s.playerId === playerId) || null;
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

    // Nation system initial state
    nations: {},
    nationSets: {},
    nationGroups: {},
    availableNations: [],
    selectedNationId: null,
    nationCustomization: null,

    // Diplomatic initial state
    playerNations: {},
    diplomaticRelations: {},
    embassyStatuses: {},
    sharedVisionStatuses: {},
    intelligenceReports: {},
    selectedPlayerId: null,

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

    // Nation system actions
    setNations: (nations: Record<string, Nation>) => {
      set({ nations });
    },

    setNationSets: (nationSets: Record<string, NationSet>) => {
      set({ nationSets });
    },

    setNationGroups: (nationGroups: Record<string, NationGroupDefinition>) => {
      set({ nationGroups });
    },

    setAvailableNations: (availableNations: string[]) => {
      set({ availableNations });
    },

    selectNation: (selectedNationId: string | null) => {
      set({ selectedNationId });
    },

    setNationCustomization: (nationCustomization: NationCustomization | null) => {
      set({ nationCustomization });
    },

    // Diplomatic actions
    setPlayerNations: (playerNations: Record<string, PlayerNationInfo>) => {
      set({ playerNations });
    },

    updatePlayerNation: (playerId: string, info: Partial<PlayerNationInfo>) => {
      set(state => ({
        playerNations: {
          ...state.playerNations,
          [playerId]: { ...state.playerNations[playerId], ...info },
        },
      }));
    },

    setDiplomaticRelations: (playerId: string, relations: DiplomaticRelation[]) => {
      set(state => ({
        diplomaticRelations: {
          ...state.diplomaticRelations,
          [playerId]: relations,
        },
      }));
    },

    setEmbassyStatuses: (playerId: string, statuses: EmbassyStatus[]) => {
      set(state => ({
        embassyStatuses: {
          ...state.embassyStatuses,
          [playerId]: statuses,
        },
      }));
    },

    setSharedVisionStatuses: (playerId: string, statuses: SharedVision[]) => {
      set(state => ({
        sharedVisionStatuses: {
          ...state.sharedVisionStatuses,
          [playerId]: statuses,
        },
      }));
    },

    setIntelligenceReport: (playerId: string, report: IntelligenceReport) => {
      set(state => ({
        intelligenceReports: {
          ...state.intelligenceReports,
          [playerId]: report,
        },
      }));
    },

    selectPlayer: (selectedPlayerId: string | null) => {
      set({ selectedPlayerId });
    },

    // Computed getters
    getCurrentPlayer: () => getCurrentPlayer(get()),
    getSelectedUnit: () => getSelectedUnit(get()),
    getSelectedCity: () => getSelectedCity(get()),

    // Nation-related getters
    getSelectedNation: () => getSelectedNation(get()),
    getSelectedPlayerInfo: () => getSelectedPlayerInfo(get()),
    getAvailableNationsData: () => getAvailableNationsData(get()),
    getPlayerDiplomaticState: (playerId: string) => getPlayerDiplomaticState(get(), playerId),
    getPlayerEmbassyStatus: (playerId: string) => getPlayerEmbassyStatus(get(), playerId),
    getPlayerSharedVisionStatus: (playerId: string) => getPlayerSharedVisionStatus(get(), playerId),
  }))
);
