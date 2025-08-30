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
      <label className="block text-sm font-medium text-amber-700 mb-2">{label}</label>
      <div className="flex rounded-md shadow-sm" role="group">
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 px-4 py-2 text-sm font-medium border border-amber-400 focus:z-10 focus:ring-2 focus:ring-amber-600 focus:outline-none transition-colors ${
              index === 0
                ? 'rounded-l-md'
                : index === options.length - 1
                  ? 'rounded-r-md'
                  : 'border-t border-b'
            } ${
              value === option.value
                ? 'bg-amber-700 text-amber-50 border-amber-700'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-amber-500 mt-1">
        {options.find(opt => opt.value === value)?.description}
      </p>
    </div>
  );
};
