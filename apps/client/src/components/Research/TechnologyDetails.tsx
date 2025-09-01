import React from 'react';
import { X, ExternalLink, Zap, Clock, Target } from 'lucide-react';
import { TECHNOLOGIES } from './utils/technologyData';
import { useGameStore } from '../../store/gameStore';
import { cn } from '../../lib/utils';

interface TechnologyDetailsProps {
  techId: string;
  onClose: () => void;
}

export const TechnologyDetails: React.FC<TechnologyDetailsProps> = ({ techId, onClose }) => {
  const store = useGameStore();
  const { setCurrentResearch, setResearchGoal } = store;
  const tech = TECHNOLOGIES[techId];

  if (!tech) {
    return null;
  }

  const researchState = store.research;
  const isResearched = researchState?.researchedTechs.has(techId) || false;
  const isCurrent = researchState?.currentTech === techId;
  const isGoal = researchState?.techGoal === techId;
  const canResearch =
    researchState?.availableTechs.has(techId) ||
    (!isResearched &&
      tech.requirements.every(req => researchState?.researchedTechs.has(req) || false));

  const handleSetCurrentResearch = () => {
    if (canResearch && !isResearched) {
      setCurrentResearch(techId);
      onClose();
    }
  };

  const handleSetResearchGoal = () => {
    if (!isResearched) {
      setResearchGoal(techId);
      onClose();
    }
  };

  const handleWikipediaClick = () => {
    // Open Wikipedia page for the technology (following freeciv-web pattern)
    const wikipediaUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(tech.name)}`;
    window.open(wikipediaUrl, '_blank', 'noopener,noreferrer');
  };

  const getRequirementText = (reqId: string): string => {
    const reqTech = TECHNOLOGIES[reqId];
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
    <div className="absolute top-4 right-4 w-80 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-600">
        <h3 className="text-lg font-bold text-white">{tech.name}</h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
        {/* Status */}
        <div className="flex items-center space-x-2">
          {isResearched && (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-green-700 text-white rounded">
              ✓ Researched
            </span>
          )}
          {isCurrent && (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded">
              <Zap size={12} className="mr-1" />
              Current
            </span>
          )}
          {isGoal && (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-purple-600 text-white rounded">
              <Target size={12} className="mr-1" />
              Goal
            </span>
          )}
        </div>

        {/* Progress (if current research) */}
        {progressInfo && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-gray-300">
              <span>Research Progress</span>
              <span>{progressInfo.progress}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressInfo.progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-gray-400">
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
          <h4 className="text-sm font-semibold text-gray-300 mb-2">Description</h4>
          <p className="text-sm text-gray-400 leading-relaxed">{tech.description}</p>
        </div>

        {/* Cost */}
        <div>
          <h4 className="text-sm font-semibold text-gray-300 mb-1">Research Cost</h4>
          <p className="text-sm text-gray-400">{tech.cost} research points</p>
        </div>

        {/* Requirements */}
        {tech.requirements.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-300 mb-2">Prerequisites</h4>
            <div className="space-y-1">
              {tech.requirements.map(reqId => {
                const isReqResearched = researchState?.researchedTechs.has(reqId) || false;
                return (
                  <div
                    key={reqId}
                    className={cn(
                      'text-sm px-2 py-1 rounded',
                      isReqResearched ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'
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
        {tech.flags.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-300 mb-2">Special Properties</h4>
            <div className="space-y-1">
              {tech.flags.map(flag => (
                <span
                  key={flag}
                  className="inline-block text-xs px-2 py-1 bg-yellow-900 text-yellow-200 rounded mr-2"
                >
                  {flag === 'bonus_tech' && 'Grants free technology'}
                  {flag === 'bridge' && 'Enables bridge building'}
                  {flag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex space-x-2 pt-2 border-t border-gray-600">
          {canResearch && !isResearched && (
            <button
              onClick={handleSetCurrentResearch}
              disabled={isCurrent}
              className={cn(
                'flex-1 px-3 py-2 text-sm font-medium rounded transition-colors',
                isCurrent
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              )}
            >
              {isCurrent ? 'Currently Researching' : 'Research Now'}
            </button>
          )}

          {!isResearched && (
            <button
              onClick={handleSetResearchGoal}
              disabled={isGoal}
              className={cn(
                'flex-1 px-3 py-2 text-sm font-medium rounded transition-colors',
                isGoal
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-700 text-white'
              )}
            >
              {isGoal ? 'Current Goal' : 'Set as Goal'}
            </button>
          )}

          <button
            onClick={handleWikipediaClick}
            className="px-3 py-2 text-sm font-medium bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
            title="View on Wikipedia"
          >
            <ExternalLink size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
