import { type Node, type Edge, MarkerType } from 'reactflow';
import { type TechnologyNodeData } from '../TechnologyNode';

// Technology data based on the server ruleset
// Reference: /root/repo/apps/server/src/shared/data/rulesets/classic/techs.json
export interface Technology {
  id: string;
  name: string;
  cost: number;
  requirements: string[];
  flags: string[];
  description: string;
}

export const TECHNOLOGIES: Record<string, Technology> = {
  alphabet: {
    id: 'alphabet',
    name: 'Alphabet',
    cost: 10,
    requirements: [],
    flags: [],
    description: 'Enables writing and record keeping',
  },
  pottery: {
    id: 'pottery',
    name: 'Pottery',
    cost: 10,
    requirements: [],
    flags: [],
    description: 'Enables granary construction and food storage',
  },
  mysticism: {
    id: 'mysticism',
    name: 'Mysticism',
    cost: 20,
    requirements: ['alphabet'],
    flags: [],
    description: 'Enables temples and spiritual buildings',
  },
  mathematics: {
    id: 'mathematics',
    name: 'Mathematics',
    cost: 20,
    requirements: ['alphabet'],
    flags: [],
    description: 'Foundation for advanced sciences',
  },
  bronze_working: {
    id: 'bronze_working',
    name: 'Bronze Working',
    cost: 20,
    requirements: ['pottery'],
    flags: [],
    description: 'Enables bronze tools and weapons',
  },
  animal_husbandry: {
    id: 'animal_husbandry',
    name: 'Animal Husbandry',
    cost: 20,
    requirements: ['pottery'],
    flags: [],
    description: 'Enables domestication of animals',
  },
  astronomy: {
    id: 'astronomy',
    name: 'Astronomy',
    cost: 40,
    requirements: ['mysticism', 'mathematics'],
    flags: [],
    description: 'Enables navigation and calendar systems',
  },
  iron_working: {
    id: 'iron_working',
    name: 'Iron Working',
    cost: 40,
    requirements: ['bronze_working'],
    flags: [],
    description: 'Enables iron tools and advanced weapons',
  },
  currency: {
    id: 'currency',
    name: 'Currency',
    cost: 40,
    requirements: ['bronze_working'],
    flags: [],
    description: 'Enables trade and marketplace buildings',
  },
  writing: {
    id: 'writing',
    name: 'Writing',
    cost: 40,
    requirements: ['alphabet'],
    flags: [],
    description: 'Enables libraries and advanced record keeping',
  },
  philosophy: {
    id: 'philosophy',
    name: 'Philosophy',
    cost: 80,
    requirements: ['writing', 'mysticism'],
    flags: ['bonus_tech'],
    description: 'First civilization to discover Philosophy gets a free technology',
  },
  literature: {
    id: 'literature',
    name: 'Literature',
    cost: 80,
    requirements: ['writing'],
    flags: [],
    description: 'Enables great works and cultural advancement',
  },
  engineering: {
    id: 'engineering',
    name: 'Engineering',
    cost: 80,
    requirements: ['mathematics', 'iron_working'],
    flags: ['bridge'],
    description: 'Enables construction of bridges and aqueducts',
  },
};

/**
 * Create React Flow nodes and edges from technology data
 */
export function createTechnologyGraph(): { nodes: Node<TechnologyNodeData>[]; edges: Edge[] } {
  const nodes: Node<TechnologyNodeData>[] = [];
  const edges: Edge[] = [];

  // Create nodes
  Object.values(TECHNOLOGIES).forEach(tech => {
    const node: Node<TechnologyNodeData> = {
      id: tech.id,
      type: 'technologyNode',
      position: { x: 0, y: 0 }, // Will be positioned by layout algorithm
      data: {
        id: tech.id,
        name: tech.name,
        cost: tech.cost,
        description: tech.description,
        requirements: tech.requirements,
        flags: tech.flags,

        // Default research state - will be updated from game state
        isResearched: false,
        isCurrent: false,
        isGoal: false,
        isAvailable: tech.requirements.length === 0, // Root techs are available by default
        progress: 0,
      },
    };
    nodes.push(node);
  });

  // Create edges for requirements
  Object.values(TECHNOLOGIES).forEach(tech => {
    tech.requirements.forEach(reqId => {
      const edge: Edge = {
        id: `${reqId}-${tech.id}`,
        source: reqId,
        target: tech.id,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: '#6b7280',
          strokeWidth: 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#6b7280',
        },
      };
      edges.push(edge);
    });
  });

  return { nodes, edges };
}

/**
 * Calculate technology layers for positioning
 * Based on freeciv's reqtree.c layer calculation
 */
export function calculateTechnologyLayers(): Map<string, number> {
  const layers = new Map<string, number>();
  const visited = new Set<string>();

  function calculateLayer(techId: string): number {
    if (layers.has(techId)) {
      return layers.get(techId)!;
    }

    if (visited.has(techId)) {
      // Circular dependency - shouldn't happen with proper tech tree
      return 0;
    }

    visited.add(techId);

    const tech = TECHNOLOGIES[techId];
    if (!tech) {
      return 0;
    }

    if (tech.requirements.length === 0) {
      layers.set(techId, 0);
      visited.delete(techId);
      return 0;
    }

    let maxLayer = -1;
    for (const reqId of tech.requirements) {
      const reqLayer = calculateLayer(reqId);
      maxLayer = Math.max(maxLayer, reqLayer);
    }

    const layer = maxLayer + 1;
    layers.set(techId, layer);
    visited.delete(techId);
    return layer;
  }

  // Calculate layers for all technologies
  Object.keys(TECHNOLOGIES).forEach(techId => {
    calculateLayer(techId);
  });

  return layers;
}

/**
 * Get available technologies based on current research state
 */
export function getAvailableTechnologies(researchedTechs: Set<string>): string[] {
  return Object.values(TECHNOLOGIES)
    .filter(
      tech =>
        !researchedTechs.has(tech.id) && tech.requirements.every(req => researchedTechs.has(req))
    )
    .map(tech => tech.id);
}

/**
 * Calculate research progress percentage
 */
export function calculateResearchProgress(currentBulbs: number, requiredBulbs: number): number {
  if (requiredBulbs <= 0) return 100;
  return Math.min(100, Math.round((currentBulbs / requiredBulbs) * 100));
}
