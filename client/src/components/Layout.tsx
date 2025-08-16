import { type ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
  connected: boolean;
  error: string | null;
  onClearError: () => void;
}

export default function Layout({
  children,
  connected,
  error,
  onClearError,
}: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Global error banner */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 p-3">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <span className="text-red-800 text-sm">{error}</span>
            <button
              onClick={onClearError}
              className="text-red-600 hover:text-red-800 font-bold text-lg"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Connection status bar */}
      <div className="bg-gray-800 text-white p-2">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-sm">
          <div className="flex items-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-green-400' : 'bg-red-400'
              }`}
            />
            <span>
              {connected ? 'Connected to server' : 'Disconnected from server'}
            </span>
          </div>
          <div className="text-gray-400">
            CivJS - Browser-based Civilization Game
          </div>
        </div>
      </div>

      {/* Main content */}
      <main>{children}</main>
    </div>
  );
}
