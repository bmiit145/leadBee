import { AsyncLocalStorage } from 'node:async_hooks';
import { Types } from 'mongoose';

/**
 * The tenant scope for the current async execution.
 *
 * Every request opens exactly one. Services and model hooks read it instead of
 * having `organizationId` threaded through every signature — which is what makes
 * it impossible to *forget* to scope a query.
 */
export interface TenantScope {
  kind: 'tenant';
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: string;
  permissions: string[];
}

/**
 * A deliberate cross-tenant scope. Only platform-admin paths and background
 * sweeps open one, and every site is greppable via `withoutTenantScope(`.
 */
export interface UnscopedScope {
  kind: 'unscoped';
  reason: string;
}

export type Scope = TenantScope | UnscopedScope;

/**
 * A *mutable* box, not the scope itself.
 *
 * Fastify's hook chain means the scope is not known when the request begins —
 * resolving the tenant requires a database read. And an `AsyncLocalStorage.run()`
 * opened inside a `preHandler` ends when that hook returns, so it would not
 * reach the route handler at all.
 *
 * So `onRequest` opens an empty container that spans the whole request, and the
 * auth hook fills it in once it knows who is calling. Same object reference
 * throughout, so every later read sees the resolved scope.
 */
interface ScopeHolder {
  scope?: Scope;
}

const storage = new AsyncLocalStorage<ScopeHolder>();

/**
 * Open an empty scope container around `fn`. Called from the `onRequest` hook;
 * the container is populated later by `setTenantScope` / `setUnscoped`.
 */
export function openScopeContainer<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/** Fill the open container with a tenant scope. */
export function setTenantScope(scope: Omit<TenantScope, 'kind'>): void {
  const holder = storage.getStore();
  if (!holder) {
    throw new Error('setTenantScope() called with no scope container open.');
  }
  holder.scope = { kind: 'tenant', ...scope };
}

/** Fill the open container with a deliberate cross-tenant scope. */
export function setUnscoped(reason: string): void {
  const holder = storage.getStore();
  if (!holder) {
    throw new Error('setUnscoped() called with no scope container open.');
  }
  holder.scope = { kind: 'unscoped', reason };
}

/**
 * Run `fn` in a self-contained tenant scope. For scripts, jobs and tests — the
 * request path uses `openScopeContainer` + `setTenantScope` instead.
 *
 * **Async on purpose.** `AsyncLocalStorage.run` returns as soon as `fn` returns,
 * and a Mongoose query is lazy — `() => Lead.findById(id)` hands back an
 * unexecuted Query, so awaiting it at the call site would run it *after* the
 * scope had closed. Awaiting inside means the query executes while the scope is
 * still open, whether or not the caller remembered `.exec()`.
 */
export async function runInTenantScope<T>(
  scope: Omit<TenantScope, 'kind'>,
  fn: () => T | Promise<T>
): Promise<T> {
  return storage.run({ scope: { kind: 'tenant', ...scope } }, async () => fn());
}

/**
 * Escape hatch for genuinely cross-tenant reads — platform analytics, the
 * superadmin console, background jobs that sweep every org.
 *
 * `reason` is required and appears in logs; an unexplained cross-tenant read is
 * a review finding, not a shortcut.
 *
 * Awaits inside the scope for the same reason as `runInTenantScope`.
 */
export async function withoutTenantScope<T>(
  reason: string,
  fn: () => T | Promise<T>
): Promise<T> {
  return storage.run({ scope: { kind: 'unscoped', reason } }, async () => fn());
}

/** The current scope, or undefined outside any request / before auth resolves. */
export function getScope(): Scope | undefined {
  return storage.getStore()?.scope;
}

/** The current tenant scope, or undefined if unscoped or unresolved. */
export function getTenantScope(): TenantScope | undefined {
  const scope = getScope();
  return scope?.kind === 'tenant' ? scope : undefined;
}

export function requireOrganizationId(): Types.ObjectId {
  const scope = getTenantScope();
  if (!scope) {
    throw new Error(
      'No tenant scope in the current async context. A tenant-owned model was ' +
        'queried outside a request, or outside withoutTenantScope().'
    );
  }
  return scope.organizationId;
}

export function requireUserId(): Types.ObjectId {
  const scope = getTenantScope();
  if (!scope) throw new Error('No tenant scope in the current async context.');
  return scope.userId;
}
