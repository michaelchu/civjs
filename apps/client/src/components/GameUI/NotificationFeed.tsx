/**
 * @module client/components/GameUI/NotificationFeed
 * Defines the Notification Feed client UI component.
 */
import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';

export const NotificationFeed: React.FC = () => {
  const notifications = useGameStore(state => state.notifications);
  const dismissNotification = useGameStore(state => state.dismissNotification);
  if (notifications.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-3 top-14 z-[1200] grid w-80 gap-2"
      aria-label="Notifications"
    >
      {notifications.map(notification =>
        (() => {
          const Icon =
            notification.tone === 'error'
              ? AlertCircle
              : notification.tone === 'success'
                ? CheckCircle2
                : Info;
          const toneClass =
            notification.tone === 'error'
              ? 'border-red-300/30 bg-red-950/80 text-red-50 backdrop-blur-md'
              : notification.tone === 'success'
                ? 'border-green-300/30 bg-green-950/80 text-green-50 backdrop-blur-md'
                : 'border-blue-300/30 bg-blue-950/80 text-blue-50 backdrop-blur-md';
          return (
            <div
              key={notification.id}
              role={notification.tone === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex items-start justify-between gap-3 rounded-xl border p-3 text-sm shadow-lg ${toneClass}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{notification.message}</span>
              <button
                aria-label="Dismiss notification"
                className="shrink-0 rounded p-0.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                onClick={() => dismissNotification(notification.id)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })()
      )}
    </div>
  );
};
