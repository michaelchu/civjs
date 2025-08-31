import React from 'react';
import { useGameStore } from '../../store/gameStore';

export const TurnStatusOverlay: React.FC = () => {
  const { turnProcessingState, turnProcessingSteps } = useGameStore();

  if (!turnProcessingState || turnProcessingState === 'idle') {
    return null;
  }

  return (
    <div className="fixed top-4 left-4 z-50 bg-gray-900 bg-opacity-90 text-white rounded-lg p-4 min-w-64 shadow-lg border border-gray-600">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
        <h3 className="text-sm font-semibold">Processing Turn</h3>
      </div>

      <div className="space-y-2">
        {turnProcessingSteps.map(step => (
          <div key={step.id} className="flex items-center gap-2 text-xs">
            <div className="w-4 h-4 flex items-center justify-center">
              {step.completed ? (
                <div className="w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
                  <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              ) : step.active ? (
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
              ) : (
                <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
              )}
            </div>
            <span
              className={`${
                step.completed ? 'text-green-400' : step.active ? 'text-blue-400' : 'text-gray-400'
              }`}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {turnProcessingState === 'completed' && (
        <div className="mt-3 pt-2 border-t border-gray-600">
          <div className="text-xs text-green-400 flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            Turn processed successfully!
          </div>
        </div>
      )}
    </div>
  );
};
