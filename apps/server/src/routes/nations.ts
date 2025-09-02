import { Router } from 'express';
import { NationsController } from '../controllers/nationsController';

const router = Router();

/**
 * Nations API routes
 * Base path: /api/nations
 */

/**
 * GET /api/nations
 * Get all available nations for a ruleset
 * Query params:
 *   - ruleset: string (optional, defaults to 'classic')
 */
router.get('/', NationsController.getNations);

/**
 * GET /api/nations/rulesets
 * Get all available rulesets that contain nations
 */
router.get('/rulesets', NationsController.getRulesets);

/**
 * GET /api/nations/:id
 * Get a specific nation by ID
 * Query params:
 *   - ruleset: string (optional, defaults to 'classic')
 */
router.get('/:id', NationsController.getNationById);

/**
 * GET /api/nations/:id/leaders
 * Get leaders for a specific nation
 * Query params:
 *   - ruleset: string (optional, defaults to 'classic')
 */
router.get('/:id/leaders', NationsController.getNationLeaders);

export default router;
