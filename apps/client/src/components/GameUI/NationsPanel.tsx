import React, { useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { gameClient } from '../../services/GameClient';
import { useGameStore } from '../../store/gameStore';
import type {
  City,
  DiplomacyNation,
  Technology,
  TreatyClause,
  TreatyClauseType,
} from '../../types';
import { Button } from '../ui/button';

const stateLabels: Record<DiplomacyNation['relation']['state'], string> = {
  no_contact: 'No formal relations',
  war: 'War',
  ceasefire: 'Ceasefire',
  armistice: 'Armistice',
  peace: 'Peace',
  alliance: 'Alliance',
  team: 'Team',
};

export const NationsPanel: React.FC = () => {
  const diplomacy = useGameStore(state => state.diplomacy);
  const currentPlayer = useGameStore(state => state.players[state.currentPlayerId]);
  const technologies = useGameStore(state => state.technologies);
  const researchedTechs = useGameStore(state => state.research?.researchedTechs);
  const cities = useGameStore(state => state.cities);

  useEffect(() => {
    const handleFocusNation = (event: Event) => {
      const nationId = (event as CustomEvent<{ nationId?: string }>).detail?.nationId;
      if (!nationId) return;
      document.getElementById(`nation-card-${nationId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    };
    document.addEventListener('focus-nation-card', handleFocusNation);
    return () => document.removeEventListener('focus-nation-card', handleFocusNation);
  }, []);

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
              currentPlayerGold={currentPlayer?.gold ?? 0}
              technologies={technologies}
              researchedTechs={researchedTechs ?? new Set()}
              cities={cities}
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
  currentPlayerGold: number;
  technologies: Record<string, Technology>;
  researchedTechs: Set<string>;
  cities: Record<string, City>;
}> = ({ nation, currentPlayerId, currentPlayerGold, technologies, researchedTechs, cities }) => {
  const proposal = nation.relation.proposal;
  const incoming = proposal?.status === 'pending' && proposal.recipientId === currentPlayerId;
  const outgoing = proposal?.status === 'pending' && proposal.proposerId === currentPlayerId;
  const [draftClauses, setDraftClauses] = useState<TreatyClause[]>([]);
  const canMeet = nation.canMeet ?? nation.known;
  const knownCity = Object.values(cities).find(city => city.playerId === nation.id);

  if (!nation.known) {
    return (
      <article className="rounded-lg border border-gray-700 bg-gray-800 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Unknown nation</h3>
            <p className="text-sm text-gray-400">
              Establish contact to learn this nation&apos;s identity.
            </p>
          </div>
          <span className="rounded bg-gray-900 px-2 py-1 text-xs text-gray-300">No contact</span>
        </div>
      </article>
    );
  }

  return (
    <article
      id={`nation-card-${nation.id}`}
      className="rounded-lg border border-gray-700 bg-gray-800 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold capitalize">{nation.civilization}</h3>
          <p className="text-sm text-gray-400">
            {nation.leaderName} · {nation.isAI ? 'AI adapter' : 'Human'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {knownCity && (
            <Button
              variant="outline"
              className="gap-1 px-2 py-1 text-xs"
              onClick={() =>
                document.dispatchEvent(
                  new CustomEvent('center-map-on-tile', {
                    detail: { x: knownCity.x, y: knownCity.y },
                  })
                )
              }
              aria-label={`Center on known city ${knownCity.name}`}
              title={`Center on known city ${knownCity.name}`}
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {knownCity.name}
            </Button>
          )}
          <span className="rounded bg-gray-900 px-2 py-1 text-xs text-blue-200">
            {stateLabels[nation.relation.state]}
          </span>
        </div>
      </div>

      <div className="mt-3 flex gap-2 text-xs text-gray-300">
        {nation.relation.embassy && <span className="rounded bg-gray-700 px-2 py-1">Embassy</span>}
        {nation.relation.sharedVision && (
          <span className="rounded bg-gray-700 px-2 py-1">Receiving vision</span>
        )}
        {nation.relation.givesSharedVision && (
          <span className="rounded bg-gray-700 px-2 py-1">Giving vision</span>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Reputation {nation.relation.reputation ?? 1000}/1000 · Attitude{' '}
        {nation.relation.attitude ?? 0}
        {(nation.relation.turnsLeft ?? 0) > 0
          ? ` · ${nation.relation.turnsLeft} treaty turns remaining`
          : ''}
      </p>

      {!canMeet && nation.relation.state !== 'team' ? (
        <p className="mt-4 rounded border border-gray-700 bg-gray-900 p-3 text-sm text-gray-300">
          Renew diplomatic contact or establish an embassy before negotiating.
        </p>
      ) : incoming && proposal ? (
        <div className="mt-4 rounded border border-amber-600 bg-amber-950/40 p-3">
          <p className="text-sm font-medium">Incoming proposal</p>
          <ClauseList
            clauses={proposal.clauses}
            currentPlayerId={currentPlayerId}
            otherPlayerId={nation.id}
            technologies={technologies}
            cities={cities}
          />
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
        <div className="mt-4 rounded bg-gray-900 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">Waiting for a response</span>
            <Button
              variant="outline"
              onClick={() => gameClient.cancelTreaty(nation.id, proposal.id)}
            >
              Cancel
            </Button>
          </div>
          <ClauseList
            clauses={proposal.clauses}
            currentPlayerId={currentPlayerId}
            otherPlayerId={nation.id}
            technologies={technologies}
            cities={cities}
          />
        </div>
      ) : (
        <div className="mt-4">
          <TreatyBuilder
            currentPlayerId={currentPlayerId}
            nation={nation}
            currentPlayerGold={currentPlayerGold}
            technologies={technologies}
            researchedTechs={researchedTechs}
            cities={cities}
            clauses={draftClauses}
            onChange={setDraftClauses}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={draftClauses.length === 0}
              onClick={() => {
                gameClient.proposeTreaty(nation.id, draftClauses);
                setDraftClauses([]);
              }}
            >
              Propose treaty
            </Button>
            {nation.relation.state !== 'war' && (
              <Button variant="outline" onClick={() => gameClient.declareWar(nation.id)}>
                Declare war
              </Button>
            )}
            {!['war', 'no_contact', 'team'].includes(nation.relation.state) && (
              <Button variant="outline" onClick={() => gameClient.cancelDiplomaticPact(nation.id)}>
                Cancel pact
              </Button>
            )}
            {nation.relation.givesSharedVision && (
              <Button variant="outline" onClick={() => gameClient.cancelSharedVision(nation.id)}>
                Stop sharing vision
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  );
};

const clauseLabels: Record<TreatyClauseType, string> = {
  ceasefire: 'Ceasefire',
  peace: 'Peace',
  alliance: 'Alliance',
  embassy: 'Embassy',
  shared_vision: 'Shared vision',
  technology: 'Technology',
  gold: 'Gold',
  map: 'World map',
  seamap: 'Sea map',
  city: 'City',
};

const clauseAllowedForState = (
  type: TreatyClauseType,
  state: DiplomacyNation['relation']['state']
): boolean => {
  if (type === 'ceasefire') return state === 'war';
  if (type === 'peace') return state === 'war' || state === 'ceasefire';
  if (type === 'alliance') return state !== 'alliance' && state !== 'team';
  return state !== 'team';
};

const TreatyBuilder: React.FC<{
  currentPlayerId: string;
  nation: DiplomacyNation;
  currentPlayerGold: number;
  technologies: Record<string, Technology>;
  researchedTechs: Set<string>;
  cities: Record<string, City>;
  clauses: TreatyClause[];
  onChange: (clauses: TreatyClause[]) => void;
}> = ({
  currentPlayerId,
  nation,
  currentPlayerGold,
  technologies,
  researchedTechs,
  cities,
  clauses,
  onChange,
}) => {
  const [type, setType] = useState<TreatyClauseType>('peace');
  const [giverId, setGiverId] = useState(currentPlayerId);
  const [amount, setAmount] = useState('1');
  const eligibleTechnologies = useMemo(
    () =>
      Object.values(technologies)
        .filter(technology => giverId !== currentPlayerId || researchedTechs.has(technology.id))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [currentPlayerId, giverId, researchedTechs, technologies]
  );
  const eligibleCities = useMemo(
    () =>
      Object.values(cities)
        .filter(city => city.playerId === giverId)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [cities, giverId]
  );
  const [itemId, setItemId] = useState('');
  useEffect(() => {
    if (clauseAllowedForState(type, nation.relation.state)) return;
    const fallback = (Object.keys(clauseLabels) as TreatyClauseType[]).find(candidate =>
      clauseAllowedForState(candidate, nation.relation.state)
    );
    if (fallback) setType(fallback);
  }, [nation.relation.state, type]);
  const selectedItemId =
    type === 'technology'
      ? eligibleTechnologies.some(technology => technology.id === itemId)
        ? itemId
        : (eligibleTechnologies[0]?.id ?? '')
      : type === 'city'
        ? eligibleCities.some(city => city.id === itemId)
          ? itemId
          : (eligibleCities[0]?.id ?? '')
        : '';
  const numericAmount = Number(amount);
  const exceedsTreasury =
    type === 'gold' && giverId === currentPlayerId && numericAmount > currentPlayerGold;
  const canAdd =
    type === 'gold'
      ? Number.isInteger(numericAmount) && numericAmount > 0 && !exceedsTreasury
      : type === 'technology' || type === 'city'
        ? Boolean(selectedItemId)
        : true;

  const addClause = () => {
    let clause: TreatyClause;
    if (type === 'technology') {
      clause = { type, techId: selectedItemId, giverId };
    } else if (type === 'gold') {
      clause = { type, amount: numericAmount, giverId };
    } else if (type === 'city') {
      clause = { type, cityId: selectedItemId, giverId };
    } else {
      clause = { type, giverId };
    }
    onChange([...clauses, clause]);
  };

  return (
    <div className="rounded border border-gray-700 bg-gray-900/60 p-3">
      <p className="text-sm font-medium">Build a treaty</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-gray-300">
          Clause
          <select
            aria-label="Treaty clause"
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 p-2 text-sm"
            value={type}
            onChange={event => {
              setType(event.target.value as TreatyClauseType);
              setItemId('');
            }}
          >
            {Object.entries(clauseLabels)
              .filter(([value]) =>
                clauseAllowedForState(value as TreatyClauseType, nation.relation.state)
              )
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label className="text-xs text-gray-300">
          Given by
          <select
            aria-label="Clause giver"
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 p-2 text-sm"
            value={giverId}
            onChange={event => {
              setGiverId(event.target.value);
              setItemId('');
            }}
          >
            <option value={currentPlayerId}>You</option>
            <option value={nation.id}>{nation.civilization}</option>
          </select>
        </label>
      </div>

      {type === 'gold' && (
        <label className="mt-2 block text-xs text-gray-300">
          Gold amount
          <input
            aria-label="Gold amount"
            className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 p-2 text-sm"
            type="number"
            min={1}
            max={giverId === currentPlayerId ? currentPlayerGold : undefined}
            value={amount}
            onChange={event => setAmount(event.target.value)}
          />
          {exceedsTreasury && (
            <span className="mt-1 block text-red-300">You have only {currentPlayerGold} gold.</span>
          )}
        </label>
      )}

      {type === 'technology' && (
        <ItemSelect
          label="Technology"
          value={selectedItemId}
          emptyMessage={
            giverId === currentPlayerId
              ? 'You have no known technologies to offer.'
              : 'No technologies are available to request.'
          }
          options={eligibleTechnologies.map(technology => ({
            id: technology.id,
            label: technology.name,
          }))}
          onChange={setItemId}
        />
      )}

      {type === 'city' && (
        <ItemSelect
          label="City"
          value={selectedItemId}
          emptyMessage={
            giverId === currentPlayerId
              ? 'You have no cities to offer.'
              : 'No known cities are available to request.'
          }
          options={eligibleCities.map(city => ({ id: city.id, label: city.name }))}
          onChange={setItemId}
        />
      )}

      <Button className="mt-3" variant="outline" disabled={!canAdd} onClick={addClause}>
        Add clause
      </Button>

      {clauses.length > 0 && (
        <div className="mt-3 border-t border-gray-700 pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Draft clauses</p>
          <ClauseList
            clauses={clauses}
            currentPlayerId={currentPlayerId}
            otherPlayerId={nation.id}
            technologies={technologies}
            cities={cities}
            onRemove={index => onChange(clauses.filter((_, clauseIndex) => clauseIndex !== index))}
          />
        </div>
      )}
    </div>
  );
};

const ItemSelect: React.FC<{
  label: string;
  value: string;
  emptyMessage: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
}> = ({ label, value, emptyMessage, options, onChange }) => (
  <label className="mt-2 block text-xs text-gray-300">
    {label}
    {options.length > 0 ? (
      <select
        aria-label={label}
        className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 p-2 text-sm"
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        {options.map(option => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    ) : (
      <span className="mt-1 block rounded border border-gray-700 p-2 text-gray-400">
        {emptyMessage}
      </span>
    )}
  </label>
);

const ClauseList: React.FC<{
  clauses: TreatyClause[];
  currentPlayerId: string;
  otherPlayerId: string;
  technologies: Record<string, Technology>;
  cities: Record<string, City>;
  onRemove?: (index: number) => void;
}> = ({ clauses, currentPlayerId, otherPlayerId, technologies, cities, onRemove }) => (
  <ul className="mt-2 space-y-1 text-sm">
    {clauses.map((clause, index) => {
      const giver =
        clause.giverId === currentPlayerId
          ? 'You give'
          : clause.giverId === otherPlayerId
            ? 'They give'
            : 'Agreement';
      const detail =
        clause.type === 'technology'
          ? (technologies[clause.techId]?.name ?? clause.techId)
          : clause.type === 'gold'
            ? `${clause.amount} gold`
            : clause.type === 'city'
              ? (cities[clause.cityId]?.name ?? clause.cityId)
              : clauseLabels[clause.type];
      return (
        <li
          className="flex items-center justify-between gap-2 rounded bg-gray-950/60 px-2 py-1.5"
          key={`${clause.type}-${index}`}
        >
          <span>
            <span className="text-gray-400">{giver}:</span> {detail}
          </span>
          {onRemove && (
            <button
              className="text-xs text-red-300 hover:text-red-200"
              type="button"
              aria-label={`Remove ${detail}`}
              onClick={() => onRemove(index)}
            >
              Remove
            </button>
          )}
        </li>
      );
    })}
  </ul>
);
