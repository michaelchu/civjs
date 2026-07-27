import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionFeedbackBanner } from '../ActionFeedbackBanner';

describe('ActionFeedbackBanner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dismisses transient action feedback after three seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(
      <ActionFeedbackBanner
        feedback={{ success: true, message: 'Unit will continue next turn' }}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Unit will continue next turn');

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('restarts the timeout when newer feedback replaces the message', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <ActionFeedbackBanner
        feedback={{ success: true, message: 'First action' }}
        onDismiss={onDismiss}
      />
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender(
      <ActionFeedbackBanner
        feedback={{ success: true, message: 'Second action' }}
        onDismiss={onDismiss}
      />
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
