import { Router } from 'express';
import nationsRouter from './nations';
import rulesetsRouter from './rulesets';

const router = Router();

/**
 * Main API router
 * Base path: /api
 */

// Mount nations routes
router.use('/nations', nationsRouter);
router.use('/rulesets', rulesetsRouter);

export default router;
