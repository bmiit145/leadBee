/**
 * Boot-time registration of module manifests into the catalogue.
 *
 * Idempotent: safe to run on every boot, on every instance, concurrently.
 *
 * **Ownership split.** Code owns *structure* — which features exist, their
 * kind, and how they mirror to the legacy fields. An admin owns *presentation*
 * — display name, description, ordering. So structural fields are overwritten
 * on every boot while display fields are written only on insert, and an admin
 * who renames "Leads" to "Enquiries" does not have it silently reverted by the
 * next deploy.
 */

import { CatalogModule } from '../models/CatalogModule.js';
import { FeatureDefinition } from '../models/FeatureDefinition.js';
import { logger } from '../lib/logger.js';
import { MODULE_MANIFESTS, assertManifestsValid } from './manifest.js';

export interface RegistrationResult {
  modulesRegistered: number;
  featuresRegistered: number;
}

export async function registerModuleManifests(): Promise<RegistrationResult> {
  assertManifestsValid();

  const moduleOps = MODULE_MANIFESTS.map((module) => ({
    updateOne: {
      filter: { key: module.key },
      update: {
        // Code owns these.
        $set: { isSystem: true, productKey: module.productKey },
        // The admin may edit these; only seed them.
        $setOnInsert: {
          key: module.key,
          name: module.name,
          description: module.description,
          sortOrder: module.sortOrder,
          isActive: true,
        },
      },
      upsert: true,
    },
  }));

  const featureOps = MODULE_MANIFESTS.flatMap((module) =>
    module.features.map((feature, index) => ({
      updateOne: {
        filter: { key: feature.key },
        update: {
          $set: {
            moduleKey: module.key,
            kind: feature.kind,
            legacyFeatureKey: feature.legacyFeatureKey,
            legacyLimitKey: feature.legacyLimitKey,
            isSystem: true,
          },
          $setOnInsert: {
            key: feature.key,
            name: feature.name,
            description: feature.description,
            sortOrder: (index + 1) * 10,
            isActive: true,
            defaultLimit: null,
            defaultConfig: null,
          },
        },
        upsert: true,
      },
    }))
  );

  // `ordered: false` so one conflicting row does not abandon the rest. A
  // duplicate-key race between two instances booting together is expected and
  // benign — both are writing the same values.
  await CatalogModule.bulkWrite(moduleOps, { ordered: false });
  await FeatureDefinition.bulkWrite(featureOps, { ordered: false });

  const result = {
    modulesRegistered: MODULE_MANIFESTS.length,
    featuresRegistered: featureOps.length,
  };

  logger.info(result, 'entitlement catalogue registered');
  return result;
}
