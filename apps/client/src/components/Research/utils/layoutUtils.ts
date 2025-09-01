import dagre from 'dagre';
import { type Node, type Edge, Position } from 'reactflow';
import { type TechnologyNodeData } from '../TechnologyNode';

const nodeWidth = 180;
const nodeHeight = 80;

/**
 * Apply Dagre layout algorithm to position nodes hierarchically
 * Based on freeciv's technology tree layout approach
 */
export function getLayoutedElements(
  nodes: Node<TechnologyNodeData>[],
  edges: Edge[],
  direction: 'TB' | 'BT' | 'LR' | 'RL' = 'LR'
): { initialNodes: Node<TechnologyNodeData>[]; initialEdges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  // Configure the graph layout
  dagreGraph.setGraph({
    rankdir: direction,
    align: 'UL',
    ranksep: 100, // Horizontal spacing between layers
    nodesep: 60,  // Vertical spacing between nodes in same layer
    marginx: 20,
    marginy: 20,
  });

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { 
      width: nodeWidth, 
      height: nodeHeight 
    });
  });

  // Add edges to dagre graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Calculate layout
  dagre.layout(dagreGraph);

  // Apply positions to React Flow nodes
  const layoutedNodes: Node<TechnologyNodeData>[] = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    
    // Dagre gives us the center position, we need top-left for React Flow
    const x = nodeWithPosition.x - nodeWidth / 2;
    const y = nodeWithPosition.y - nodeHeight / 2;

    return {
      ...node,
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position: { x, y },
    };
  });

  // Style edges based on their position in the hierarchy
  const layoutedEdges: Edge[] = edges.map((edge) => {
    const sourceNode = dagreGraph.node(edge.source);
    const targetNode = dagreGraph.node(edge.target);
    
    // Determine if this is a long-range dependency that needs special styling
    const isLongRange = Math.abs(sourceNode.x - targetNode.x) > nodeWidth * 2;
    
    return {
      ...edge,
      style: {
        ...edge.style,
        stroke: isLongRange ? '#9ca3af' : '#6b7280', // Lighter color for long dependencies
        strokeWidth: isLongRange ? 1.5 : 2,
        strokeDasharray: isLongRange ? '5,5' : undefined, // Dashed for long dependencies
      },
    };
  });

  return {
    initialNodes: layoutedNodes,
    initialEdges: layoutedEdges,
  };
}

/**
 * Alternative manual layout for technology tree similar to freeciv-web's hardcoded positions
 * This provides more control over positioning but requires manual adjustment
 */
export function getManualLayoutedElements(
  nodes: Node<TechnologyNodeData>[],
  edges: Edge[]
): { initialNodes: Node<TechnologyNodeData>[]; initialEdges: Edge[] } {
  // Technology positions inspired by freeciv-web's reqtree.js
  const techPositions: Record<string, { x: number; y: number }> = {
    // Layer 0 - Starting technologies
    alphabet: { x: 0, y: 0 },
    pottery: { x: 0, y: 120 },
    
    // Layer 1 - Basic technologies  
    mysticism: { x: 250, y: 0 },
    mathematics: { x: 250, y: 80 },
    writing: { x: 250, y: 160 },
    bronze_working: { x: 250, y: 240 },
    animal_husbandry: { x: 250, y: 320 },
    
    // Layer 2 - Advanced technologies
    astronomy: { x: 500, y: 40 },
    philosophy: { x: 500, y: 120 },
    literature: { x: 500, y: 200 },
    iron_working: { x: 500, y: 280 },
    currency: { x: 500, y: 360 },
    
    // Layer 3 - Complex technologies
    engineering: { x: 750, y: 160 },
  };

  const layoutedNodes: Node<TechnologyNodeData>[] = nodes.map((node) => {
    const position = techPositions[node.id] || { x: 0, y: 0 };
    
    return {
      ...node,
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position,
    };
  });

  return {
    initialNodes: layoutedNodes,
    initialEdges: edges,
  };
}

/**
 * Calculate the bounds of the technology tree for viewport fitting
 */
export function getTreeBounds(nodes: Node[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...nodes.map(n => n.position.x));
  const minY = Math.min(...nodes.map(n => n.position.y));
  const maxX = Math.max(...nodes.map(n => n.position.x + nodeWidth));
  const maxY = Math.max(...nodes.map(n => n.position.y + nodeHeight));

  return {
    minX,
    minY, 
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Find the optimal zoom level to fit the technology tree in the viewport
 */
export function calculateFitViewOptions(
  nodes: Node[],
  viewportWidth: number,
  viewportHeight: number,
  padding: number = 50
) {
  const bounds = getTreeBounds(nodes);
  
  const scaleX = (viewportWidth - padding * 2) / bounds.width;
  const scaleY = (viewportHeight - padding * 2) / bounds.height;
  
  // Use the smaller scale to ensure everything fits
  Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%
  
  return {
    minZoom: 0.1,
    maxZoom: 1.5,
    padding: 0.1,
  };
}