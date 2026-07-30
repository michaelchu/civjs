import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameHud } from '../GameHud';
import { HudPanel } from '../HudPanel';

describe('GameHud foundations', () => {
  it('renders named regions without intercepting pointer events outside controls', () => {
    const { container } = render(
      <GameHud
        top={<HudPanel>Top controls</HudPanel>}
        left={<HudPanel>Left panel</HudPanel>}
        right={<HudPanel>Right panel</HudPanel>}
        bottomLeft={<HudPanel>Minimap</HudPanel>}
        bottomCenter={<HudPanel>Selection</HudPanel>}
        bottomRight={<HudPanel>Turn actions</HudPanel>}
      />
    );

    expect(container.querySelector('[data-game-hud]')).toHaveClass('pointer-events-none');
    expect(container.querySelectorAll('[data-hud-region]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-hud-region] > div.pointer-events-auto')).toHaveLength(
      6
    );
    expect(container.querySelector('[data-hud-region="bottom-center"]')).toHaveClass(
      'bottom-28',
      'sm:bottom-4'
    );
  });

  it('uses the shared transparent surface treatment by default', () => {
    const { container } = render(<HudPanel>Surface</HudPanel>);

    expect(container.querySelector('[data-hud-panel]')).toHaveClass('hud-surface');
  });
});
