/**
 * @module client/components/GameUI/HudPanel
 * Defines the Hud Panel client UI component.
 */
import * as React from 'react';
import { cn } from '../../lib/utils';

export type HudPanelVariant = 'default' | 'elevated' | 'active' | 'opaque';

export interface HudPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: HudPanelVariant;
}

const variantClasses: Record<HudPanelVariant, string> = {
  default: 'hud-surface',
  elevated: 'hud-surface hud-surface-elevated',
  active: 'hud-surface hud-surface-active',
  opaque: 'hud-surface hud-surface-opaque',
};

/** Shared surface for map overlays. It is intentionally presentational only. */
export const HudPanel = React.forwardRef<HTMLDivElement, HudPanelProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <div
      ref={ref}
      data-hud-panel
      className={cn('rounded-xl border text-white shadow-lg', variantClasses[variant], className)}
      {...props}
    />
  )
);

HudPanel.displayName = 'HudPanel';
