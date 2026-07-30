import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { MapCanvas } from '../Canvas2D/MapCanvas';
import { GameTabs } from './GameTabs';
import { StatusPanel } from './StatusPanel';
// import { ChatBox } from './ChatBox'; // Commented out while ChatBox is disabled
import { TurnDoneButton } from './TurnDoneButton';
import { GameMenu } from './GameMenu';
import { TechnologyTree } from '../Research/TechnologyTree';
import { GovernmentPanel } from './GovernmentPanel';
import { CitiesPanel } from './CitiesPanel';
import { GameOptionsPanel } from './GameOptionsPanel';
import { NotificationFeed } from './NotificationFeed';
import { NationsPanel } from './NationsPanel';
import { useKeyboardControls } from '../../hooks/useKeyboardControls';
import { EndGamePanel } from './EndGamePanel';
import { rulesetService } from '../../services/RulesetService';
import { resolveMusicStyle } from '../../services/PresentationResolver';
import { GameHud } from './GameHud';
import { HudPanel } from './HudPanel';
import { SelectionTray } from './SelectionTray';

interface GameLayoutProps {
  rulesetName?: string;
}

export const GameLayout: React.FC<GameLayoutProps> = ({ rulesetName: rulesetOverride }) => {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const activeTab = useGameStore(state => state.activeTab);
  const clientState = useGameStore(state => state.clientState);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const currentPlayer = useGameStore(state => state.players[state.currentPlayerId]);
  const researchedTechs = useGameStore(state => state.research?.researchedTechs);
  const rulesetName = rulesetOverride ?? 'civ2civ3';

  useEffect(() => {
    let active = true;
    const applyMusicTheme = async () => {
      const presentation = await rulesetService.loadPresentationRuleset(rulesetName);
      if (!active) return;
      const theme = resolveMusicStyle({
        requestedNationStyle: currentPlayer
          ? (await rulesetService.getNationStyles(rulesetName))[currentPlayer.nation]
          : undefined,
        nationStyles: presentation.nation_styles,
        musicStyles: presentation.music_styles,
        researchedTechs,
      });
      if (theme) {
        document.documentElement.dataset.musicTheme = theme;
        document.dispatchEvent(new CustomEvent('civjs-music-theme', { detail: { theme } }));
      }
    };
    void applyMusicTheme().catch(() => {
      // Presentation audio tags are optional; rendering remains usable offline.
    });
    return () => {
      active = false;
    };
  }, [currentPlayer, currentPlayerId, researchedTechs, rulesetName]);

  // Initialize keyboard controls
  useKeyboardControls();

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const calculateCanvasSize = () => {
    const headerHeight = 52; // Combined tab header and status bar height (reduced)
    const padding = 0; // Remove padding to use full space

    return {
      width: Math.max(800, dimensions.width - padding),
      height: Math.max(600, dimensions.height - headerHeight - padding),
    };
  };

  const canvasSize = calculateCanvasSize();

  if (clientState === 'initial' || clientState === 'connecting') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="text-center">
          <div className="text-2xl mb-4">
            {clientState === 'initial' ? 'Initializing...' : 'Connecting to server...'}
          </div>
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-800 text-white overflow-hidden flex flex-col">
      <NotificationFeed />
      <EndGamePanel />
      {/* Header with tabs and status */}
      <div className="flex items-center justify-between bg-gray-700 px-4 py-1 border-b border-gray-600">
        <GameTabs />
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Primary content */}
        <div className="flex-1 relative">
          {/* Keep MapCanvas mounted but hidden to avoid reloading tileset */}
          <div className={`h-full relative ${activeTab === 'map' ? 'block' : 'hidden'}`}>
            <MapCanvas
              width={canvasSize.width}
              height={canvasSize.height}
              rulesetName={rulesetName}
            />
            <GameHud
              top={
                <HudPanel className="flex max-w-full items-center gap-3 px-3 py-2 sm:gap-5 sm:px-4">
                  <StatusPanel />
                  <TurnDoneButton />
                  <GameMenu />
                </HudPanel>
              }
              bottomCenter={<SelectionTray />}
            />
          </div>

          <div className={`${activeTab === 'government' ? 'block' : 'hidden'}`}>
            <GovernmentPanel />
          </div>

          <div
            className={`h-full w-full relative ${activeTab === 'research' ? 'block' : 'hidden'}`}
          >
            <TechnologyTree />
          </div>

          <div className={`h-full ${activeTab === 'nations' ? 'block' : 'hidden'}`}>
            <NationsPanel />
          </div>

          <div className={`h-full ${activeTab === 'cities' ? 'block' : 'hidden'}`}>
            <CitiesPanel />
          </div>

          <div className={`h-full ${activeTab === 'options' ? 'block' : 'hidden'}`}>
            <GameOptionsPanel />
          </div>
        </div>
      </div>
    </div>
  );
};
