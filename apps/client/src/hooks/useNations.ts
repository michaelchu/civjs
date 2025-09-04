import { useState, useEffect, useCallback } from 'react';
import { nationsApi, type Nation, type NationTraits, type NationLeader } from '../services/api';

/**
 * Hook state interfaces
 */
interface UseNationsState {
  nations: Nation[];
  loading: boolean;
  error: string | null;
  metadata: {
    count: number;
    ruleset: string;
    default_traits: NationTraits;
  } | null;
}

interface UseNationState {
  nation: Nation | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to fetch and manage all nations for a ruleset
 */
export function useNations(ruleset: string = 'classic') {
  const [state, setState] = useState<UseNationsState>({
    nations: [],
    loading: true,
    error: null,
    metadata: null,
  });

  const fetchNations = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      console.log(`Fetching nations for ruleset: ${ruleset}`);
      const response = await nationsApi.getNations(ruleset);
      console.log('Nations API response:', response);

      if (response.success && response.data) {
        setState({
          nations: response.data.nations,
          loading: false,
          error: null,
          metadata: response.data.metadata,
        });
      } else {
        setState(prev => ({
          ...prev,
          loading: false,
          error: response.error || 'Failed to fetch nations',
        }));
      }
    } catch (error) {
      console.error('Error fetching nations:', error);
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, [ruleset]);

  useEffect(() => {
    fetchNations();
  }, [fetchNations]);

  const refetch = useCallback(() => {
    fetchNations();
  }, [fetchNations]);

  return {
    ...state,
    refetch,
  };
}

/**
 * Hook to fetch and manage a single nation
 */
export function useNation(id: string, ruleset: string = 'classic') {
  const [state, setState] = useState<UseNationState>({
    nation: null,
    loading: true,
    error: null,
  });

  const fetchNation = useCallback(async () => {
    if (!id) {
      setState({ nation: null, loading: false, error: null });
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await nationsApi.getNation(id, ruleset);

      if (response.success && response.data) {
        setState({
          nation: response.data.nation,
          loading: false,
          error: null,
        });
      } else {
        setState({
          nation: null,
          loading: false,
          error: response.error || 'Failed to fetch nation',
        });
      }
    } catch (error) {
      setState({
        nation: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [id, ruleset]);

  useEffect(() => {
    fetchNation();
  }, [fetchNation]);

  const refetch = useCallback(() => {
    fetchNation();
  }, [fetchNation]);

  return {
    ...state,
    refetch,
  };
}

/**
 * Hook to get available nations filtered and sorted for selection
 */
export function useNationSelection(ruleset: string = 'classic') {
  const { nations, loading, error, metadata, refetch } = useNations(ruleset);

  // Filter out barbarian nation from player selection
  const playableNations = nations.filter(nation => nation.id !== 'barbarian');

  // Sort nations alphabetically by name
  const sortedNations = [...playableNations].sort((a, b) => a.name.localeCompare(b.name));

  return {
    nations: sortedNations,
    allNations: nations,
    loading,
    error,
    metadata,
    refetch,
    count: playableNations.length,
  };
}

/**
 * Hook for nation leaders
 */
export function useNationLeaders(nationId: string, ruleset: string = 'classic') {
  const [leaders, setLeaders] = useState<NationLeader[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaders = useCallback(async () => {
    if (!nationId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await nationsApi.getNationLeaders(nationId, ruleset);

      if (response.success && response.data) {
        setLeaders(response.data.leaders);
      } else {
        setError(response.error || 'Failed to fetch leaders');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [nationId, ruleset]);

  useEffect(() => {
    fetchLeaders();
  }, [fetchLeaders]);

  return {
    leaders,
    loading,
    error,
    refetch: fetchLeaders,
  };
}

/**
 * Hook for available rulesets
 */
export function useRulesets() {
  const [rulesets, setRulesets] = useState<string[]>([]);
  const [defaultRuleset, setDefaultRuleset] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRulesets = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await nationsApi.getRulesets();

      if (response.success && response.data) {
        setRulesets(response.data.rulesets);
        setDefaultRuleset(response.data.default);
      } else {
        setError(response.error || 'Failed to fetch rulesets');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRulesets();
  }, [fetchRulesets]);

  return {
    rulesets,
    defaultRuleset,
    loading,
    error,
    refetch: fetchRulesets,
  };
}
