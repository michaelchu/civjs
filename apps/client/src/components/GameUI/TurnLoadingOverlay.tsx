import React from 'react';

interface TurnProgressEvent {
  stage: string;
  message: string;
  progress: number;
  actionType?: string;
  error?: string;
}

interface TurnLoadingOverlayProps {
  isVisible: boolean;
  progress: TurnProgressEvent | null;
  onCancel?: () => void;
}

export const TurnLoadingOverlay: React.FC<TurnLoadingOverlayProps> = ({
  isVisible,
  progress,
  onCancel,
}) => {
  if (!isVisible) return null;

  const getStageDisplayName = (stage: string): string => {
    switch (stage) {
      case 'processing_actions':
        return 'Processing Player Actions';
      case 'ai_processing':
        return 'AI Computing Moves';
      case 'world_update':
        return 'Updating World State';
      default:
        return stage.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  };

  const getProgressColor = (progress: number): string => {
    if (progress < 0.3) return 'bg-blue-500';
    if (progress < 0.6) return 'bg-yellow-500';
    if (progress < 0.9) return 'bg-orange-500';
    return 'bg-green-500';
  };

  const progressPercent = progress ? Math.round(progress.progress * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full mx-4 border border-gray-600">
        {/* Header */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">Processing Turn</h2>
          <p className="text-gray-300">Please wait while the game processes your actions...</p>
        </div>

        {/* Progress Information */}
        {progress && (
          <div className="mb-6">
            {/* Current Stage */}
            <div className="text-center mb-4">
              <h3 className="text-lg font-semibold text-white mb-1">
                {getStageDisplayName(progress.stage)}
              </h3>
              <p className="text-gray-400 text-sm">{progress.message}</p>
              {progress.actionType && (
                <p className="text-blue-400 text-xs mt-1">Action: {progress.actionType}</p>
              )}
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-700 rounded-full h-3 mb-3">
              <div
                className={`h-3 rounded-full transition-all duration-500 ${getProgressColor(progress.progress)}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Progress Text */}
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Progress: {progressPercent}%</span>
              <span className="text-gray-400">
                {progress.progress >= 1 ? 'Completing...' : 'Processing...'}
              </span>
            </div>

            {/* Error Display */}
            {progress.error && (
              <div className="mt-4 p-3 bg-red-900 border border-red-600 rounded">
                <p className="text-red-200 text-sm">
                  <span className="font-semibold">Error:</span> {progress.error}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Loading Animation */}
        {!progress && (
          <div className="text-center mb-6">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white mb-4"></div>
            <p className="text-gray-400">Initializing turn resolution...</p>
          </div>
        )}

        {/* Tips */}
        <div className="bg-gray-700 rounded p-4 mb-4">
          <h4 className="text-white font-semibold mb-2 flex items-center">
            <span className="mr-2">💡</span>
            Turn Resolution
          </h4>
          <ul className="text-gray-300 text-sm space-y-1">
            <li>• All your actions are processed simultaneously</li>
            <li>• AI players compute their moves</li>
            <li>• World events and production complete</li>
            <li>• The new turn begins automatically</li>
          </ul>
        </div>

        {/* Cancel Button (optional) */}
        {onCancel && progress && progress.progress < 0.5 && (
          <div className="text-center">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium transition-colors"
              disabled={progress.progress >= 0.5}
            >
              Cancel Turn Resolution
            </button>
            <p className="text-gray-500 text-xs mt-2">
              Only available during early processing stages
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
