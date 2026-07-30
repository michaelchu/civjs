import * as React from 'react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

export interface HudIconButtonProps extends React.ComponentProps<typeof Button> {
  label: string;
}

/** Compact HUD action that keeps keyboard focus and an accessible label visible. */
export const HudIconButton = React.forwardRef<HTMLButtonElement, HudIconButtonProps>(
  ({ className, label, size = 'icon', variant = 'ghost', title, ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      size={size}
      variant={variant}
      aria-label={label}
      title={title ?? label}
      className={cn(
        'text-slate-200 hover:bg-white/10 hover:text-white focus-visible:ring-cyan-300/70',
        className
      )}
      {...props}
    />
  )
);

HudIconButton.displayName = 'HudIconButton';
