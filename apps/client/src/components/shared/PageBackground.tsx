import React from 'react';
import { clsx } from 'clsx';

interface PageBackgroundProps {
  children: React.ReactNode;
  className?: string;
  showBackground?: boolean;
}

export const PageBackground: React.FC<PageBackgroundProps> = ({
  children,
  className,
  showBackground = true,
}) => {
  const backgroundClasses = clsx(
    'bg-gradient-to-b from-[#fcfaf8] to-[#f8f5f0]',
    {
      // Use md breakpoint (768px) which matches Galaxy Fold5 portrait unfolded mode
      "md:bg-[url('/img/background.png')] md:bg-cover md:bg-center md:bg-no-repeat": showBackground,
    },
    className
  );

  return <div className={backgroundClasses}>{children}</div>;
};
