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
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useGameStore } from '../../store/gameStore';
import { TechnologyNode } from './TechnologyNode';
import { TechnologyDetails } from './TechnologyDetails';
// import { ResearchDemo } from './ResearchDemo'; // Hidden for now
import {
  createTechnologyGraph,
  getAvailableTechnologies,
  calculateResearchProgress,
} from './utils/technologyData';
import { getLayoutedElements } from './utils/layoutUtils';

// Move nodeTypes outside component and memoize to fix React Flow warning
const nodeTypes: NodeTypes = {
  technologyNode: TechnologyNode,
} as const;

const TechnologyTreeInner: React.FC = () => {
  const store = useGameStore();
  const { setCurrentResearch, updateResearchState } = store;
  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const { fitView } = useReactFlow();

  // Create nodes and edges from technology data
  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = createTechnologyGraph();
    return getLayoutedElements(nodes, edges);
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

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

      if (!store.research) return;

      const techId = node.id;
      const isResearched = store.research.researchedTechs.has(techId);
      const canResearch = store.research.availableTechs.has(techId);

      // Double-click to set as current research (if available)
      if (!isResearched && canResearch) {
        setCurrentResearch(techId);
        console.log('Set current research:', techId);
      }
    },
    [store.research, setCurrentResearch]
  );

  // Fit view when component mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.1 });
    }, 100);
    return () => clearTimeout(timer);
  }, [fitView]);

  // Update available technologies when research state changes
  useEffect(() => {
    if (!store.research) return;

    const availableTechs = getAvailableTechnologies(store.research.researchedTechs);
    updateResearchState({
      availableTechs: new Set(availableTechs),
    });
  }, [store.research?.researchedTechs, updateResearchState]);

  // Update nodes when game state changes
  useEffect(() => {
    if (!store.research) return;

    setNodes(nds =>
      nds.map(node => {
        const techId = node.id;
        const isResearched = store.research!.researchedTechs.has(techId);
        const isCurrent = store.research!.currentTech === techId;
        const isGoal = store.research!.techGoal === techId;
        const isAvailable = store.research!.availableTechs.has(techId);

        // Calculate progress for current research
        let progress = 0;
        if (isCurrent && store.research!.currentTech) {
          const tech = node.data;
          progress = calculateResearchProgress(store.research!.bulbsAccumulated, tech.cost);
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
  }, [store.research, setNodes]);

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
        <MiniMap
          className="bg-gray-800 border-gray-600"
          nodeColor={node => {
            // Color nodes in minimap based on research state
            if (node.data?.isResearched) return '#ffffff';
            if (node.data?.isCurrent) return '#a1c883';
            if (node.data?.isGoal) return '#6f8db4';
            return '#3d5f82';
          }}
        />
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
