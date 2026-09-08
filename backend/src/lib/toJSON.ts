/**
 * Shared `toJSON` transform.
 *
 * Every model strips `__v`, and tenant-owned models also strip
 * `organizationId` — an internal routing key that clients have no use for and
 * that echoing back only invites someone to try sending.
 *
 * The parameters are `any` deliberately. Mongoose types the transform's `ret`
 * as the hydrated document type, which has no string index signature, so a
 * `Record<string, unknown>` signature is rejected at every call site. Widening
 * here keeps that cast in one file instead of seven.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Transform = (doc: any, ret: any) => any;

export function jsonTransform(...omit: string[]): Transform {
  return (_doc: any, ret: any) => {
    delete ret.__v;
    for (const key of omit) delete ret[key];
    return ret;
  };
}

/** Tenant-owned models: hide the tenant key plus anything else named. */
export function tenantJsonTransform(...omit: string[]): Transform {
  return jsonTransform('organizationId', ...omit);
}
