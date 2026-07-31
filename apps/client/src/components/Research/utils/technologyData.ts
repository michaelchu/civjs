import { type Node, type Edge, MarkerType } from 'reactflow';
import type { Technology } from '../../../types';
import { type TechnologyNodeData } from '../TechnologyNode';

/**
 * Create the research graph from the authoritative ruleset catalogue sent by
 * the server. This keeps the client usable across the complete classic tree
 * and future rulesets without maintaining a second, partial technology list.
 */
export function createTechnologyGraph(technologies: Record<string, Technology>): {
  nodes: Node<TechnologyNodeData>[];
  edges: Edge[];
} {
  const nodes = Object.values(technologies).map((tech): Node<TechnologyNodeData> => ({
    id: tech.id,
    type: 'technologyNode',
    position: { x: 0, y: 0 },
    data: {
      id: tech.id,
      name: tech.name,
      cost: tech.cost,
      description: tech.description,
      requirements: tech.requirements,
      flags: tech.flags ?? [],
      isResearched: tech.discovered,
      isCurrent: false,
      isGoal: false,
      isAvailable: false,
      progress: 0,
    },
  }));

  const edges = Object.values(technologies).flatMap(tech =>
    tech.requirements
      .filter(requirement => technologies[requirement])
      .map((requirement): Edge => ({
        id: `${requirement}-${tech.id}`,
        source: requirement,
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
      }))
  );

  return { nodes, edges };
}

export function calculateTechnologyLayers(
  technologies: Record<string, Technology>
): Map<string, number> {
  const layers = new Map<string, number>();
  const visiting = new Set<string>();

  const calculateLayer = (techId: string): number => {
    const existing = layers.get(techId);
    if (existing !== undefined) return existing;
    if (visiting.has(techId)) return 0;

    visiting.add(techId);
    const technology = technologies[techId];
    const layer =
      !technology || technology.requirements.length === 0
        ? 0
        : Math.max(
            0,
            ...technology.requirements.map(requirement => calculateLayer(requirement) + 1)
          );
    visiting.delete(techId);
    layers.set(techId, layer);
    return layer;
  };

  Object.keys(technologies).forEach(calculateLayer);
  return layers;
}

export function getAvailableTechnologies(
  technologies: Record<string, Technology>,
  researchedTechs: Set<string>
): string[] {
  return Object.values(technologies)
    .filter(
      technology =>
        !researchedTechs.has(technology.id) &&
        technology.requirements.every(requirement => researchedTechs.has(requirement))
    )
    .map(technology => technology.id);
}

export function calculateResearchProgress(currentBulbs: number, requiredBulbs: number): number {
  if (requiredBulbs <= 0) return 100;
  return Math.min(100, Math.round((currentBulbs / requiredBulbs) * 100));
}
