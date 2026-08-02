import React from 'react';
import { Trash2, X } from 'lucide-react';
import type { CityWorklistPreset } from '../../services/UserPreferences';
import type { ProductionOption } from '../../types';
import { Button } from '../ui/button';
import { Dialog, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { HudDialogContent } from './HudDialogContent';

export type BatchDialog = 'production' | 'worklist' | 'governor' | 'buy' | 'sell' | null;

export interface GovernorBatchConfig {
  enabled: boolean;
  priority: string;
  autoManageSpecialists: boolean;
  autoManageTiles: boolean;
  autoManageProduction: boolean;
  preventStarvation: boolean;
  maintainHappiness: boolean;
}

const batchTitle = (kind: BatchDialog) =>
  ({
    production: 'Change production',
    worklist: 'Apply worklist',
    governor: 'Configure governors',
    buy: 'Rush production',
    sell: 'Sell improvements',
  })[kind ?? 'production'];

interface BatchActionDialogProps {
  kind: BatchDialog;
  cityCount: number;
  productions: ProductionOption[];
  loading: boolean;
  error: string | null;
  batchRunning: boolean;
  productionId: string;
  onProductionId: (id: string) => void;
  governorConfig: GovernorBatchConfig;
  onGovernorConfig: (config: GovernorBatchConfig) => void;
  commonBuildings: Array<[string, string]>;
  sellBuildingId: string;
  onSellBuildingId: (id: string) => void;
  worklistMode: 'append' | 'replace';
  onWorklistMode: (mode: 'append' | 'replace') => void;
  worklistDraft: ProductionOption[];
  onWorklistDraft: (items: ProductionOption[]) => void;
  presetName: string;
  onPresetName: (name: string) => void;
  presets: CityWorklistPreset[];
  onSavePreset: () => void;
  onDeletePreset: (id: string) => void;
  onApplyPreset: (preset: CityWorklistPreset) => void;
  onClose: () => void;
  onConfirm: () => void;
  totalBuyCost: number;
  treasury: number;
}

export const BatchActionDialog: React.FC<BatchActionDialogProps> = props => {
  const available = props.productions.filter(option => option.available);
  const selectedProduction = available.find(option => option.id === props.productionId);
  const canConfirm =
    !props.batchRunning &&
    !props.loading &&
    !props.error &&
    (props.kind === 'production'
      ? Boolean(selectedProduction)
      : props.kind === 'worklist'
        ? props.worklistDraft.length > 0
        : props.kind === 'sell'
          ? Boolean(props.sellBuildingId)
          : Boolean(props.kind));

  return (
    <Dialog open={Boolean(props.kind)} onOpenChange={open => !open && props.onClose()}>
      <HudDialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {batchTitle(props.kind)} · {props.cityCount} cities
          </DialogTitle>
        </DialogHeader>

        {(props.kind === 'production' || props.kind === 'worklist') && (
          <>
            {props.loading ? (
              <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground">
                Loading authoritative production choices…
              </div>
            ) : props.error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
                {props.error}
              </div>
            ) : (
              <label className="block space-y-2 text-sm font-medium">
                Available production
                <select
                  value={props.kind === 'production' ? props.productionId : ''}
                  onChange={event => {
                    const option = available.find(item => item.id === event.target.value);
                    if (props.kind === 'production') props.onProductionId(event.target.value);
                    else if (option) props.onWorklistDraft([...props.worklistDraft, option]);
                  }}
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2"
                >
                  <option value="">
                    {props.kind === 'production' ? 'Choose production…' : 'Add an item…'}
                  </option>
                  {available.map(option => (
                    <option key={`${option.type}:${option.id}`} value={option.id}>
                      {option.name} · {option.type} · {option.cost} shields
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {props.kind === 'worklist' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              {(['append', 'replace'] as const).map(mode => (
                <Button
                  key={mode}
                  size="sm"
                  variant={props.worklistMode === mode ? 'default' : 'outline'}
                  onClick={() => props.onWorklistMode(mode)}
                >
                  {mode === 'append' ? 'Append queue' : 'Replace queue'}
                </Button>
              ))}
            </div>
            <div className="min-h-24 space-y-2 rounded-md border p-3">
              {props.worklistDraft.length === 0 ? (
                <p className="text-sm text-muted-foreground">Add production items above.</p>
              ) : (
                props.worklistDraft.map((option, index) => (
                  <div
                    key={`${option.type}:${option.id}:${index}`}
                    className="flex items-center justify-between rounded bg-muted px-3 py-2 text-sm"
                  >
                    <span>
                      {index + 1}. {option.name}{' '}
                      <span className="text-muted-foreground">({option.cost})</span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        props.onWorklistDraft(
                          props.worklistDraft.filter((_, itemIndex) => itemIndex !== index)
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Named worklist presets</div>
              <div className="flex gap-2">
                <Input
                  value={props.presetName}
                  onChange={event => props.onPresetName(event.target.value)}
                  placeholder="Preset name"
                />
                <Button
                  variant="outline"
                  disabled={!props.presetName.trim() || props.worklistDraft.length === 0}
                  onClick={props.onSavePreset}
                >
                  Save
                </Button>
              </div>
              {props.presets.length > 0 && (
                <div className="mt-3 space-y-2">
                  {props.presets.map(preset => (
                    <div key={preset.id} className="flex items-center justify-between text-sm">
                      <button
                        className="text-left font-medium hover:text-primary"
                        onClick={() => props.onApplyPreset(preset)}
                      >
                        {preset.name} · {preset.items.length} items
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => props.onDeletePreset(preset.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {props.kind === 'governor' && (
          <div className="space-y-4">
            <label className="flex items-center justify-between rounded-md border p-3">
              <span>
                <span className="block font-medium">Enable citizen governor</span>
                <span className="text-sm text-muted-foreground">
                  Apply these settings to every selected city.
                </span>
              </span>
              <input
                type="checkbox"
                checked={props.governorConfig.enabled}
                onChange={event =>
                  props.onGovernorConfig({ ...props.governorConfig, enabled: event.target.checked })
                }
                className="h-5 w-5"
              />
            </label>
            <label className="block text-sm font-medium">
              Priority
              <select
                value={props.governorConfig.priority}
                onChange={event =>
                  props.onGovernorConfig({ ...props.governorConfig, priority: event.target.value })
                }
                className="mt-2 w-full rounded-md border bg-background px-3 py-2"
              >
                {['balanced', 'food', 'shields', 'trade', 'science', 'gold', 'luxury'].map(
                  priority => (
                    <option key={priority} value={priority}>
                      {priority[0].toUpperCase() + priority.slice(1)}
                    </option>
                  )
                )}
              </select>
            </label>
            {(
              [
                ['autoManageTiles', 'Manage worked tiles'],
                ['autoManageSpecialists', 'Manage specialists'],
                ['autoManageProduction', 'Choose production'],
                ['preventStarvation', 'Prevent starvation'],
                ['maintainHappiness', 'Maintain happiness'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={props.governorConfig[key]}
                  onChange={event =>
                    props.onGovernorConfig({
                      ...props.governorConfig,
                      [key]: event.target.checked,
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        )}

        {props.kind === 'buy' && (
          <div className="rounded-lg border bg-muted/40 p-5">
            <div className="flex justify-between text-sm">
              <span>Estimated selected cost</span>
              <strong>{props.totalBuyCost} gold</strong>
            </div>
            <div className="mt-2 flex justify-between text-sm">
              <span>Treasury</span>
              <strong>{props.treasury} gold</strong>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              The server buys the lowest-cost eligible production first and reports cities it cannot
              afford.
            </p>
          </div>
        )}

        {props.kind === 'sell' && (
          <label className="block text-sm font-medium">
            Sell an improvement where present
            <select
              value={props.sellBuildingId}
              onChange={event => props.onSellBuildingId(event.target.value)}
              className="mt-2 w-full rounded-md border bg-background px-3 py-2"
            >
              <option value="">Choose an improvement…</option>
              {props.commonBuildings.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={!canConfirm} onClick={props.onConfirm}>
            {props.batchRunning ? 'Applying…' : 'Apply to selected'}
          </Button>
        </div>
      </HudDialogContent>
    </Dialog>
  );
};
