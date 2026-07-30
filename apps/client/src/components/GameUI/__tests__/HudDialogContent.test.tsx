import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogDescription, DialogTitle } from '../../ui/dialog';
import { HudDialogContent } from '../HudDialogContent';

describe('HudDialogContent', () => {
  it('provides the shared readable elevated report surface', () => {
    render(
      <Dialog open>
        <HudDialogContent>
          <DialogTitle>Report</DialogTitle>
          <DialogDescription>Report details</DialogDescription>
          Report content
        </HudDialogContent>
      </Dialog>
    );

    expect(screen.getByRole('dialog')).toHaveClass(
      'bg-slate-900/95',
      'border-white/15',
      'backdrop-blur-xl'
    );
  });
});
