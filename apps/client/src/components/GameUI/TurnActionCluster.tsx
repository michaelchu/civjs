import React from 'react';
import {
  BarChart3,
  BookOpen,
  CircleHelp,
  Crosshair,
  Eye,
  Flag,
  MessageSquare,
  Radar,
  Rocket,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Swords,
} from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { GameMenu } from './GameMenu';
import { HudIconButton } from './HudIconButton';
import { HudPanel } from './HudPanel';
import { TurnDoneButton } from './TurnDoneButton';

const ActionButton: React.FC<{
  label: string;
  icon: React.ElementType;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}> = ({ label, icon: Icon, onClick, disabled = false, active = false, title }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={title ?? label}
    className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${
      active
        ? 'border-cyan-300/35 bg-cyan-300/15 text-cyan-100'
        : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
    } disabled:cursor-not-allowed disabled:opacity-40`}
  >
    <Icon className="h-4 w-4" aria-hidden="true" />
    <span className="hidden sm:inline">{label}</span>
  </button>
);

const ReportsMenu: React.FC<{
  onClose: () => void;
  onOpenScores?: () => void;
  onOpenDemographics?: () => void;
  onOpenClimate?: () => void;
  onOpenUnitReport?: () => void;
  onOpenIntelligence?: () => void;
  onOpenSpaceRace?: () => void;
  onOpenWarCalculator?: () => void;
}> = ({ onClose, onOpenScores, onOpenDemographics, onOpenClimate, onOpenUnitReport, onOpenIntelligence, onOpenSpaceRace, onOpenWarCalculator }) => {
  const setActiveTab = useGameStore(state => state.setActiveTab);
  const openTab = (tab: Parameters<typeof setActiveTab>[0]) => {
    setActiveTab(tab);
    onClose();
  };

  return (
    <div className="absolute bottom-full right-0 mb-2 w-64 rounded-xl border border-white/15 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-md">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        Reports and management
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <button type="button" onClick={() => { onOpenScores?.(); onClose(); }} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
          <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" /> Scores
        </button>
        <button type="button" onClick={() => { onOpenDemographics?.(); onClose(); }} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
          <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" /> Demographics
        </button>
        <button type="button" onClick={() => { onOpenClimate?.(); onClose(); }} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
          <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" /> Climate
        </button>
        <button type="button" onClick={() => { onOpenUnitReport?.(); onClose(); }} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
          <Swords className="h-3.5 w-3.5" aria-hidden="true" /> Units
        </button>
        <button type="button" onClick={() => { onOpenIntelligence?.(); onClose(); }} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
          <Radar className="h-3.5 w-3.5" aria-hidden="true" /> Intelligence
        </button>
        <button type="button" onClick={() => { onOpenSpaceRace?.(); onClose(); }} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
          <Rocket className="h-3.5 w-3.5" aria-hidden="true" /> Space race
        </button>
        <button type="button" onClick={() => { onOpenWarCalculator?.(); onClose(); }} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
          <Crosshair className="h-3.5 w-3.5" aria-hidden="true" /> War calculator
        </button>
        <button type="button" onClick={() => openTab('research')} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Research
        </button>
        <button type="button" onClick={() => openTab('nations')} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
          <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Diplomacy
        </button>
        <button type="button" onClick={() => openTab('government')} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-left text-[10px] text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" /> Government
        </button>
      </div>
      <div className="mt-2 border-t border-white/10 px-2 pt-2 text-[10px] text-slate-500">
          Help and Civilopedia are available from the Help menu.
      </div>
    </div>
  );
};

const HelpMenu: React.FC<{ onOpenCivilopedia?: () => void }> = ({ onOpenCivilopedia }) => (
  <div className="absolute bottom-full right-0 mb-2 w-64 rounded-xl border border-white/15 bg-slate-950/95 p-3 text-xs shadow-2xl backdrop-blur-md">
    <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
      <BookOpen className="h-4 w-4 text-cyan-300" aria-hidden="true" />
      Command help
    </div>
    <div className="mt-2 space-y-1.5 text-[10px] text-slate-400">
      <div className="flex justify-between gap-3"><span>End turn</span><kbd>Shift + Enter</kbd></div>
      <div className="flex justify-between gap-3"><span>Advance unit focus</span><kbd>Tab</kbd></div>
      <div className="flex justify-between gap-3"><span>Open action menu</span><kbd>Space</kbd></div>
      <div className="flex justify-between gap-3"><span>Map / Government / Research</span><kbd>F1–F3</kbd></div>
      <div className="flex justify-between gap-3"><span>Diplomacy / Cities / Settings</span><kbd>F4–F6</kbd></div>
    </div>
    <div className="mt-3 border-t border-white/10 pt-2 text-[10px] text-slate-500">
      <button type="button" onClick={onOpenCivilopedia} className="flex w-full items-center justify-between rounded px-1 py-1 text-left text-cyan-300 hover:bg-cyan-300/10 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
        Open Civilopedia <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
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
}> = ({ onOpenScores, onOpenDemographics, onOpenClimate, onOpenUnitReport, onOpenIntelligence, onOpenSpaceRace, onOpenWarCalculator, onOpenCivilopedia }) => {
  const [reportsOpen, setReportsOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const urgentFocusQueue = useGameStore(state => state.urgentFocusQueue);
  const units = useGameStore(state => state.units);
  const acknowledgeUrgentFocus = useGameStore(state => state.acknowledgeUrgentFocus);
  const selectUnit = useGameStore(state => state.selectUnit);
  const selectCity = useGameStore(state => state.selectCity);

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
    <HudPanel className="relative flex w-[min(28rem,calc(100vw-1.5rem))] flex-col gap-2 p-2 sm:p-2.5">
      <div className="flex items-center gap-1.5">
        <div className="mr-auto flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          <Swords className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
          Command
        </div>
        {urgentUnits.length > 0 && (
          <ActionButton
            label={`Review ${urgentUnits.length} urgent action${urgentUnits.length === 1 ? '' : 's'}`}
            icon={ShieldAlert}
            onClick={reviewUrgent}
            active
            title="Focus the next urgent unit"
          />
        )}
        <ActionButton
          label="Reports"
          icon={ScrollText}
          onClick={() => { setReportsOpen(value => !value); setHelpOpen(false); }}
          active={reportsOpen}
        />
        <ActionButton
          label="Help"
          icon={CircleHelp}
          onClick={() => { setHelpOpen(value => !value); setReportsOpen(false); }}
          active={helpOpen}
        />
        <HudIconButton label="Chat unavailable" disabled title="Chat is currently disabled">
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
        </HudIconButton>
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

      <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-2">
        <div className="hidden items-center gap-1.5 text-[10px] text-slate-500 sm:flex">
          <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Map remains active
        </div>
        <TurnDoneButton />
      </div>

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
      {helpOpen && <HelpMenu onOpenCivilopedia={onOpenCivilopedia} />}
    </HudPanel>
  );
};
