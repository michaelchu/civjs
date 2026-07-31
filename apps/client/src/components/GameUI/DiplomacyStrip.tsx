import React from 'react';
import { Eye, Handshake, Shield, Swords, Users } from 'lucide-react';
import { gameClient } from '../../services/GameClient';
import { useGameStore } from '../../store/gameStore';
import { openReport } from './reportEvents';
import type { DiplomacyNation, DiplomaticState } from '../../types';
import { HudIconButton } from './HudIconButton';
import { NationInsignia } from './NationInsignia';

const formatNationName = (nation: string): string => {
  if (nation === 'random') return 'Random';

  return nation
    .split(/[\s_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

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

const RelationBadge: React.FC<{ state: DiplomaticState }> = ({ state }) => {
  const Icon = stateIcons[state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${stateClasses[state]}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {stateLabels[state]}
    </span>
  );
};

const LeaderRow: React.FC<{
  nation: DiplomacyNation;
  color?: string;
}> = ({ nation, color }) => {
  return <NationButton nation={nation} color={color} />;
};

const NationButton: React.FC<{
  nation: DiplomacyNation;
  color?: string;
}> = ({ nation, color }) => {
  const known = nation.known;
  const proposalPending = nation.relation.proposal?.status === 'pending';
  const hasRelationshipDetails =
    nation.relation.embassy ||
    nation.relation.sharedVision ||
    nation.relation.givesSharedVision ||
    proposalPending;
  const label = known ? `Open diplomacy card for ${nation.leaderName}` : 'Unknown nation';

  return (
    <div className="group relative">
      <HudIconButton
        label={label}
        hideTitle
        className="relative h-9 w-9 rounded-full p-0"
        onClick={() => {
          openReport('diplomacy');
          if (known) {
            document.dispatchEvent(
              new CustomEvent('focus-nation-card', { detail: { nationId: nation.id } })
            );
          }
        }}
      >
        {known ? (
          <NationInsignia
            color={color ?? '#0e7490'}
            name={nation.civilization}
            size="lg"
            className="rounded-full"
          />
        ) : (
          <Shield className="h-4 w-4 text-slate-500" aria-hidden="true" />
        )}
        {proposalPending && (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-slate-950 bg-amber-300" />
        )}
      </HudIconButton>

      <div className="hud-surface pointer-events-none absolute left-full top-0 z-40 ml-2 hidden w-max max-w-[calc(100vw-5rem)] rounded-xl border p-3 text-left group-hover:block group-focus-within:block">
        {known ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <NationInsignia
                color={color ?? '#0e7490'}
                name={nation.civilization}
                size="lg"
                className="rounded-full"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-slate-100">
                  {nation.leaderName}
                </div>
                <div className="truncate text-[10px] text-slate-500">
                  {nation.civilization} · {nation.isAI ? 'AI' : 'Human'}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RelationBadge state={nation.relation.state} />
              {nation.relation.attitude !== undefined && (
                <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                  Attitude {nation.relation.attitude}
                </span>
              )}
            </div>
            {hasRelationshipDetails && (
              <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-slate-400">
                {nation.relation.embassy && <span>Embassy</span>}
                {nation.relation.sharedVision && (
                  <span className="inline-flex items-center gap-1 text-sky-300">
                    <Eye className="h-3 w-3" aria-hidden="true" /> Receiving vision
                  </span>
                )}
                {nation.relation.givesSharedVision && (
                  <span className="inline-flex items-center gap-1 text-sky-300">
                    <Eye className="h-3 w-3" aria-hidden="true" /> Giving vision
                  </span>
                )}
                {proposalPending && <span className="text-amber-200">Proposal pending</span>}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="text-xs font-medium text-slate-300">Unknown nation</div>
            <div className="mt-1 text-[10px] text-slate-500">Identity hidden until contact</div>
          </>
        )}
      </div>
    </div>
  );
};

const CurrentPlayerButton: React.FC<{
  player: { nation: string; government: string; color: string; name: string };
}> = ({ player }) => {
  const nationName = formatNationName(player.nation);
  return (
    <HudIconButton
      label={`Open ${nationName} government`}
      title={`${nationName} · ${player.name}`}
      className="relative h-9 w-9 rounded-full p-0"
      onClick={() => openReport('government')}
    >
      <NationInsignia color={player.color} name={nationName} size="lg" className="rounded-full" />
    </HudIconButton>
  );
};

export const DiplomacyStrip: React.FC = () => {
  React.useEffect(() => {
    gameClient.requestDiplomacy();
  }, []);

  const diplomacy = useGameStore(state => state.diplomacy);
  const players = useGameStore(state => state.players);
  const currentPlayer = useGameStore(state => state.players[state.currentPlayerId]);

  const nations = diplomacy?.nations ?? [];
  const knownNations = nations.filter(
    nation => nation.known && nation.isAlive && nation.relation.state !== 'no_contact'
  );

  return (
    <div className="flex flex-col items-center gap-1.5 overflow-visible">
      {currentPlayer && <CurrentPlayerButton player={currentPlayer} />}
      {diplomacy &&
        knownNations.map(nation => (
          <LeaderRow key={nation.id} nation={nation} color={players[nation.id]?.color} />
        ))}
    </div>
  );
};
