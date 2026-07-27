import { useEffect } from 'react';

export interface ActionFeedback {
  success: boolean;
  message: string;
}

interface ActionFeedbackBannerProps {
  feedback: ActionFeedback | null;
  onDismiss: () => void;
  durationMs?: number;
}

export function ActionFeedbackBanner({
  feedback,
  onDismiss,
  durationMs = 3000,
}: ActionFeedbackBannerProps) {
  useEffect(() => {
    if (!feedback) return;

    const timeout = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timeout);
  }, [durationMs, feedback, onDismiss]);

  if (!feedback) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`absolute left-1/2 top-3 z-[1100] -translate-x-1/2 rounded px-3 py-2 text-sm font-medium shadow ${
        feedback.success ? 'bg-green-700 text-white' : 'bg-red-700 text-white'
      }`}
    >
      {feedback.message}
    </div>
  );
}
