import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Move variants to satisfy react-refresh/only-export-components
const gameButtonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      theme: {
        medieval: [
          'bg-gradient-to-b from-amber-400 to-amber-600 text-amber-900 border-2 border-amber-700',
          'hover:from-amber-300 hover:to-amber-500 hover:border-amber-600',
          'active:from-amber-500 active:to-amber-700',
          'focus-visible:ring-amber-500',
          'shadow-lg shadow-amber-600/25',
          'font-bold tracking-wide',
        ],
        futuristic: [
          'bg-gradient-to-r from-slate-800 to-slate-900 text-cyan-300 border-2 border-cyan-500/50',
          'hover:from-slate-700 hover:to-slate-800 hover:border-cyan-400',
          'active:from-slate-900 active:to-black',
          'focus-visible:ring-cyan-400',
          'shadow-lg shadow-cyan-400/20',
          'font-mono uppercase tracking-wider',
          'hover:shadow-cyan-400/30 hover:text-cyan-200',
        ],
        parchment: [
          'bg-gradient-to-b from-yellow-100 to-amber-200 text-amber-800 border-2 border-amber-600',
          'hover:from-yellow-50 hover:to-amber-100 hover:border-amber-700',
          'active:from-amber-200 active:to-amber-300',
          'focus-visible:ring-amber-600',
          'shadow-md shadow-amber-700/20',
          'font-serif',
        ],
        stone: [
          'bg-gradient-to-b from-gray-400 to-gray-600 text-gray-900 border-2 border-gray-700',
          'hover:from-gray-300 hover:to-gray-500 hover:border-gray-600',
          'active:from-gray-500 active:to-gray-700',
          'focus-visible:ring-gray-500',
          'shadow-lg shadow-gray-800/30',
          'font-bold',
        ],
        metal: [
          'bg-gradient-to-b from-slate-500 to-slate-700 text-slate-100 border-2 border-slate-800',
          'hover:from-slate-400 hover:to-slate-600 hover:border-slate-700',
          'active:from-slate-600 active:to-slate-800',
          'focus-visible:ring-slate-400',
          'shadow-lg shadow-slate-900/40',
          'font-bold',
        ],
      },
      variant: {
        default: '',
        destructive: '',
        outline: 'bg-transparent border-2',
        secondary: 'opacity-80',
        ghost: 'border-0 bg-transparent shadow-none',
        link: 'border-0 bg-transparent shadow-none underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3 py-1.5 text-xs',
        lg: 'h-12 px-6 py-3 text-base',
        xl: 'h-14 px-8 py-4 text-lg',
        icon: 'h-10 w-10',
      },
    },
    compoundVariants: [
      // Destructive variants for each theme
      {
        theme: 'medieval',
        variant: 'destructive',
        class:
          'from-red-600 to-red-800 text-red-100 border-red-800 hover:from-red-500 hover:to-red-700',
      },
      {
        theme: 'futuristic',
        variant: 'destructive',
        class: 'from-red-900 to-red-800 text-red-300 border-red-500/50 hover:border-red-400',
      },
      {
        theme: 'parchment',
        variant: 'destructive',
        class:
          'from-red-200 to-red-400 text-red-800 border-red-600 hover:from-red-100 hover:to-red-300',
      },
      {
        theme: 'stone',
        variant: 'destructive',
        class:
          'from-red-400 to-red-600 text-red-100 border-red-700 hover:from-red-300 hover:to-red-500',
      },
      {
        theme: 'metal',
        variant: 'destructive',
        class:
          'from-red-500 to-red-700 text-red-100 border-red-800 hover:from-red-400 hover:to-red-600',
      },
      // Outline variants
      {
        variant: 'outline',
        class: 'hover:bg-opacity-10 hover:bg-current',
      },
    ],
    defaultVariants: {
      theme: 'medieval',
      variant: 'default',
      size: 'default',
    },
  }
);

export interface GameButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof gameButtonVariants> {
  asChild?: boolean;
}

const GameButton = React.forwardRef<HTMLButtonElement, GameButtonProps>(
  ({ className, theme, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(gameButtonVariants({ theme, variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
GameButton.displayName = 'GameButton';

export { GameButton };
