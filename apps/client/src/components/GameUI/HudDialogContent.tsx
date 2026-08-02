/**
 * @module client/components/GameUI/HudDialogContent
 * Defines the Hud Dialog Content client UI component.
 */
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
      'hud-dialog z-[2000] flex h-[min(88vh,56rem)] max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-y-auto border-white/15 bg-slate-900/90 p-4 text-white shadow-2xl backdrop-blur-xl sm:h-[min(88vh,56rem)] sm:w-[75vw] sm:max-w-[75vw] sm:p-6',
      className
    )}
    {...props}
  />
);
