import React from 'react';
import { useGameStore } from '../../store/gameStore';

export const NotificationFeed: React.FC = () => {
  const { notifications, dismissNotification } = useGameStore();
  if (notifications.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-3 top-14 z-[1200] grid w-80 gap-2"
      aria-live="polite"
    >
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`pointer-events-auto flex items-start justify-between gap-3 rounded border p-3 text-sm shadow-lg ${
            notification.tone === 'error'
              ? 'border-red-600 bg-red-950'
              : notification.tone === 'success'
                ? 'border-green-600 bg-green-950'
                : 'border-blue-600 bg-blue-950'
          }`}
        >
          <span>{notification.message}</span>
          <button
            aria-label="Dismiss notification"
            className="text-lg leading-none text-gray-300 hover:text-white"
            onClick={() => dismissNotification(notification.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};
