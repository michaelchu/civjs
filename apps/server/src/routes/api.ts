import { Router } from 'express';
import nationsRouter from './nations';

const router = Router();

/**
 * Main API router
 * Base path: /api
 */

// Mount nations routes
router.use('/nations', nationsRouter);

export default router;
