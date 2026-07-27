import { Router } from 'express';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

const router = Router();

router.get('/:ruleset/cities', (request, response) => {
  try {
    response.json(rulesetLoader.loadCitiesRuleset(request.params.ruleset));
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : 'Ruleset not found',
    });
  }
});

export default router;
