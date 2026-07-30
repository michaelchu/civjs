import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { MapCanvas } from '../Canvas2D/MapCanvas';
import { GameTabs } from './GameTabs';
import { StatusPanel } from './StatusPanel';
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
import { Minimap } from './Minimap';
import { ObjectivesJournal } from './ObjectivesJournal';
import { DiplomacyStrip } from './DiplomacyStrip';
import { TurnActionCluster } from './TurnActionCluster';
import { ScoreReport, type ScoreSnapshot } from './ScoreReport';
import { DemographicsReport } from './DemographicsReport';
import { ClimateReport } from './ClimateReport';
import { UnitReport } from './UnitReport';
import { IntelligenceReport } from './IntelligenceReport';
import { SpaceRaceReport } from './SpaceRaceReport';
import { WarCalculator } from './WarCalculator';
import { CivilopediaDialog } from './CivilopediaDialog';

interface GameLayoutProps {
  rulesetName?: string;
}

export const GameLayout: React.FC<GameLayoutProps> = ({ rulesetName: rulesetOverride }) => {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [scoreReportOpen, setScoreReportOpen] = useState(false);
  const [demographicsReportOpen, setDemographicsReportOpen] = useState(false);
  const [climateReportOpen, setClimateReportOpen] = useState(false);
  const [unitReportOpen, setUnitReportOpen] = useState(false);
  const [intelligenceReportOpen, setIntelligenceReportOpen] = useState(false);
  const [spaceRaceReportOpen, setSpaceRaceReportOpen] = useState(false);
  const [warCalculatorOpen, setWarCalculatorOpen] = useState(false);
  const [civilopediaOpen, setCivilopediaOpen] = useState(false);
  const [scoreHistory, setScoreHistory] = useState<ScoreSnapshot[]>([]);

  const activeTab = useGameStore(state => state.activeTab);
  const clientState = useGameStore(state => state.clientState);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const currentPlayer = useGameStore(state => state.players[state.currentPlayerId]);
  const players = useGameStore(state => state.players);
  const cities = useGameStore(state => state.cities);
  const units = useGameStore(state => state.units);
  const tiles = useGameStore(state => state.map.tiles);
  const mapWidth = useGameStore(state => state.map.width);
  const mapHeight = useGameStore(state => state.map.height);
  const technologies = useGameStore(state => state.technologies);
  const turn = useGameStore(state => state.turn);
  const researchedTechs = useGameStore(state => state.research?.researchedTechs);
  const diplomacy = useGameStore(state => state.diplomacy);
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

  useEffect(() => {
    const scores = Object.fromEntries(
      Object.values(players)
        .filter(player => player.score !== undefined)
        .map(player => [player.id, player.score ?? 0])
    );
    if (Object.keys(scores).length === 0) return;
    setScoreHistory(previous => {
      const withoutCurrentTurn = previous.filter(snapshot => snapshot.turn !== turn);
      return [...withoutCurrentTurn, { turn, scores }].slice(-40);
    });
  }, [players, turn]);

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
      <ScoreReport
        open={scoreReportOpen}
        onOpenChange={setScoreReportOpen}
        players={players}
        currentPlayerId={currentPlayerId}
        history={scoreHistory}
        cityCounts={Object.values(cities).reduce<Record<string, number>>((counts, city) => {
          counts[city.playerId] = (counts[city.playerId] ?? 0) + 1;
          return counts;
        }, {})}
      />
      <DemographicsReport
        open={demographicsReportOpen}
        onOpenChange={setDemographicsReportOpen}
        players={players}
        cities={cities}
        units={units}
        tiles={tiles}
        technologies={technologies}
        currentPlayerId={currentPlayerId}
      />
      <ClimateReport
        open={climateReportOpen}
        onOpenChange={setClimateReportOpen}
        tiles={tiles}
        mapWidth={mapWidth}
        mapHeight={mapHeight}
      />
      <UnitReport
        open={unitReportOpen}
        onOpenChange={setUnitReportOpen}
        units={units}
        cities={cities}
        currentPlayerId={currentPlayerId}
      />
      <IntelligenceReport
        open={intelligenceReportOpen}
        onOpenChange={setIntelligenceReportOpen}
        players={players}
        diplomacy={diplomacy}
        cities={cities}
        units={units}
        tiles={tiles}
        currentPlayerId={currentPlayerId}
        researchedTechCount={researchedTechs?.size ?? 0}
      />
      <SpaceRaceReport
        open={spaceRaceReportOpen}
        onOpenChange={setSpaceRaceReportOpen}
        players={players}
        currentPlayerId={currentPlayerId}
        currentTurn={turn}
      />
      <WarCalculator
        open={warCalculatorOpen}
        onOpenChange={setWarCalculatorOpen}
        units={units}
        currentPlayerId={currentPlayerId}
      />
      <CivilopediaDialog
        open={civilopediaOpen}
        onOpenChange={setCivilopediaOpen}
        technologies={technologies}
      />
      {/* Header with tabs and status */}
      <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/45 px-4 py-1 backdrop-blur-md">
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
                <HudPanel className="flex max-w-full items-center gap-3 overflow-x-auto px-3 py-2 sm:gap-5 sm:px-4">
                  <StatusPanel onOpenDemographics={() => setDemographicsReportOpen(true)} />
                </HudPanel>
              }
              bottomCenter={<SelectionTray />}
              bottomLeft={<Minimap />}
              left={<ObjectivesJournal />}
              right={<DiplomacyStrip onOpenIntelligence={() => setIntelligenceReportOpen(true)} />}
              bottomRight={
                <TurnActionCluster
                  onOpenScores={() => setScoreReportOpen(true)}
                  onOpenDemographics={() => setDemographicsReportOpen(true)}
                  onOpenClimate={() => setClimateReportOpen(true)}
                  onOpenUnitReport={() => setUnitReportOpen(true)}
                  onOpenIntelligence={() => setIntelligenceReportOpen(true)}
                  onOpenSpaceRace={() => setSpaceRaceReportOpen(true)}
                  onOpenWarCalculator={() => setWarCalculatorOpen(true)}
                  onOpenCivilopedia={() => setCivilopediaOpen(true)}
                />
              }
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
