/**
 * @restor/shared-types — the single source of truth for API contracts.
 *
 * Every client (admin web, customer web, mini app, POS, KDS, courier app) and
 * the backend import from here. Nobody hand-writes a duplicate interface
 * (TZ §44).
 */

export * from './api';
export * from './error-codes';
export * from './enums';
export * from './rbac';
export * from './events';

export * from './models/tenant';
export * from './models/identity';
export * from './models/branch';
export * from './models/catalog';
export * from './models/order';
export * from './models/operations';
export * from './models/crm';
export * from './models/platform';
