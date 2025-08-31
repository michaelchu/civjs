import React from 'react';

interface ButtonOption {
  value: number;
  label: string;
  description: string;
}

interface ButtonGroupProps {
  label: string;
  value: number;
  options: ButtonOption[];
  onChange: (value: number) => void;
  className?: string;
}

export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  label,
  value,
  options,
  onChange,
  className = '',
}) => {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-foreground mb-2">{label}</label>
      <div className="flex rounded-md shadow-sm" role="group">
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 px-4 py-2 text-sm font-medium border border-border focus:z-10 focus:ring-2 focus:ring-ring focus:outline-none transition-colors ${
              index === 0
                ? 'rounded-l-md'
                : index === options.length - 1
                  ? 'rounded-r-md'
                  : 'border-t border-b'
            } ${
              value === option.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-foreground hover:bg-muted/50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {options.find(opt => opt.value === value)?.description}
      </p>
    </div>
  );
};
