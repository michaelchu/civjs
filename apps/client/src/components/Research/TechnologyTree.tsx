import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  type Node,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type NodeTypes,
  Background,
  Controls,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useGameStore } from '../../store/gameStore';
import { TechnologyNode } from './TechnologyNode';
import { TechnologyDetails } from './TechnologyDetails';
// import { ResearchDemo } from './ResearchDemo'; // Hidden for now
import { createTechnologyGraph, calculateResearchProgress } from './utils/technologyData';
import { getLayoutedElements } from './utils/layoutUtils';
import { gameClient } from '../../services/GameClient';

// Move nodeTypes outside component and memoize to fix React Flow warning
const nodeTypes: NodeTypes = {
  technologyNode: TechnologyNode,
} as const;

const TechnologyTreeInner: React.FC = () => {
  const research = useGameStore(state => state.research);
  const technologies = useGameStore(state => state.technologies);
  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const { fitView } = useReactFlow();

  // Create nodes and edges from the complete server ruleset catalogue.
  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = createTechnologyGraph(technologies);
    return getLayoutedElements(nodes, edges);
  }, [technologies]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialEdges, initialNodes, setEdges, setNodes]);

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();

    // Left click - show details panel
    if (event.button === 0) {
      setSelectedTech(node.id);
    }
  }, []);

  const onNodeDoubleClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();

      if (!research) return;

      const techId = node.id;
      const isResearched = research.researchedTechs.has(techId);
      const canResearch = research.availableTechs.has(techId);

      // Double-click to set as current research (if available)
      if (!isResearched && canResearch) {
        void gameClient.setResearch(techId);
      }
    },
    [research]
  );

  useEffect(() => {
    gameClient.refreshResearch();
  }, []);

  // Fit view when component mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.1 });
    }, 100);
    return () => clearTimeout(timer);
  }, [fitView]);

  // Update nodes when game state changes
  useEffect(() => {
    if (!research) return;

    setNodes(nds =>
      nds.map(node => {
        const techId = node.id;
        const isResearched = research.researchedTechs.has(techId);
        const isCurrent = research.currentTech === techId;
        const isGoal = research.techGoal === techId;
        const isAvailable = research.availableTechs.has(techId);

        // Calculate progress for current research
        let progress = 0;
        if (isCurrent && research.currentTech) {
          const tech = node.data;
          progress = calculateResearchProgress(research.bulbsAccumulated, tech.cost);
        }

        return {
          ...node,
          data: {
            ...node.data,
            isResearched,
            isCurrent,
            isGoal,
            isAvailable,
            progress,
          },
        };
      })
    );
  }, [research, setNodes]);

  // Add a check to see if nodes are being created
  if (nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading technology tree...</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-gray-900 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        className="bg-gray-900"
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
      >
        <Controls className="bg-gray-800 border-gray-600 [&>button]:bg-gray-700 [&>button]:border-gray-600 [&>button]:text-white" />
        <Background color="#374151" gap={16} />
      </ReactFlow>

      {selectedTech && (
        <TechnologyDetails techId={selectedTech} onClose={() => setSelectedTech(null)} />
      )}

      {/* Demo controls for testing - hidden for now */}
      {/* <ResearchDemo /> */}
    </div>
  );
};

export const TechnologyTree: React.FC = () => {
  return (
    <div className="w-full h-full bg-gray-900">
      <ReactFlowProvider>
        <TechnologyTreeInner />
      </ReactFlowProvider>
    </div>
  );
};
