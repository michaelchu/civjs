import { Router } from 'express';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { resolveUnitOverlayOffsets } from '@game/services/UnitPresentationService';

const router = Router();

export const buildRulesetPresentation = (ruleset: string) => {
  const styles = rulesetLoader.loadStylesRuleset(ruleset);
  const terrains = rulesetLoader.getTerrains(ruleset);
  const units = rulesetLoader.getUnits(ruleset);
  const extras = rulesetLoader.getExtras(ruleset);

  return {
    nation_styles: styles.nation_styles,
    city_styles: styles.city_styles,
    music_styles: styles.music_styles,
    terrains: Object.fromEntries(
      Object.entries(terrains).map(([id, terrain]) => [
        id,
        {
          graphic: terrain.graphic,
          graphic_alt: terrain.graphic_alt,
          graphic_alt2: terrain.graphic_alt2,
        },
      ])
    ),
    units: Object.fromEntries(
      Object.entries(units).map(([id, unit]) => [
        id,
        {
          graphic: unit.graphic,
          graphic_alt: unit.graphic_alt,
          offsets: resolveUnitOverlayOffsets(unit.name ?? id),
        },
      ])
    ),
    extras: Object.fromEntries(
      Object.entries(extras).map(([id, extra]) => [
        id,
        {
          name: extra.name,
          rule_name: extra.rule_name,
          graphic: extra.graphic,
          graphic_alt: extra.graphic_alt,
          activity_gfx: extra.activity_gfx,
          act_gfx_alt: extra.act_gfx_alt,
          act_gfx_alt2: extra.act_gfx_alt2,
        },
      ])
    ),
  };
};

router.get('/:ruleset/cities', (request, response) => {
  try {
    response.json(rulesetLoader.loadCitiesRuleset(request.params.ruleset));
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : 'Ruleset not found',
    });
  }
});

router.get('/:ruleset/presentation', (request, response) => {
  try {
    response.json(buildRulesetPresentation(request.params.ruleset));
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : 'Ruleset not found',
    });
  }
});

export default router;
