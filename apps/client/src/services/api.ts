import { SERVER_URL } from '../config';

/**
 * Base API configuration and utilities
 */
const API_BASE_URL = `${SERVER_URL}/api`;

/**
 * Generic API response interface
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Nation leader interface
 */
export interface NationLeader {
  name: string;
  sex: 'Male' | 'Female';
}

/**
 * Nation trait ranges interface
 */
export interface NationTraits {
  expansionist_min?: number;
  expansionist_max?: number;
  builder_min?: number;
  builder_max?: number;
  trader_min?: number;
  trader_max?: number;
  aggressive_min?: number;
  aggressive_max?: number;
}

/**
 * Nation interface matching server response
 */
export interface Nation {
  id: string;
  name: string;
  plural: string;
  adjective: string;
  class: string;
  style: string;
  init_government: string;
  leaders: NationLeader[];
  cities?: string[];
  traits: NationTraits;
  flag: string;
  flag_alt: string;
  legend: string;
}

/**
 * Nations API response interfaces
 */
export interface NationsResponse {
  nations: Nation[];
  metadata: {
    count: number;
    ruleset: string;
    default_traits: NationTraits;
  };
}

export interface NationResponse {
  nation: Nation;
}

export interface RulesetsResponse {
  rulesets: string[];
  default: string;
}

export interface NationLeadersResponse {
  nation_id: string;
  nation_name: string;
  leaders: NationLeader[];
}

/**
 * Generic fetch wrapper with error handling
 */
async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`API request failed for ${endpoint}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Nations API service
 */
export const nationsApi = {
  /**
   * Get all available nations for a ruleset
   */
  async getNations(ruleset: string = 'classic'): Promise<ApiResponse<NationsResponse>> {
    return fetchApi<NationsResponse>(`/nations?ruleset=${encodeURIComponent(ruleset)}`);
  },

  /**
   * Get a specific nation by ID
   */
  async getNation(id: string, ruleset: string = 'classic'): Promise<ApiResponse<NationResponse>> {
    return fetchApi<NationResponse>(
      `/nations/${encodeURIComponent(id)}?ruleset=${encodeURIComponent(ruleset)}`
    );
  },

  /**
   * Get available rulesets
   */
  async getRulesets(): Promise<ApiResponse<RulesetsResponse>> {
    return fetchApi<RulesetsResponse>('/nations/rulesets');
  },

  /**
   * Get leaders for a specific nation
   */
  async getNationLeaders(
    id: string,
    ruleset: string = 'classic'
  ): Promise<ApiResponse<NationLeadersResponse>> {
    return fetchApi<NationLeadersResponse>(
      `/nations/${encodeURIComponent(id)}/leaders?ruleset=${encodeURIComponent(ruleset)}`
    );
  },
};

/**
 * Export individual API functions for convenience
 */
export const { getNations, getNation, getRulesets, getNationLeaders } = nationsApi;
