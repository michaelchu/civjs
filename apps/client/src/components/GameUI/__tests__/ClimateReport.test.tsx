import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Tile } from '../../../types';
import { ClimateReport } from '../ClimateReport';

const tiles: Record<string, Tile> = {
  '0,0': { x: 0, y: 0, terrain: 'grassland', known: true, visible: true, elevation: 1, riverMask: 1 },
  '1,0': { x: 1, y: 0, terrain: 'ocean', known: true, visible: true, elevation: 0 },
  '0,1': { x: 0, y: 1, terrain: 'hills', known: true, visible: true, elevation: 3 },
  '1,1': { x: 1, y: 1, terrain: 'desert', known: false, visible: false, elevation: 2 },
};

describe('ClimateReport', () => {
  it('summarizes observable terrain signals and states telemetry gaps', () => {
    render(<ClimateReport open onOpenChange={vi.fn()} tiles={tiles} mapWidth={2} mapHeight={2} />);

    expect(screen.getByRole('heading', { name: 'Climate and terrain' })).toBeInTheDocument();
    expect(screen.getByText('Climate telemetry unavailable')).toBeInTheDocument();
    expect(screen.getByText('Terrain distribution')).toBeInTheDocument();
    expect(screen.getByText('Known water')).toBeInTheDocument();
    expect(screen.getByText('Grassland')).toBeInTheDocument();
  });

  it('shows an empty state when no known map tiles exist', () => {
    render(<ClimateReport open onOpenChange={vi.fn()} tiles={{}} mapWidth={4} mapHeight={4} />);
    expect(screen.getByText('Terrain data is not available yet.')).toBeInTheDocument();
    expect(screen.getAllByText('No known tiles').length).toBeGreaterThan(0);
  });
});
