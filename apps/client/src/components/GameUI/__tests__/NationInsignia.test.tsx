import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NationInsignia } from '../NationInsignia';

describe('NationInsignia', () => {
  it('renders a future-asset-compatible badge placeholder from color and name', () => {
    const { container } = render(
      <NationInsignia color="#22c55e" name="Holy Roman Empire" size="lg" />
    );
    const insignia = container.firstElementChild as HTMLElement;

    expect(insignia).toHaveClass('h-9', 'w-9', 'rounded-md');
    expect(insignia).toHaveTextContent('HR');
    expect(insignia).toHaveStyle({ backgroundColor: '#22c55e' });
  });

  it('supports compact dot markers without initials', () => {
    const { container } = render(
      <NationInsignia color="#38bdf8" name="Romans" size="sm" shape="dot" />
    );
    const insignia = container.firstElementChild as HTMLElement;

    expect(insignia).toHaveClass('h-2', 'w-2', 'rounded-full');
    expect(insignia).toHaveTextContent('');
  });

  it('uses dark text on light nation colors', () => {
    const { container } = render(<NationInsignia color="#fef08a" name="Yellow Nation" size="lg" />);

    expect(container.firstElementChild).toHaveStyle({ color: '#0f172a' });
  });
});
