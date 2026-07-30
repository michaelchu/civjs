import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  CircleHelp,
  Crosshair,
  Flag,
  Map,
  Search,
  Swords,
  Users,
  X,
} from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { openReport } from './reportEvents';
import type { Technology } from '../../types';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { HudDialogContent } from './HudDialogContent';

interface CivilopediaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technologies: Record<string, Technology>;
}

type TopicCategory = 'Getting started' | 'Game systems' | 'Reports' | 'Technology';

interface Topic {
  id: string;
  title: string;
  category: TopicCategory;
  summary: string;
  sections: Array<{ heading: string; body: string }>;
  icon: React.ElementType;
  discovered?: boolean;
}

const staticTopics: Topic[] = [
  {
    id: 'controls',
    title: 'Command controls',
    category: 'Getting started',
    summary: 'Keyboard shortcuts and the primary command surfaces.',
    icon: CircleHelp,
    sections: [
      {
        heading: 'Turn flow',
        body: 'Use Shift + Enter to end your turn. The command cluster shows urgent actions that still need attention.',
      },
      {
        heading: 'Map focus',
        body: 'Use Tab to advance unit focus. Selecting a city or unit opens its contextual tray at the bottom of the map.',
      },
      {
        heading: 'Navigation',
        body: 'F1–F6 open map, government, research, diplomacy, cities, and settings. Reports and help remain available from the command cluster.',
      },
    ],
  },
  {
    id: 'map-and-fog',
    title: 'Map and visibility',
    category: 'Getting started',
    summary: 'How known terrain, visible units, and map annotations are presented.',
    icon: Map,
    sections: [
      {
        heading: 'Visibility',
        body: 'Visible tiles show current information. Known or explored tiles may remain on the map with older information after they leave sight.',
      },
      {
        heading: 'Annotations',
        body: 'City, unit, resource, border, and movement markers are layered over the map. Selecting a marker opens the same contextual controls as selecting the map object.',
      },
      {
        heading: 'Minimap',
        body: 'The minimap summarizes known terrain and ownership. It is a navigation aid, not a replacement for the detailed map.',
      },
    ],
  },
  {
    id: 'cities-and-production',
    title: 'Cities and production',
    category: 'Game systems',
    summary: 'Read city growth, output, production, and citizen status.',
    icon: Flag,
    sections: [
      {
        heading: 'City tray',
        body: 'The selected-city tray shows population, growth, food, production, gold, science, and the current production estimate.',
      },
      {
        heading: 'City details',
        body: 'Open city details for specialists, worked tiles, buildings, production changes, worklists, and city management actions.',
      },
      {
        heading: 'Warnings',
        body: 'Starvation, disorder, pollution, and incomplete production data are surfaced as state messages rather than silently omitted.',
      },
    ],
  },
  {
    id: 'diplomacy',
    title: 'Diplomacy',
    category: 'Game systems',
    summary: 'Understand contact, relations, treaties, and shared vision.',
    icon: Users,
    sections: [
      {
        heading: 'Relations',
        body: 'The diplomacy strip and nation cards use consistent labels for war, ceasefire, armistice, peace, alliance, and team relationships.',
      },
      {
        heading: 'Proposals',
        body: 'Pending treaty proposals can be accepted, rejected, or cancelled from the diplomacy surfaces. A proposal is not active until accepted.',
      },
      {
        heading: 'Information boundaries',
        body: 'Unknown nations do not expose their identity or hidden state. Intelligence reports distinguish observed information from unavailable telemetry.',
      },
    ],
  },
  {
    id: 'combat',
    title: 'Combat and war calculator',
    category: 'Reports',
    summary: 'Compare visible units before an attack without replacing server validation.',
    icon: Crosshair,
    sections: [
      {
        heading: 'Estimate inputs',
        body: 'The war calculator compares authoritative attack, defense, firepower, and current health values from the unit snapshot.',
      },
      {
        heading: 'Limitations',
        body: 'Terrain, fortification, veteran effects, stacked defenders, bombardment, and ruleset-specific bonuses are not included in the current estimate.',
      },
      {
        heading: 'Authority',
        body: 'The server resolves the actual combat result. The calculator is an advisory planning aid and never executes an attack.',
      },
    ],
  },
  {
    id: 'reports',
    title: 'Reports overview',
    category: 'Reports',
    summary: 'A guide to the larger information surfaces available from Reports.',
    icon: Swords,
    sections: [
      {
        heading: 'Available reports',
        body: 'Scores, demographics, climate, units, intelligence, space race, and war calculator reports are designed to open over the map without removing the map from the game shell.',
      },
      {
        heading: 'Data quality',
        body: 'Reports label map-derived, observed, authoritative, and unavailable values so a missing backend field is not mistaken for zero.',
      },
      {
        heading: 'Future surfaces',
        body: 'Help content will grow with the ruleset and can later be backed by richer unit, building, wonder, and victory-condition metadata.',
      },
    ],
  },
];

const categoryOrder: TopicCategory[] = ['Getting started', 'Game systems', 'Reports', 'Technology'];

export const CivilopediaDialog: React.FC<CivilopediaDialogProps> = ({
  open,
  onOpenChange,
  technologies,
}) => {
  const researchedTechs = useGameStore(state => state.research?.researchedTechs);
  const technologyTopics = useMemo<Topic[]>(
    () =>
      Object.values(technologies).map(technology => ({
        id: `technology-${technology.id}`,
        title: technology.name,
        category: 'Technology',
        summary: technology.description ?? 'Technology entry from the current ruleset.',
        icon: BookOpen,
        discovered: technology.discovered || researchedTechs?.has(technology.id),
        sections: [
          { heading: 'Research cost', body: `${technology.cost} bulbs` },
          {
            heading: 'Prerequisites',
            body: technology.requirements.length
              ? technology.requirements.join(', ')
              : 'None listed',
          },
          {
            heading: 'Ruleset notes',
            body:
              technology.description ??
              'No additional help text is available for this technology yet.',
          },
        ],
      })),
    [researchedTechs, technologies]
  );
  const topics = useMemo(() => [...staticTopics, ...technologyTopics], [technologyTopics]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<TopicCategory>('Getting started');
  const [selectedId, setSelectedId] = useState(staticTopics[0].id);

  const filteredTopics = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return topics.filter(topic => {
      if (!normalizedQuery && topic.category !== category) return false;
      if (!normalizedQuery) return true;
      return `${topic.title} ${topic.summary}`.toLowerCase().includes(normalizedQuery);
    });
  }, [category, query, topics]);

  useEffect(() => {
    if (!filteredTopics.some(topic => topic.id === selectedId)) {
      setSelectedId(filteredTopics[0]?.id ?? '');
    }
  }, [filteredTopics, selectedId]);

  const selectedTopic = topics.find(topic => topic.id === selectedId) ?? filteredTopics[0];
  const SelectedTopicIcon = selectedTopic?.icon ?? BookOpen;
  const openResearch = () => {
    openReport('research');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <HudDialogContent className="overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <BookOpen className="h-5 w-5 text-cyan-300" aria-hidden="true" />
            Civilopedia
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Search the command interface, game systems, reports, and the current technology
            catalogue.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3 md:flex-row">
          <aside className="flex min-h-0 w-full flex-col gap-3 md:w-64 md:shrink-0">
            <label className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500"
                aria-hidden="true"
              />
              <input
                aria-label="Search Civilopedia"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search topics"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-8 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/20"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear Civilopedia search"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-2 rounded p-0.5 text-slate-500 hover:text-slate-200"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </label>
            <div
              className="flex gap-1 overflow-x-auto md:flex-col"
              aria-label="Civilopedia categories"
            >
              {categoryOrder.map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${category === item ? 'bg-cyan-300/15 font-medium text-cyan-100' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                >
                  {item}
                  {item === 'Technology' && (
                    <span className="ml-1 text-[10px] text-slate-600">
                      {technologyTopics.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-auto hidden rounded-lg border border-white/10 bg-white/5 p-3 text-[10px] leading-5 text-slate-500 md:block">
              Need the live research tree?{' '}
              <button
                type="button"
                onClick={openResearch}
                className="text-cyan-300 hover:text-cyan-100"
              >
                Open Research
              </button>
            </div>
          </aside>

          <section
            className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-white/10 bg-white/[0.03]"
            aria-label="Civilopedia topics"
          >
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <div className="max-h-48 overflow-y-auto border-b border-white/10 p-2 md:max-h-[55vh] md:w-56 md:shrink-0 md:border-b-0 md:border-r">
                {filteredTopics.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500">No topics match this search.</div>
                ) : (
                  filteredTopics.map(topic => {
                    const Icon = topic.icon;
                    return (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => setSelectedId(topic.id)}
                        className={`mb-1 flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${selectedTopic?.id === topic.id ? 'bg-cyan-300/15 text-cyan-100' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                      >
                        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium">{topic.title}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-slate-600">
                            {topic.discovered === false ? 'Not researched' : topic.category}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <article className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
                {selectedTopic ? (
                  <>
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
                        <SelectedTopicIcon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-cyan-300/70">
                          {selectedTopic.category}
                        </div>
                        <h3 className="mt-1 text-xl font-semibold text-slate-100">
                          {selectedTopic.title}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-slate-400">
                          {selectedTopic.summary}
                        </p>
                      </div>
                      {selectedTopic.discovered !== undefined && (
                        <span
                          className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] ${selectedTopic.discovered ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-white/5 text-slate-500'}`}
                        >
                          {selectedTopic.discovered && (
                            <Check className="h-3 w-3" aria-hidden="true" />
                          )}
                          {selectedTopic.discovered ? 'Researched' : 'Not researched'}
                        </span>
                      )}
                    </div>
                    <div className="mt-6 space-y-4">
                      {selectedTopic.sections.map(section => (
                        <section
                          key={section.heading}
                          className="rounded-lg border border-white/10 bg-white/5 p-3"
                        >
                          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">
                            {section.heading}
                          </h4>
                          <p className="mt-1.5 text-xs leading-5 text-slate-400">{section.body}</p>
                        </section>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="p-5 text-sm text-slate-500">Select a topic to begin.</div>
                )}
              </article>
            </div>
          </section>
        </div>
      </HudDialogContent>
    </Dialog>
  );
};
