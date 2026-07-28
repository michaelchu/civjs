import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { City } from '../../../types';
import { CityInfoOverlay } from '../CityInfoOverlay';

const idleCity = {
  id: 'city-1',
  name: 'Roma',
  playerId: 'player-1',
  x: 4,
  y: 5,
  size: 2,
  food: 2,
  shields: 2,
  trade: 1,
  history: 0,
  prod: { food: 4, shields: 2, trade: 1, gold: 1, luxury: 0, science: 0 },
  surplus: { food: 0, shields: 2, trade: 1, gold: 1, luxury: 0, science: 0 },
  waste: { shields: 0, trade: 0 },
  foodStock: 4,
  granarySize: 20,
  granaryTurns: 8,
  citizens: { happy: 0, content: 2, unhappy: 0, angry: 0, specialists: {} },
  buildings: [],
  presentUnits: [],
  supportedUnits: [],
  worklist: [],
  tradeRoutes: [],
  celebrating: false,
  disorder: false,
  pollution: 0,
} as City;

describe('CityInfoOverlay production', () => {
  it('displays an empty granary as zero rather than missing data', () => {
    render(<CityInfoOverlay city={{ ...idleCity, foodStock: 0 }} isOpen onClose={vi.fn()} />);

    expect(screen.getByText('0/20')).toBeInTheDocument();
  });

  it('keeps the production chooser visible when the city is idle', () => {
    render(
      <CityInfoOverlay
        city={idleCity}
        isOpen
        onClose={vi.fn()}
        availableProductions={[
          {
            id: 'warriors',
            name: 'Warriors',
            type: 'unit',
            cost: 10,
            available: true,
          },
        ]}
        onProductionChange={vi.fn()}
      />
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Production/ }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.getByText('This city is idle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change/ })).toBeEnabled();
  });

  it('keeps long production choices within a scrollable viewport menu', () => {
    render(
      <CityInfoOverlay
        city={idleCity}
        isOpen
        onClose={vi.fn()}
        availableProductions={[
          {
            id: 'worker',
            name: 'Workers',
            type: 'unit',
            cost: 30,
            available: true,
          },
        ]}
        onProductionChange={vi.fn()}
      />
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Production/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.keyDown(screen.getByRole('button', { name: /Change/ }), { key: 'ArrowDown' });

    expect(screen.getByRole('menu')).toHaveClass(
      'max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))]',
      'overflow-y-auto',
      'overscroll-contain'
    );
  });

  it('hides production choices the city cannot build yet', () => {
    render(
      <CityInfoOverlay
        city={idleCity}
        isOpen
        onClose={vi.fn()}
        availableProductions={[
          {
            id: 'warriors',
            name: 'Warriors',
            type: 'unit',
            cost: 10,
            available: true,
          },
          {
            id: 'engineers',
            name: 'Engineers',
            type: 'unit',
            cost: 40,
            available: false,
          },
        ]}
        onProductionChange={vi.fn()}
      />
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Production/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.keyDown(screen.getByRole('button', { name: /Change/ }), { key: 'ArrowDown' });

    expect(screen.getByRole('menuitem', { name: /Warriors/ })).toBeInTheDocument();
    expect(screen.queryByText('Engineers')).not.toBeInTheDocument();
    expect(screen.queryByText('Buildings')).not.toBeInTheDocument();
    expect(screen.queryByText('Wonders')).not.toBeInTheDocument();
  });

  it('labels Wealth as a conversion instead of a 999-shield project', () => {
    render(
      <CityInfoOverlay
        city={idleCity}
        isOpen
        onClose={vi.fn()}
        availableProductions={[
          {
            id: 'capitalization',
            name: 'Wealth',
            type: 'building',
            cost: 999,
            conversion: true,
            description: 'Converts shields to gold while selected',
            available: true,
          },
        ]}
        onProductionChange={vi.fn()}
      />
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Production/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.keyDown(screen.getByRole('button', { name: /Change/ }), { key: 'ArrowDown' });

    expect(screen.getByRole('menuitem', { name: /Wealth/ })).toBeInTheDocument();
    expect(screen.getByText('Converts shields to gold while selected')).toBeInTheDocument();
    expect(screen.queryByText('Conversion')).not.toBeInTheDocument();
    expect(screen.queryByText('999 shields')).not.toBeInTheDocument();
  });

  it('renders active Wealth without progress or a completion countdown', () => {
    render(
      <CityInfoOverlay
        city={{
          ...idleCity,
          production: {
            target: 'Wealth',
            type: 'building',
            progress: 0,
            cost: 999,
            turnsToComplete: 200,
            conversion: true,
          },
        }}
        isOpen
        onClose={vi.fn()}
        availableProductions={[
          {
            id: 'capitalization',
            name: 'Wealth',
            type: 'building',
            cost: 999,
            conversion: true,
            available: true,
          },
        ]}
      />
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Production/ }), {
      button: 0,
      ctrlKey: false,
    });

    expect(
      screen.getByText("Converts this city's shield production to gold each turn.")
    ).toBeInTheDocument();
    expect(screen.queryByText('0 / 999')).not.toBeInTheDocument();
    expect(screen.queryByText('Turns remaining:')).not.toBeInTheDocument();
  });

  it('shows an actionable production loading failure', () => {
    const retry = vi.fn();
    render(
      <CityInfoOverlay
        city={idleCity}
        isOpen
        onClose={vi.fn()}
        productionError="Production choices could not be loaded"
        onRetryProductions={retry}
      />
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Production/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(retry).toHaveBeenCalledOnce();
  });
});
