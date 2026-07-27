import React, { useEffect, useState } from 'react';
import { gameClient } from '../../services/GameClient';
import { useGameStore } from '../../store/gameStore';
import type { DiplomacyNation, TreatyClauseType } from '../../types';
import { Button } from '../ui/button';

const stateLabels: Record<DiplomacyNation['relation']['state'], string> = {
  no_contact: 'No formal relations',
  war: 'War',
  ceasefire: 'Ceasefire',
  armistice: 'Armistice',
  peace: 'Peace',
  alliance: 'Alliance',
};

export const NationsPanel: React.FC = () => {
  const diplomacy = useGameStore(state => state.diplomacy);
  const [selectedClauses, setSelectedClauses] = useState<Record<string, TreatyClauseType>>({});

  useEffect(() => {
    gameClient.requestDiplomacy();
  }, []);

  return (
    <section className="h-full overflow-y-auto bg-gray-900 p-6 text-white">
      <h2 className="text-2xl font-bold">Nations & diplomacy</h2>
      <p className="mt-1 text-sm text-gray-400">
        Treaties are proposals until the other nation accepts them. Declarations of war take effect
        immediately.
      </p>

      {!diplomacy ? (
        <p className="mt-6 text-gray-300">Loading diplomatic intelligence…</p>
      ) : diplomacy.nations.length === 0 ? (
        <p className="mt-6 text-gray-300">There are no other nations in this game.</p>
      ) : (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {diplomacy.nations.map(nation => (
            <NationCard
              key={nation.id}
              nation={nation}
              currentPlayerId={diplomacy.playerId}
              selectedClause={selectedClauses[nation.id] ?? 'peace'}
              onClauseChange={clause =>
                setSelectedClauses(current => ({ ...current, [nation.id]: clause }))
              }
            />
          ))}
        </div>
      )}
    </section>
  );
};

const NationCard: React.FC<{
  nation: DiplomacyNation;
  currentPlayerId: string;
  selectedClause: TreatyClauseType;
  onClauseChange: (clause: TreatyClauseType) => void;
}> = ({ nation, currentPlayerId, selectedClause, onClauseChange }) => {
  const proposal = nation.relation.proposal;
  const incoming = proposal?.status === 'pending' && proposal.recipientId === currentPlayerId;
  const outgoing = proposal?.status === 'pending' && proposal.proposerId === currentPlayerId;

  return (
    <article className="rounded-lg border border-gray-700 bg-gray-800 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold capitalize">{nation.civilization}</h3>
          <p className="text-sm text-gray-400">
            {nation.leaderName} · {nation.isAI ? 'AI adapter' : 'Human'}
          </p>
        </div>
        <span className="rounded bg-gray-900 px-2 py-1 text-xs text-blue-200">
          {stateLabels[nation.relation.state]}
        </span>
      </div>

      <div className="mt-3 flex gap-2 text-xs text-gray-300">
        {nation.relation.embassy && <span className="rounded bg-gray-700 px-2 py-1">Embassy</span>}
        {nation.relation.sharedVision && (
          <span className="rounded bg-gray-700 px-2 py-1">Shared vision</span>
        )}
      </div>

      {incoming && proposal ? (
        <div className="mt-4 rounded border border-amber-600 bg-amber-950/40 p-3">
          <p className="text-sm">
            Proposed: {proposal.clauses.map(clause => clause.type.replace('_', ' ')).join(', ')}
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => gameClient.respondToTreaty(nation.id, proposal.id, true)}>
              Accept
            </Button>
            <Button
              variant="outline"
              onClick={() => gameClient.respondToTreaty(nation.id, proposal.id, false)}
            >
              Reject
            </Button>
          </div>
        </div>
      ) : outgoing && proposal ? (
        <div className="mt-4 flex items-center justify-between rounded bg-gray-900 p-3 text-sm">
          <span>Waiting for a response</span>
          <Button variant="outline" onClick={() => gameClient.cancelTreaty(nation.id, proposal.id)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-sm text-gray-300">
            Treaty clause
            <select
              className="mt-1 block rounded border border-gray-600 bg-gray-900 p-2"
              value={selectedClause}
              onChange={event => onClauseChange(event.target.value as TreatyClauseType)}
            >
              <option value="ceasefire">Ceasefire</option>
              <option value="peace">Peace</option>
              <option value="alliance">Alliance</option>
              <option value="embassy">Exchange embassies</option>
              <option value="shared_vision">Share vision</option>
            </select>
          </label>
          <Button onClick={() => gameClient.proposeTreaty(nation.id, [selectedClause])}>
            Propose
          </Button>
          {nation.relation.state !== 'war' && (
            <Button variant="outline" onClick={() => gameClient.declareWar(nation.id)}>
              Declare war
            </Button>
          )}
        </div>
      )}
    </article>
  );
};
