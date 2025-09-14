import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

function GameDialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="game-dialog" {...props} />;
}

function GameDialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="game-dialog-trigger" {...props} />;
}

function GameDialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="game-dialog-portal" {...props} />;
}

function GameDialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="game-dialog-close" {...props} />;
}

function GameDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="game-dialog-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50',
        // Game-like overlay: darker with subtle pattern
        'bg-black/70 backdrop-blur-sm',
        // Optional: Add a subtle noise pattern
        // 'bg-[radial-gradient(circle_at_center,_rgba(0,0,0,0.8)_0%,_rgba(0,0,0,0.9)_100%)]',
        className
      )}
      {...props}
    />
  );
}

interface GameDialogContentProps extends React.ComponentProps<typeof DialogPrimitive.Content> {
  showCloseButton?: boolean;
  theme?: 'medieval' | 'futuristic' | 'parchment' | 'stone' | 'metal';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

function GameDialogContent({
  className,
  children,
  showCloseButton = true,
  theme = 'medieval',
  size = 'md',
  ...props
}: GameDialogContentProps) {
  const themeStyles = {
    medieval:
      'bg-gradient-to-b from-amber-50 to-amber-100 border-4 border-amber-800 shadow-2xl shadow-amber-900/50 text-amber-900',
    futuristic:
      'bg-gradient-to-b from-slate-900 to-slate-800 border-2 border-cyan-400/50 shadow-2xl shadow-cyan-400/20 text-cyan-100',
    parchment:
      'bg-gradient-to-b from-yellow-50 to-amber-50 border-4 border-amber-700 shadow-2xl shadow-amber-800/40 text-amber-900',
    stone:
      'bg-gradient-to-b from-gray-300 to-gray-400 border-4 border-gray-700 shadow-2xl shadow-gray-900/60 text-gray-900',
    metal:
      'bg-gradient-to-b from-slate-400 to-slate-600 border-4 border-slate-800 shadow-2xl shadow-slate-900/70 text-slate-100',
  };

  const sizeStyles = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  return (
    <GameDialogPortal>
      <GameDialogOverlay />
      <DialogPrimitive.Content
        data-slot="game-dialog-content"
        className={cn(
          // Base positioning and animation
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 duration-200',

          // Game-like styling
          'rounded-xl p-8',
          themeStyles[theme],
          sizeStyles[size],

          // Optional decorative elements
          'relative overflow-hidden',
          // Add corner decorations
          'before:absolute before:top-2 before:left-2 before:w-4 before:h-4 before:border-l-2 before:border-t-2 before:border-current before:opacity-60',
          'after:absolute after:bottom-2 after:right-2 after:w-4 after:h-4 after:border-r-2 after:border-b-2 after:border-current after:opacity-60',

          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="game-dialog-close"
            className={cn(
              "ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-lg opacity-70 transition-all hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
              // Theme-specific close button styles
              theme === 'medieval' && 'hover:bg-amber-200 text-amber-800',
              theme === 'futuristic' && 'hover:bg-cyan-400/20 text-cyan-300',
              theme === 'parchment' && 'hover:bg-amber-200 text-amber-800',
              theme === 'stone' && 'hover:bg-gray-200 text-gray-800',
              theme === 'metal' && 'hover:bg-slate-300 text-slate-900'
            )}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </GameDialogPortal>
  );
}

function GameDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="game-dialog-header"
      className={cn(
        'flex flex-col gap-3 text-center sm:text-left relative',
        // Add decorative border for header
        'pb-4 mb-2 border-b-2 border-current/20',
        className
      )}
      {...props}
    />
  );
}

function GameDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="game-dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 mt-4 border-t border-current/20',
        className
      )}
      {...props}
    />
  );
}

function GameDialogTitle({
  className,
  theme = 'medieval',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title> & {
  theme?: 'medieval' | 'futuristic' | 'parchment' | 'stone' | 'metal';
}) {
  const titleStyles = {
    medieval: 'font-bold text-2xl tracking-wide drop-shadow-sm',
    futuristic:
      'font-bold text-2xl tracking-wider uppercase text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]',
    parchment: 'font-serif text-2xl font-bold tracking-wide text-amber-800',
    stone: 'font-bold text-2xl tracking-wide text-gray-800 drop-shadow-sm',
    metal: 'font-bold text-2xl tracking-wide text-slate-100 drop-shadow-sm',
  };

  return (
    <DialogPrimitive.Title
      data-slot="game-dialog-title"
      className={cn('leading-tight', titleStyles[theme], className)}
      {...props}
    />
  );
}

function GameDialogDescription({
  className,
  theme = 'medieval',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description> & {
  theme?: 'medieval' | 'futuristic' | 'parchment' | 'stone' | 'metal';
}) {
  const descriptionStyles = {
    medieval: 'text-amber-700 text-base leading-relaxed',
    futuristic: 'text-cyan-200 text-sm font-mono leading-relaxed',
    parchment: 'text-amber-800 text-base leading-relaxed font-serif',
    stone: 'text-gray-700 text-base leading-relaxed',
    metal: 'text-slate-200 text-base leading-relaxed',
  };

  return (
    <DialogPrimitive.Description
      data-slot="game-dialog-description"
      className={cn(descriptionStyles[theme], className)}
      {...props}
    />
  );
}

export {
  GameDialog,
  GameDialogClose,
  GameDialogContent,
  GameDialogDescription,
  GameDialogFooter,
  GameDialogHeader,
  GameDialogOverlay,
  GameDialogPortal,
  GameDialogTitle,
  GameDialogTrigger,
};
