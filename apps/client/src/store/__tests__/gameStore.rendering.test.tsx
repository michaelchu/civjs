import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../gameStore';

describe('game store React subscriptions', () => {
  beforeEach(() => {
    useGameStore.setState({
      clientState: 'initial',
      map: { width: 0, height: 0, tiles: {} },
    });
  });

  it('does not rerender a narrow session consumer for unrelated map packets', () => {
    let renders = 0;
    const SessionConsumer = () => {
      const clientState = useGameStore(state => state.clientState);
      renders += 1;
      return <span>{clientState}</span>;
    };

    const view = render(<SessionConsumer />);
    expect(renders).toBe(1);

    act(() => {
      useGameStore.getState().updateGameState({
        map: {
          width: 1,
          height: 1,
          tiles: {
            '0,0': {
              x: 0,
              y: 0,
              terrain: 'ocean',
              known: true,
              visible: true,
            },
          },
        },
      });
    });
    expect(renders).toBe(1);

    act(() => useGameStore.getState().setClientState('connecting'));
    expect(renders).toBe(2);
    expect(view.getByText('connecting')).toBeInTheDocument();
  });
});
