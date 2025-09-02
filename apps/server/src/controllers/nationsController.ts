import { Request, Response } from 'express';
import { RulesetLoader } from '../shared/data/rulesets/RulesetLoader';
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
      const { ruleset = 'classic' } = req.query;

      if (typeof ruleset !== 'string') {
        res.status(400).json({
          error: 'Invalid ruleset parameter',
          message: 'Ruleset must be a string',
        });
        return;
      }

      const loader = RulesetLoader.getInstance();
      const nationsRuleset = loader.loadNationsRuleset(ruleset);
      const nations = loader.getNations(ruleset);

      if (!nationsRuleset || !nations) {
        res.status(404).json({
          error: 'Ruleset not found',
          message: `No nations found for ruleset: ${ruleset}`,
        });
        return;
      }

      // Transform nations data to include only essential information for client
      const nationsArray = Object.values(nations).map(nation => ({
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
      const { ruleset = 'classic' } = req.query;

      if (typeof ruleset !== 'string') {
        res.status(400).json({
          error: 'Invalid ruleset parameter',
          message: 'Ruleset must be a string',
        });
        return;
      }

      const loader = RulesetLoader.getInstance();

      let nation;
      try {
        nation = loader.getNation(id, ruleset);
      } catch {
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
      // For now we support only classic ruleset, but this can be extended
      const availableRulesets = ['classic'];

      res.json({
        success: true,
        data: {
          rulesets: availableRulesets,
          default: 'classic',
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
      const { ruleset = 'classic' } = req.query;

      if (typeof ruleset !== 'string') {
        res.status(400).json({
          error: 'Invalid ruleset parameter',
          message: 'Ruleset must be a string',
        });
        return;
      }

      const loader = RulesetLoader.getInstance();

      let nation;
      try {
        nation = loader.getNation(id, ruleset);
      } catch {
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
