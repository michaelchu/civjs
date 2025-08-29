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
    'bg-gradient-to-b from-amber-100 to-yellow-200',
    {
      // Use lower breakpoint to ensure coverage for foldable devices like Galaxy Fold5
      "min-[480px]:bg-[url('/img/background.png')] min-[480px]:bg-cover min-[480px]:bg-center min-[480px]:bg-no-repeat":
        showBackground,
    },
    className
  );

  return <div className={backgroundClasses}>{children}</div>;
};
