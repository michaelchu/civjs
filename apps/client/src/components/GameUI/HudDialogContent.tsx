import React from 'react';
import { DialogContent } from '../ui/dialog';
import { cn } from '../../lib/utils';

/**
 * Shared elevated surface for dense HUD reports. Reports remain intentionally
 * more opaque than passive map overlays so tables and charts stay readable.
 */
export const HudDialogContent: React.FC<React.ComponentProps<typeof DialogContent>> = ({
  className,
  ...props
}) => (
  <DialogContent
    className={cn(
      'border-white/15 bg-slate-900/95 text-white shadow-2xl backdrop-blur-xl',
      className
    )}
    {...props}
  />
);
