import type { LeadStage } from '../types';

/**
 * Single source of truth for how a lead stage is presented.
 *
 * The order here is the order the filter tabs render in, and it mirrors
 * LEAD_STAGE_ORDER on the backend — keep the two in step or the tabs will
 * silently omit a stage the API can still return.
 */
export interface LeadStageMeta {
  /** i18n key under `leads.stages` */
  key: LeadStage;
  /** Fallback label when a translation is missing. */
  label: string;
  /** Chip foreground; the background is this at ~15% alpha. */
  color: string;
}

export const LEAD_STAGE_META: Record<LeadStage, LeadStageMeta> = {
  new:            { key: 'new',            label: 'New',            color: '#2F7FD0' },
  assign_lead:    { key: 'assign_lead',    label: 'Assign Lead',    color: '#7B61C9' },
  call_again:     { key: 'call_again',     label: 'Call Again',     color: '#C2731F' },
  follow_up:      { key: 'follow_up',      label: 'Follow Up',      color: '#C25E9B' },
  in_progress:    { key: 'in_progress',    label: 'In Progress',    color: '#1B7A9E' },
  interested:     { key: 'interested',     label: 'Interested',     color: '#2C7A57' },
  meeting:        { key: 'meeting',        label: 'Meeting',        color: '#3E63B8' },
  pipeline:       { key: 'pipeline',       label: 'Pipeline',       color: '#5B6B78' },
  postponed:      { key: 'postponed',      label: 'Postponed',      color: '#8A7A2B' },
  order_received: { key: 'order_received', label: 'Order Received', color: '#1E8E5A' },
  drop:           { key: 'drop',           label: 'Drop',           color: '#BC5430' },
};

/** Tab order. `all` is a view, not a stage, so it is not part of this list. */
export const LEAD_STAGE_ORDER: LeadStage[] = [
  'new',
  'assign_lead',
  'call_again',
  'follow_up',
  'in_progress',
  'interested',
  'meeting',
  'pipeline',
  'postponed',
  'order_received',
  'drop',
];

/** Stages after which no further movement is expected. */
export const TERMINAL_LEAD_STAGES: LeadStage[] = ['order_received', 'drop'];

/** `all` first, then every stage — what the filter strip renders. */
export type LeadStageFilter = 'all' | LeadStage;

export const LEAD_STAGE_FILTERS: LeadStageFilter[] = ['all', ...LEAD_STAGE_ORDER];

/** Hex + alpha suffix, for chip backgrounds. Avoids pulling in a colour lib. */
export function stageTint(stage: LeadStage, alphaHex = '1A'): string {
  return `${LEAD_STAGE_META[stage].color}${alphaHex}`;
}

/** Falls back to the raw value so an unknown stage from the API still renders. */
export function stageLabel(stage: LeadStage, t?: (k: string) => string): string {
  const meta = LEAD_STAGE_META[stage];
  if (!meta) return String(stage);
  if (!t) return meta.label;
  const translated = t(`leads.stages.${stage}`);
  return translated === `leads.stages.${stage}` ? meta.label : translated;
}
