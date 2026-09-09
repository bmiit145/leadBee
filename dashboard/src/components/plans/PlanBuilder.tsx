import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Input, Select } from '@/components/ui/primitives';
import type { CatalogFeature, CatalogModule, FeatureGrant } from '@/types';

const UNLIMITED = -1;

/**
 * The plan builder: modules as sections, features as rows.
 *
 * It renders whatever `/catalog` returns and knows nothing about which modules
 * or features exist. That is the whole point — a Call Log module shipped in a
 * backend release appears here as a section of checkboxes with no change to
 * this file.
 */
export function PlanBuilder({
  catalog,
  grants,
  onChange,
  disabled,
}: {
  catalog: CatalogModule[];
  grants: FeatureGrant[];
  onChange: (next: FeatureGrant[]) => void;
  disabled?: boolean;
}) {
  const byKey = useMemo(
    () => new Map(grants.map((g) => [g.featureKey, g])),
    [grants]
  );

  function setGrant(featureKey: string, patch: Partial<FeatureGrant>) {
    const existing = byKey.get(featureKey) ?? {
      featureKey,
      enabled: false,
      limit: null,
      config: null,
    };
    const next = grants.filter((g) => g.featureKey !== featureKey);
    next.push({ ...existing, ...patch });
    onChange(next.sort((a, b) => a.featureKey.localeCompare(b.featureKey)));
  }

  /** Toggle every feature in a module at once. */
  function setModule(module: CatalogModule, enabled: boolean) {
    const keys = new Set(module.features.map((f) => f.key));
    const next = grants.filter((g) => !keys.has(g.featureKey));
    for (const feature of module.features) {
      const existing = byKey.get(feature.key);
      next.push({
        featureKey: feature.key,
        enabled,
        // Enabling a limit feature with nothing set would mean a ceiling of
        // zero, which reads as "granted but unusable". Seed it to unlimited and
        // let the operator tighten it.
        limit:
          feature.kind === 'limit'
            ? (existing?.limit ?? feature.defaultLimit ?? UNLIMITED)
            : (existing?.limit ?? null),
        config: existing?.config ?? feature.defaultConfig ?? null,
      });
    }
    onChange(next.sort((a, b) => a.featureKey.localeCompare(b.featureKey)));
  }

  return (
    <div className="space-y-5">
      {catalog.map((module) => {
        const enabledCount = module.features.filter(
          (f) => byKey.get(f.key)?.enabled
        ).length;
        const allOn = enabledCount === module.features.length;

        return (
          <section
            key={module.key}
            className="rounded-lg border border-[var(--border)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-[14px] font-semibold text-[var(--text)]">
                    {module.name}
                  </h3>
                  <span className="text-[11px] text-[var(--text-subtle)]">
                    {enabledCount}/{module.features.length}
                  </span>
                </div>
                {module.description && (
                  <p className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">
                    {module.description}
                  </p>
                )}
              </div>

              <label className="flex shrink-0 items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={allOn}
                  // Partially-enabled reads as indeterminate rather than as a
                  // lie in either direction.
                  ref={(el) => {
                    if (el) el.indeterminate = enabledCount > 0 && !allOn;
                  }}
                  disabled={disabled}
                  onChange={(e) => setModule(module, e.target.checked)}
                  aria-label={`Include the whole ${module.name} module`}
                />
                Include module
              </label>
            </header>

            <div className="divide-y divide-[var(--border)]">
              {module.features.map((feature) => (
                <FeatureRow
                  key={feature.key}
                  feature={feature}
                  grant={byKey.get(feature.key)}
                  disabled={disabled}
                  onChange={(patch) => setGrant(feature.key, patch)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FeatureRow({
  feature,
  grant,
  onChange,
  disabled,
}: {
  feature: CatalogFeature;
  grant?: FeatureGrant;
  onChange: (patch: Partial<FeatureGrant>) => void;
  disabled?: boolean;
}) {
  const enabled = grant?.enabled ?? false;
  const limit = grant?.limit ?? feature.defaultLimit ?? null;
  const isUnlimited = limit === UNLIMITED;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <label className="flex min-w-0 flex-1 items-center gap-2.5">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              enabled: e.target.checked,
              limit:
                feature.kind === 'limit' && e.target.checked && limit === null
                  ? UNLIMITED
                  : limit,
            })
          }
        />
        <span className="min-w-0">
          <span
            className={cn(
              'block text-[13px]',
              enabled ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'
            )}
          >
            {feature.name}
          </span>
          <code className="block truncate text-[11px] text-[var(--text-subtle)]">
            {feature.key}
          </code>
        </span>
      </label>

      {feature.kind === 'limit' && enabled && (
        <div className="flex items-center gap-2">
          <Select
            value={isUnlimited ? 'unlimited' : 'capped'}
            disabled={disabled}
            onChange={(e) =>
              onChange({ limit: e.target.value === 'unlimited' ? UNLIMITED : 0 })
            }
            className="w-auto"
            aria-label={`${feature.name} ceiling type`}
          >
            <option value="unlimited">Unlimited</option>
            <option value="capped">Capped at</option>
          </Select>

          {!isUnlimited && (
            <Input
              type="number"
              min={0}
              value={limit ?? 0}
              disabled={disabled}
              onChange={(e) => onChange({ limit: Math.max(0, Number(e.target.value)) })}
              className="w-28"
              aria-label={`${feature.name} limit`}
            />
          )}
        </div>
      )}

      {feature.kind === 'config' && enabled && (
        <span className="text-[11px] text-[var(--text-subtle)]">
          configured per tenant
        </span>
      )}
    </div>
  );
}
