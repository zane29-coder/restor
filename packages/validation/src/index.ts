/**
 * @restor/validation — one set of Zod schemas for the whole platform.
 *
 * The backend runs them inside a global validation pipe; the web apps run the
 * same objects in their forms. A rule therefore cannot drift between what the
 * UI accepts and what the API accepts (TZ §52 "input validation").
 *
 * `zod` is a peer dependency so every consumer shares a single instance —
 * two copies of Zod produce schemas that fail each other's `instanceof` checks.
 */

export * from './primitives';
export * from './enums';
export * from './auth';
export * from './tenant';
export * from './branch';
export * from './rbac';
export * from './catalog';
export * from './order';
export * from './telegram';
