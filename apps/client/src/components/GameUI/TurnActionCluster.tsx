/**
 * @module client/components/GameUI/TurnActionCluster
 * Defines the Turn Action Cluster client UI component.
 */
import React from 'react';
import {
  BarChart3,
  Building2,
  BookOpen,
  CircleHelp,
  Crosshair,
  Eye,
  Flag,
  MoreHorizontal,
  Radar,
  Rocket,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Swords,
} from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { GameMenu } from './GameMenu';
import { HudActionButton } from './HudActionButton';
import { HudIconButton } from './HudIconButton';
import { HudPanel } from './HudPanel';
import { ObjectivesJournal } from './ObjectivesJournal';
import { TurnDoneButton } from './TurnDoneButton';
import { ChatBox } from './ChatBox';
import { openReport } from './reportEvents';

const ReportsMenu: React.FC<{
  onClose: () => void;
  onOpenScores?: () => void;
  onOpenDemographics?: () => void;
  onOpenClimate?: () => void;
  onOpenUnitReport?: () => void;
  onOpenIntelligence?: () => void;
  onOpenSpaceRace?: () => void;
  onOpenWarCalculator?: () => void;
}> = ({
  onClose,
  onOpenScores,
  onOpenDemographics,
  onOpenClimate,
  onOpenUnitReport,
  onOpenIntelligence,
  onOpenSpaceRace,
  onOpenWarCalculator,
}) => {
  const reportItems = [
    { label: 'Scores', icon: BarChart3, action: onOpenScores },
    { label: 'Demographics', icon: BarChart3, action: onOpenDemographics },
    { label: 'Climate', icon: BarChart3, action: onOpenClimate },
    { label: 'Units', icon: Swords, action: onOpenUnitReport },
    { label: 'Empire', icon: Building2, action: () => openReport('empire') },
    { label: 'Intelligence', icon: Radar, action: onOpenIntelligence },
    { label: 'Space race', icon: Rocket, action: onOpenSpaceRace },
    { label: 'War calculator', icon: Crosshair, action: onOpenWarCalculator },
    { label: 'Research', icon: Sparkles, action: () => openReport('research') },
    { label: 'Diplomacy', icon: Flag, action: () => openReport('diplomacy') },
    { label: 'Government', icon: ShieldAlert, action: () => openReport('government') },
  ];

  return (
    <div
      id="turn-reports-menu"
      role="dialog"
      aria-label="Reports and management"
      className="hud-surface absolute bottom-full right-0 mb-2 w-64 rounded-xl border p-2"
    >
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        Reports and management
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        {reportItems.map(({ label, icon: Icon, action }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              action?.();
              onClose();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <div className="mt-2 border-t border-white/10 px-2 pt-2 text-[10px] text-slate-500">
        Help and Civilopedia are available from the Help menu.
      </div>
    </div>
  );
};

const HelpMenu: React.FC<{ onOpenCivilopedia?: () => void }> = ({ onOpenCivilopedia }) => (
  <div
    id="turn-help-menu"
    role="dialog"
    aria-label="Command help"
    className="hud-surface absolute bottom-full right-0 mb-2 w-64 rounded-xl border p-3 text-xs"
  >
    <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
      <BookOpen className="h-4 w-4 text-cyan-300" aria-hidden="true" />
      Command help
    </div>
    <div className="mt-2 space-y-1.5 text-[10px] text-slate-400">
      <div className="flex justify-between gap-3">
        <span>End turn</span>
        <kbd>Shift + Enter</kbd>
      </div>
      <div className="flex justify-between gap-3">
        <span>Advance unit focus</span>
        <kbd>Tab</kbd>
      </div>
      <div className="flex justify-between gap-3">
        <span>Open action menu</span>
        <kbd>Space</kbd>
      </div>
      <div className="flex justify-between gap-3">
        <span>Map / Government / Research</span>
        <kbd>F1–F3</kbd>
      </div>
      <div className="flex justify-between gap-3">
        <span>Diplomacy / Cities / Settings</span>
        <kbd>F4–F6</kbd>
      </div>
    </div>
    <div className="mt-3 border-t border-white/10 pt-2 text-[10px] text-slate-500">
      <button
        type="button"
        onClick={onOpenCivilopedia}
        className="flex w-full items-center justify-between rounded px-1 py-1 text-left text-cyan-300 hover:bg-cyan-300/10 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      >
        Open Civilopedia <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  </div>
);

const MobileActionsMenu: React.FC<{
  onReports: () => void;
  onHelp: () => void;
}> = ({ onReports, onHelp }) => (
  <div
    id="turn-mobile-actions-menu"
    role="dialog"
    aria-label="More command actions"
    className="hud-surface absolute bottom-full right-0 mb-2 w-48 rounded-xl border p-2 sm:hidden"
  >
    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
      More actions
    </div>
    <div className="mt-1 space-y-1">
      <button
        type="button"
        onClick={onReports}
        className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-xs text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      >
        <ScrollText className="h-4 w-4" aria-hidden="true" /> Reports
      </button>
      <button
        type="button"
        onClick={onHelp}
        className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-xs text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      >
        <CircleHelp className="h-4 w-4" aria-hidden="true" /> Help
      </button>
    </div>
  </div>
);

export const TurnActionCluster: React.FC<{
  onOpenScores?: () => void;
  onOpenDemographics?: () => void;
  onOpenClimate?: () => void;
  onOpenUnitReport?: () => void;
  onOpenIntelligence?: () => void;
  onOpenSpaceRace?: () => void;
  onOpenWarCalculator?: () => void;
  onOpenCivilopedia?: () => void;
}> = ({
  onOpenScores,
  onOpenDemographics,
  onOpenClimate,
  onOpenUnitReport,
  onOpenIntelligence,
  onOpenSpaceRace,
  onOpenWarCalculator,
  onOpenCivilopedia,
}) => {
  const [reportsOpen, setReportsOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = React.useState(false);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const urgentFocusQueue = useGameStore(state => state.urgentFocusQueue);
  const units = useGameStore(state => state.units);
  const acknowledgeUrgentFocus = useGameStore(state => state.acknowledgeUrgentFocus);
  const selectUnit = useGameStore(state => state.selectUnit);
  const selectCity = useGameStore(state => state.selectCity);

  React.useEffect(() => {
    if (!reportsOpen && !helpOpen && !chatOpen && !mobileActionsOpen) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setReportsOpen(false);
      setHelpOpen(false);
      setChatOpen(false);
      setMobileActionsOpen(false);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [chatOpen, helpOpen, mobileActionsOpen, reportsOpen]);

  const urgentUnits = urgentFocusQueue
    .map(unitId => units[unitId])
    .filter(unit => unit?.playerId === currentPlayerId);
  const nextUrgent = urgentUnits[0];

  const reviewUrgent = () => {
    if (!nextUrgent) return;
    selectCity(null);
    selectUnit(nextUrgent.id);
    document.dispatchEvent(
      new CustomEvent('center-map-on-tile', { detail: { x: nextUrgent.x, y: nextUrgent.y } })
    );
  };

  return (
    <HudPanel className="relative flex flex-col gap-2 px-3 py-2 sm:gap-4 sm:px-4">
      <div className="flex items-center gap-1.5 sm:gap-2">
        <div className="mr-auto">
          <TurnDoneButton />
        </div>
        {urgentUnits.length > 0 && (
          <HudActionButton
            label={`Review ${urgentUnits.length} urgent action${urgentUnits.length === 1 ? '' : 's'}`}
            icon={ShieldAlert}
            onClick={reviewUrgent}
            active
            title="Focus the next urgent unit"
          />
        )}
        <div className="hidden sm:block">
          <HudActionButton
            compact
            label="Reports"
            icon={ScrollText}
            onClick={() => {
              setReportsOpen(value => !value);
              setHelpOpen(false);
            }}
            active={reportsOpen}
            aria-expanded={reportsOpen}
            aria-controls="turn-reports-menu"
          />
        </div>
        <div className="hidden sm:block">
          <ObjectivesJournal popover />
        </div>
        <div className="hidden sm:block">
          <HudActionButton
            compact
            label="Help"
            icon={CircleHelp}
            onClick={() => {
              setHelpOpen(value => !value);
              setReportsOpen(false);
            }}
            active={helpOpen}
            aria-expanded={helpOpen}
            aria-controls="turn-help-menu"
          />
        </div>
        <div className="sm:hidden">
          <HudIconButton
            label="More actions"
            onClick={() => setMobileActionsOpen(value => !value)}
            title="More command actions"
            aria-expanded={mobileActionsOpen}
            aria-controls="turn-mobile-actions-menu"
            className={mobileActionsOpen ? 'bg-cyan-300/15 text-cyan-100' : undefined}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </HudIconButton>
        </div>
        <GameMenu />
      </div>

      {urgentUnits.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-[10px] text-amber-100">
          <Eye className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {urgentUnits.length} unit{urgentUnits.length === 1 ? '' : 's'} need attention
          </span>
          <button
            type="button"
            onClick={() => acknowledgeUrgentFocus(nextUrgent?.id)}
            className="rounded px-1.5 py-1 text-amber-200 hover:bg-amber-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
          >
            Acknowledge
          </button>
        </div>
      )}

      {reportsOpen && (
        <ReportsMenu
          onClose={() => setReportsOpen(false)}
          onOpenScores={onOpenScores}
          onOpenDemographics={onOpenDemographics}
          onOpenClimate={onOpenClimate}
          onOpenUnitReport={onOpenUnitReport}
          onOpenIntelligence={onOpenIntelligence}
          onOpenSpaceRace={onOpenSpaceRace}
          onOpenWarCalculator={onOpenWarCalculator}
        />
      )}
      {helpOpen && (
        <HelpMenu
          onOpenCivilopedia={() => {
            setHelpOpen(false);
            onOpenCivilopedia?.();
          }}
        />
      )}
      {mobileActionsOpen && (
        <MobileActionsMenu
          onReports={() => {
            setMobileActionsOpen(false);
            setHelpOpen(false);
            setReportsOpen(true);
          }}
          onHelp={() => {
            setMobileActionsOpen(false);
            setReportsOpen(false);
            setHelpOpen(true);
          }}
        />
      )}
      <ChatBox open={chatOpen} onOpenChange={setChatOpen} />
    </HudPanel>
  );
};
