/**
 * @module client/components/Research/TechnologyDetails
 * Defines the Technology Details research UI component.
 */
import React from 'react';
import { X, ExternalLink, Zap, Clock, Target } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { cn } from '../../lib/utils';
import { gameClient } from '../../services/GameClient';

interface TechnologyDetailsProps {
  techId: string;
  onClose: () => void;
}

export const TechnologyDetails: React.FC<TechnologyDetailsProps> = ({ techId, onClose }) => {
  const researchState = useGameStore(state => state.research);
  const technologies = useGameStore(state => state.technologies);
  const [requestState, setRequestState] = React.useState<{
    pending: boolean;
    error?: string;
  }>({ pending: false });
  const tech = technologies[techId];

  if (!tech) {
    return null;
  }

  const isResearched = researchState?.researchedTechs.has(techId) || false;
  const isCurrent = researchState?.currentTech === techId;
  const isGoal = researchState?.techGoal === techId;
  const canResearch =
    researchState?.availableTechs.has(techId) ||
    (!isResearched &&
      tech.requirements.every(req => researchState?.researchedTechs.has(req) || false));

  const handleSetCurrentResearch = async () => {
    if (canResearch && !isResearched) {
      setRequestState({ pending: true });
      try {
        await gameClient.setResearch(techId);
        onClose();
      } catch (error) {
        setRequestState({
          pending: false,
          error: error instanceof Error ? error.message : 'Failed to set research',
        });
      }
    }
  };

  const handleSetResearchGoal = async () => {
    if (!isResearched) {
      setRequestState({ pending: true });
      try {
        await gameClient.setResearchGoal(techId);
        onClose();
      } catch (error) {
        setRequestState({
          pending: false,
          error: error instanceof Error ? error.message : 'Failed to set research goal',
        });
      }
    }
  };

  const handleWikipediaClick = () => {
    // Open Wikipedia page for the technology (following freeciv-web pattern)
    const wikipediaUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(tech.name)}`;
    window.open(wikipediaUrl, '_blank', 'noopener,noreferrer');
  };

  const getRequirementText = (reqId: string): string => {
    const reqTech = technologies[reqId];
    return reqTech ? reqTech.name : reqId;
  };

  const getProgressInfo = () => {
    if (!isCurrent || !researchState) {
      return null;
    }

    const progress = Math.round((researchState.bulbsAccumulated / tech.cost) * 100);
    const remaining = tech.cost - researchState.bulbsAccumulated;
    const turnsRemaining =
      researchState.bulbsLastTurn > 0 ? Math.ceil(remaining / researchState.bulbsLastTurn) : -1;

    return {
      progress,
      remaining,
      turnsRemaining,
    };
  };

  const progressInfo = getProgressInfo();

  return (
    <div className="hud-surface-opaque absolute top-4 right-4 z-50 w-80 rounded-xl border border-white/10 text-slate-100 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <h3 className="text-lg font-bold text-slate-100">{tech.name}</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
          aria-label="Close technology details"
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="max-h-96 space-y-4 overflow-y-auto p-4">
        {requestState.error && (
          <div
            role="alert"
            className="rounded border border-red-600 bg-red-950 p-2 text-sm text-red-200"
          >
            {requestState.error}
          </div>
        )}
        {/* Status */}
        <div className="flex items-center space-x-2">
          {isResearched && (
            <span className="inline-flex items-center rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-200">
              ✓ Researched
            </span>
          )}
          {isCurrent && (
            <span className="inline-flex items-center rounded border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-xs font-medium text-cyan-200">
              <Zap size={12} className="mr-1" />
              Current
            </span>
          )}
          {isGoal && (
            <span className="inline-flex items-center rounded border border-violet-300/20 bg-violet-400/10 px-2 py-1 text-xs font-medium text-violet-200">
              <Target size={12} className="mr-1" />
              Goal
            </span>
          )}
        </div>

        {/* Progress (if current research) */}
        {progressInfo && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span>Research Progress</span>
              <span>{progressInfo.progress}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-white/10">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 transition-all duration-300"
                style={{ width: `${progressInfo.progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                {researchState?.bulbsAccumulated} / {tech.cost} bulbs
              </span>
              {progressInfo.turnsRemaining > 0 && (
                <span className="flex items-center">
                  <Clock size={12} className="mr-1" />
                  {progressInfo.turnsRemaining} turns
                </span>
              )}
            </div>
          </div>
        )}

        {/* Description */}
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-300">Description</h4>
          <p className="text-sm leading-relaxed text-slate-400">
            {tech.description || 'No ruleset description is available.'}
          </p>
        </div>

        {/* Cost */}
        <div>
          <h4 className="mb-1 text-sm font-semibold text-slate-300">Research Cost</h4>
          <p className="text-sm text-slate-400">{tech.cost} research points</p>
        </div>

        {/* Requirements */}
        {tech.requirements.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-300">Prerequisites</h4>
            <div className="space-y-1">
              {tech.requirements.map(reqId => {
                const isReqResearched = researchState?.researchedTechs.has(reqId) || false;
                return (
                  <div
                    key={reqId}
                    className={cn(
                      'rounded px-2 py-1 text-sm',
                      isReqResearched
                        ? 'border border-emerald-300/20 bg-emerald-400/10 text-emerald-200'
                        : 'border border-rose-300/20 bg-rose-400/10 text-rose-200'
                    )}
                  >
                    {isReqResearched ? '✓' : '✗'} {getRequirementText(reqId)}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Special flags */}
        {(tech.flags?.length ?? 0) > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-300">Special Properties</h4>
            <div className="space-y-1">
              {tech.flags?.map(flag => (
                <span
                  key={flag}
                  className="mr-2 inline-block rounded border border-amber-300/20 bg-amber-400/10 px-2 py-1 text-xs text-amber-200"
                >
                  {flag.toLowerCase() === 'bonus_tech' && 'Grants free technology: '}
                  {flag.toLowerCase() === 'bridge' && 'Enables bridge building: '}
                  {flag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex space-x-2 border-t border-white/10 pt-2">
          {canResearch && !isResearched && (
            <button
              type="button"
              onClick={() => void handleSetCurrentResearch()}
              disabled={requestState.pending || isCurrent}
              className={cn(
                'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70',
                isCurrent
                  ? 'cursor-not-allowed bg-white/10 text-slate-500'
                  : 'bg-cyan-400/20 text-cyan-100 hover:bg-cyan-400/30'
              )}
            >
              {isCurrent ? 'Currently Researching' : 'Research Now'}
            </button>
          )}

          {!isResearched && (
            <button
              type="button"
              onClick={() => void handleSetResearchGoal()}
              disabled={requestState.pending || isGoal}
              className={cn(
                'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70',
                isGoal
                  ? 'cursor-not-allowed bg-white/10 text-slate-500'
                  : 'bg-violet-400/20 text-violet-100 hover:bg-violet-400/30'
              )}
            >
              {isGoal ? 'Current Goal' : 'Set as Goal'}
            </button>
          )}

          <button
            type="button"
            onClick={handleWikipediaClick}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
            title="View on Wikipedia"
            aria-label={`View ${tech.name} on Wikipedia`}
          >
            <ExternalLink size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
