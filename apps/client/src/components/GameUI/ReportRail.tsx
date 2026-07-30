import React from 'react';
import { Building2, Flag, FlaskConical, Landmark } from 'lucide-react';
import { HudIconButton } from './HudIconButton';
import { HudPanel } from './HudPanel';

export interface ReportRailProps {
  onOpenGovernment: () => void;
  onOpenResearch: () => void;
  onOpenDiplomacy: () => void;
  onOpenEmpire: () => void;
}

/** Compact left-side launchers for reports that used to be full-screen tabs. */
export const ReportRail: React.FC<ReportRailProps> = ({
  onOpenGovernment,
  onOpenResearch,
  onOpenDiplomacy,
  onOpenEmpire,
}) => (
  <HudPanel
    className="pointer-events-auto z-30 flex shrink-0 flex-col gap-1 p-1"
    aria-label="Reports"
  >
    <HudIconButton label="Government report" title="Government" onClick={onOpenGovernment}>
      <Landmark className="h-4 w-4" aria-hidden="true" />
    </HudIconButton>
    <HudIconButton label="Research report" title="Research" onClick={onOpenResearch}>
      <FlaskConical className="h-4 w-4" aria-hidden="true" />
    </HudIconButton>
    <HudIconButton label="Diplomacy report" title="Diplomacy" onClick={onOpenDiplomacy}>
      <Flag className="h-4 w-4" aria-hidden="true" />
    </HudIconButton>
    <HudIconButton label="Empire report" title="Empire" onClick={onOpenEmpire}>
      <Building2 className="h-4 w-4" aria-hidden="true" />
    </HudIconButton>
  </HudPanel>
);
