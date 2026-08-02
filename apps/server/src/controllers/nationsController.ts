/**
 * @module server/controllers/nationsController
 * Handles nations Controller HTTP controller behavior.
 */
import { Request, Response } from 'express';
import { RulesetLoader } from '../shared/data/rulesets/RulesetLoader';
import { DEFAULT_RULESET } from '../shared/data/rulesets/defaultRuleset';
import logger from '../utils/logger';

/**
 * Nations controller providing REST API endpoints for nation data
 * Serves nation information from rulesets to client applications
 */
export class NationsController {
  /**
   * Get all available nations for a specific ruleset
   */
  static async getNations(req: Request, res: Response): Promise<void> {
    try {
      const { ruleset = DEFAULT_RULESET, nationSet } = req.query;

      // Express query parameters are always strings or arrays
      // Check for invalid values like arrays or empty strings
      if (typeof ruleset !== 'string' || Array.isArray(ruleset) || ruleset.trim() === '') {
        res.status(400).json({
          error: 'Invalid ruleset parameter',
          message: 'Ruleset must be a string',
        });
        return;
      }
      if (
        nationSet !== undefined &&
        (typeof nationSet !== 'string' || Array.isArray(nationSet) || nationSet.trim() === '')
      ) {
        res.status(400).json({
          error: 'Invalid nation set parameter',
          message: 'Nation set must be a non-empty string',
        });
        return;
      }

      const loader = RulesetLoader.getInstance();

      // Try to load the ruleset - this will throw if not found
      let nationsRuleset, nations, activeNationSet;
      try {
        nationsRuleset = loader.loadNationsRuleset(ruleset);
        activeNationSet = loader.resolveNationSet(ruleset, nationSet);
        nations = loader.getNationsForSet(ruleset, activeNationSet);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Nation set')) {
          res.status(400).json({
            error: 'Invalid nation set parameter',
            message: error.message,
          });
          return;
        }
        res.status(404).json({
          error: 'Ruleset not found',
          message: `No nations found for ruleset: ${ruleset}`,
        });
        return;
      }

      if (!nationsRuleset || !nations) {
        res.status(404).json({
          error: 'Ruleset not found',
          message: `No nations found for ruleset: ${ruleset}`,
        });
        return;
      }

      // Transform nations data to include only essential information for client
      const nationsArray = Object.values(nations)
        // Freeciv keeps Barbarian, Pirate, and Animal Kingdom in the nation
        // catalogue, but they are not player-selectable nations.
        .filter(nation => nation.is_playable !== false)
        .map(nation => ({
          id: nation.id,
          name: nation.name,
          plural: nation.plural,
          adjective: nation.adjective,
          class: nation.class,
          style: nation.style,
          init_government: nation.init_government,
          leaders: nation.leaders,
          flag: nation.flag,
          flag_alt: nation.flag_alt,
          legend: nation.legend,
          traits: nation.traits,
        }));

      res.json({
        success: true,
        data: {
          nations: nationsArray,
          metadata: {
            count: nationsArray.length,
            ruleset: ruleset,
            nationSet: activeNationSet,
            default_traits: nationsRuleset.default_traits,
          },
        },
      });
    } catch (error) {
      logger.error('Error fetching nations:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve nations data',
      });
    }
  }

  /**
   * Get a specific nation by ID for a ruleset
   */
  static async getNationById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { ruleset = DEFAULT_RULESET, nationSet } = req.query;

      if (typeof ruleset !== 'string' || Array.isArray(ruleset) || ruleset.trim() === '') {
        res.status(400).json({
          error: 'Invalid ruleset parameter',
          message: 'Ruleset must be a string',
        });
        return;
      }
      if (
        nationSet !== undefined &&
        (typeof nationSet !== 'string' || Array.isArray(nationSet) || nationSet.trim() === '')
      ) {
        res.status(400).json({
          error: 'Invalid nation set parameter',
          message: 'Nation set must be a non-empty string',
        });
        return;
      }

      const loader = RulesetLoader.getInstance();

      let nations;
      try {
        nations = loader.getNationsForSet(ruleset, nationSet);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Nation set')) {
          res.status(400).json({
            error: 'Invalid nation set parameter',
            message: error.message,
          });
          return;
        }
        res.status(404).json({
          error: 'Ruleset not found',
          message: `No nations found for ruleset: ${ruleset}`,
        });
        return;
      }

      const nation = nations[id];
      if (!nation || nation.is_playable === false) {
        res.status(404).json({
          error: 'Nation not found',
          message: `Nation with ID '${id}' not found in ruleset '${ruleset}'`,
        });
        return;
      }

      res.json({
        success: true,
        data: {
          nation: {
            id: nation.id,
            name: nation.name,
            plural: nation.plural,
            adjective: nation.adjective,
            class: nation.class,
            style: nation.style,
            init_government: nation.init_government,
            leaders: nation.leaders,
            traits: nation.traits,
            flag: nation.flag,
            flag_alt: nation.flag_alt,
            legend: nation.legend,
          },
        },
      });
    } catch (error) {
      logger.error('Error fetching nation:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve nation data',
      });
    }
  }

  /**
   * Get available rulesets that contain nations
   */
  static async getRulesets(_req: Request, res: Response): Promise<void> {
    try {
      const availableRulesets = RulesetLoader.getInstance().getAvailableRulesets();

      res.json({
        success: true,
        data: {
          rulesets: availableRulesets,
          default: DEFAULT_RULESET,
        },
      });
    } catch (error) {
      logger.error('Error fetching rulesets:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve rulesets',
      });
    }
  }

  /**
   * Get nation leaders for a specific nation
   */
  static async getNationLeaders(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { ruleset = DEFAULT_RULESET, nationSet } = req.query;

      if (typeof ruleset !== 'string' || Array.isArray(ruleset) || ruleset.trim() === '') {
        res.status(400).json({
          error: 'Invalid ruleset parameter',
          message: 'Ruleset must be a string',
        });
        return;
      }
      if (
        nationSet !== undefined &&
        (typeof nationSet !== 'string' || Array.isArray(nationSet) || nationSet.trim() === '')
      ) {
        res.status(400).json({
          error: 'Invalid nation set parameter',
          message: 'Nation set must be a non-empty string',
        });
        return;
      }

      const loader = RulesetLoader.getInstance();

      let nations;
      try {
        nations = loader.getNationsForSet(ruleset, nationSet);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Nation set')) {
          res.status(400).json({
            error: 'Invalid nation set parameter',
            message: error.message,
          });
          return;
        }
        res.status(404).json({
          error: 'Ruleset not found',
          message: `No nations found for ruleset: ${ruleset}`,
        });
        return;
      }

      const nation = nations[id];
      if (!nation || nation.is_playable === false) {
        res.status(404).json({
          error: 'Nation not found',
          message: `Nation with ID '${id}' not found in ruleset '${ruleset}'`,
        });
        return;
      }

      res.json({
        success: true,
        data: {
          nation_id: id,
          nation_name: nation.name,
          leaders: nation.leaders,
        },
      });
    } catch (error) {
      logger.error('Error fetching nation leaders:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve nation leaders',
      });
    }
  }
}
