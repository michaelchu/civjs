import React from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  Handshake,
  Shield,
  Swords,
  Users,
  X,
} from 'lucide-react';
import { gameClient } from '../../services/GameClient';
import { useGameStore } from '../../store/gameStore';
import type { DiplomacyNation, DiplomaticState } from '../../types';
import { HudIconButton } from './HudIconButton';
import { HudPanel } from './HudPanel';

const stateLabels: Record<DiplomaticState, string> = {
  no_contact: 'No contact',
  war: 'War',
  ceasefire: 'Ceasefire',
  armistice: 'Armistice',
  peace: 'Peace',
  alliance: 'Alliance',
  team: 'Team',
};

const stateClasses: Record<DiplomaticState, string> = {
  no_contact: 'text-slate-400 bg-slate-400/10 border-slate-400/20',
  war: 'text-rose-200 bg-rose-400/15 border-rose-300/30',
  ceasefire: 'text-amber-200 bg-amber-400/15 border-amber-300/30',
  armistice: 'text-amber-200 bg-amber-400/15 border-amber-300/30',
  peace: 'text-emerald-200 bg-emerald-400/15 border-emerald-300/30',
  alliance: 'text-cyan-200 bg-cyan-400/15 border-cyan-300/30',
  team: 'text-violet-200 bg-violet-400/15 border-violet-300/30',
};

const stateIcons: Record<DiplomaticState, React.ElementType> = {
  no_contact: Users,
  war: Swords,
  ceasefire: Shield,
  armistice: Shield,
  peace: Handshake,
  alliance: Handshake,
  team: Users,
};

const LeaderInsignia: React.FC<{ nation: DiplomacyNation }> = ({ nation }) => (
  <div
    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/30 bg-gradient-to-br from-cyan-300/20 to-violet-300/10 text-xs font-bold text-cyan-100"
    aria-hidden="true"
  >
    {nation.civilization.slice(0, 2).toUpperCase()}
  </div>
);

const RelationBadge: React.FC<{ state: DiplomaticState }> = ({ state }) => {
  const Icon = stateIcons[state];
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${stateClasses[state]}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {stateLabels[state]}
    </span>
  );
};

const ProposalActions: React.FC<{ nation: DiplomacyNation; currentPlayerId: string }> = ({
  nation,
  currentPlayerId,
}) => {
  const proposal = nation.relation.proposal;
  if (!proposal || proposal.status !== 'pending') return null;

  const incoming = proposal.recipientId === currentPlayerId;
  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1.5">
      <CircleAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[10px] text-amber-100">
        {incoming ? 'Incoming proposal' : 'Proposal pending'}
      </span>
      {incoming ? (
        <>
          <HudIconButton
            label={`Accept proposal from ${nation.leaderName}`}
            className="h-6 w-6 text-emerald-200"
            onClick={() => gameClient.respondToTreaty(nation.id, proposal.id, true)}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          </HudIconButton>
          <HudIconButton
            label={`Reject proposal from ${nation.leaderName}`}
            className="h-6 w-6 text-rose-200"
            onClick={() => gameClient.respondToTreaty(nation.id, proposal.id, false)}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </HudIconButton>
        </>
      ) : (
        <HudIconButton
          label={`Cancel proposal to ${nation.leaderName}`}
          className="h-6 w-6 text-slate-300"
          onClick={() => gameClient.cancelTreaty(nation.id, proposal.id)}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </HudIconButton>
      )}
    </div>
  );
};

const LeaderRow: React.FC<{ nation: DiplomacyNation; currentPlayerId: string }> = ({
  nation,
  currentPlayerId,
}) => {
  const setActiveTab = useGameStore(state => state.setActiveTab);

  if (!nation.known) {
    return (
      <div className="flex items-center gap-2 rounded-lg px-2 py-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-500">
          <Shield className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-300">Unknown nation</div>
          <div className="text-[10px] text-slate-500">Identity hidden until contact</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg px-1 py-1 transition-colors hover:bg-white/5">
      <button
        type="button"
        onClick={() => {
          setActiveTab('nations');
          document.dispatchEvent(
            new CustomEvent('focus-nation-card', { detail: { nationId: nation.id } })
          );
        }}
        aria-label={`Open diplomacy card for ${nation.leaderName}`}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      >
        <LeaderInsignia nation={nation} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-slate-100">
            {nation.leaderName}
          </span>
          <span className="block truncate text-[10px] text-slate-500">
            {nation.civilization} · {nation.isAI ? 'AI' : 'Human'}
          </span>
        </span>
        <RelationBadge state={nation.relation.state} />
      </button>
      <div className="ml-11 mt-1 flex flex-wrap items-center gap-1.5">
        {nation.relation.embassy && <span className="text-[10px] text-slate-400">Embassy</span>}
        {nation.relation.sharedVision && (
          <span className="inline-flex items-center gap-1 text-[10px] text-sky-300">
            <Eye className="h-3 w-3" aria-hidden="true" /> Receiving vision
          </span>
        )}
        {nation.relation.givesSharedVision && (
          <span className="inline-flex items-center gap-1 text-[10px] text-sky-300">
            <Eye className="h-3 w-3" aria-hidden="true" /> Giving vision
          </span>
        )}
        {nation.relation.attitude !== undefined && (
          <span className="text-[10px] text-slate-500">Attitude {nation.relation.attitude}</span>
        )}
      </div>
      <ProposalActions nation={nation} currentPlayerId={currentPlayerId} />
    </div>
  );
};

export const DiplomacyStrip: React.FC = () => {
  const [collapsed, setCollapsed] = React.useState(false);
  const diplomacy = useGameStore(state => state.diplomacy);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);

  const nations = diplomacy?.nations ?? [];
  const knownNations = nations.filter(nation => nation.known && nation.isAlive);
  const unknownCount = nations.filter(nation => !nation.known && nation.isAlive).length;
  const pendingCount = knownNations.filter(nation => nation.relation.proposal?.status === 'pending').length;

  if (collapsed) {
    return (
      <HudPanel className="flex w-11 flex-col items-center gap-2 p-1.5 sm:flex">
        <HudIconButton label="Expand diplomacy" onClick={() => setCollapsed(false)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </HudIconButton>
        {pendingCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400/20 px-1 text-[10px] font-semibold tabular-nums text-amber-200">
            {pendingCount}
          </span>
        )}
      </HudPanel>
    );
  }

  return (
    <HudPanel className="hidden max-h-[min(36rem,calc(100vh-8rem))] w-72 flex-col overflow-hidden sm:flex">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <Users className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-100">Diplomacy</div>
          <div className="text-[10px] text-slate-500">Known world leaders</div>
        </div>
        {pendingCount > 0 && (
          <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-200">
            {pendingCount}
          </span>
        )}
        <HudIconButton label="Collapse diplomacy" onClick={() => setCollapsed(true)}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </HudIconButton>
      </div>

      <div className="overflow-y-auto p-2">
        {!diplomacy ? (
          <div className="px-2 py-3 text-xs text-slate-400">Loading diplomatic intelligence…</div>
        ) : knownNations.length === 0 && unknownCount === 0 ? (
          <div className="px-2 py-3 text-xs text-slate-400">No other nations in this game</div>
        ) : (
          <>
            <div className="space-y-1">
              {knownNations.map(nation => (
                <LeaderRow key={nation.id} nation={nation} currentPlayerId={currentPlayerId} />
              ))}
              {Array.from({ length: unknownCount }, (_, index) => (
                <LeaderRow
                  key={`unknown-${index}`}
                  nation={{
                    id: `unknown-${index}`,
                    civilization: '',
                    leaderName: '',
                    isAlive: true,
                    isAI: false,
                    known: false,
                    relation: {
                      state: 'no_contact',
                      sinceTurn: 0,
                      embassy: false,
                      sharedVision: false,
                    },
                  }}
                  currentPlayerId={currentPlayerId}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => useGameStore.getState().setActiveTab('nations')}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
            >
              Open diplomacy report
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </HudPanel>
  );
};
