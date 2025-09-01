import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { cn } from '../../lib/utils';

export interface TechnologyNodeData {
  id: string;
  name: string;
  cost: number;
  description: string;
  requirements: string[];
  flags: string[];
  
  // Research state
  isResearched?: boolean;
  isCurrent?: boolean;
  isGoal?: boolean;
  isAvailable?: boolean;
  progress?: number; // 0-100 percentage
  
  // UI state
  isHovered?: boolean;
  isSelected?: boolean;
}

export const TechnologyNode: React.FC<NodeProps<TechnologyNodeData>> = ({ 
  data, 
  selected 
}) => {
  const {
    name,
    cost,
    isResearched = false,
    isCurrent = false,
    isGoal = false,
    isAvailable = false,
    progress = 0,
  } = data;

  // Color coding based on freeciv-web reference
  const getNodeStyle = () => {
    if (isResearched) {
      // Known tech - white background
      return 'bg-white text-black border-gray-400';
    }
    
    if (isCurrent) {
      // Current research - light green with bold text
      return 'bg-[#a1c883] text-black border-[#91b873] font-bold';
    }
    
    if (isGoal) {
      // Research goal - light blue with bold text  
      return 'bg-[#6f8db4] text-black border-[#5f7da4] font-bold';
    }
    
    if (isAvailable) {
      // Possible research - green
      return 'bg-[#5b823d] text-white border-[#4b722d]';
    }
    
    // Unknown tech - blue
    return 'bg-[#3d5f82] text-white border-[#2d4f72]';
  };

  const nodeStyle = getNodeStyle();

  return (
    <div 
      className={cn(
        'px-4 py-3 rounded-lg border-2 shadow-lg transition-all duration-200',
        'min-w-[160px] max-w-[200px] cursor-pointer hover:shadow-xl',
        nodeStyle,
        selected && 'ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900'
      )}
    >
      {/* Input handle for dependencies */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-2 h-2 bg-gray-400 border border-gray-600"
        style={{ left: -6 }}
      />
      
      <div className="space-y-1">
        {/* Technology name */}
        <div className="text-sm font-medium leading-tight">
          {name}
        </div>
        
        {/* Cost and progress */}
        <div className="flex items-center justify-between text-xs">
          <span className="opacity-90">
            Cost: {cost}
          </span>
          {isCurrent && progress > 0 && (
            <span className="opacity-90">
              {progress}%
            </span>
          )}
        </div>
        
        {/* Progress bar for current research */}
        {isCurrent && (
          <div className="w-full bg-black bg-opacity-20 rounded-full h-1.5">
            <div 
              className="bg-green-600 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        
        {/* Research indicators */}
        {isResearched && (
          <div className="text-xs text-green-700 font-medium">
            ✓ Researched
          </div>
        )}
        
        {isGoal && !isCurrent && (
          <div className="text-xs text-blue-900 font-medium">
            → Goal
          </div>
        )}
      </div>

      {/* Output handle for technologies that depend on this one */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-2 h-2 bg-gray-400 border border-gray-600"
        style={{ right: -6 }}
      />
    </div>
  );
};