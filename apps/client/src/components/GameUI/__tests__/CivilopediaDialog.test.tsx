import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Technology } from '../../../types';
import { useGameStore } from '../../../store/gameStore';
import { CivilopediaDialog } from '../CivilopediaDialog';

const technologies: Record<string, Technology> = {
  writing: {
    id: 'writing',
    name: 'Writing',
    cost: 20,
    requirements: [],
    discovered: true,
    description: 'Enables written knowledge.',
  },
};

describe('CivilopediaDialog', () => {
  it('shows searchable command topics and technology entries', () => {
    useGameStore.setState({
      research: {
        bulbsAccumulated: 0,
        bulbsLastTurn: 0,
        researchedTechs: new Set(['writing']),
        availableTechs: new Set(),
        futureTechs: 0,
      },
    });
    render(<CivilopediaDialog open onOpenChange={vi.fn()} technologies={technologies} />);

    expect(screen.getByRole('heading', { name: 'Civilopedia' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Command controls' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search Civilopedia' }), {
      target: { value: 'combat' },
    });
    expect(screen.getByRole('heading', { name: 'Combat and war calculator' })).toBeInTheDocument();
    expect(screen.queryByText('Command controls')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search Civilopedia' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Technology/ }));
    expect(screen.getByRole('button', { name: /Writing/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Writing Technology/ }));
    expect(screen.getByText('Researched')).toBeInTheDocument();
  });

  it('opens the research screen from the technology reference', () => {
    const onOpenChange = vi.fn();
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    useGameStore.setState({
      activeTab: 'map',
      research: {
        bulbsAccumulated: 0,
        bulbsLastTurn: 0,
        researchedTechs: new Set(),
        availableTechs: new Set(),
        futureTechs: 0,
      },
    });
    render(<CivilopediaDialog open onOpenChange={onOpenChange} technologies={technologies} />);

    fireEvent.click(screen.getByRole('button', { name: /^Technology/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Research' }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'open-report', detail: { report: 'research' } })
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
