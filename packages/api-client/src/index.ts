/**
 * @restor/api-client — the only place any RESTOR app talks to the API.
 *
 * Auth, token refresh, the response envelope and error normalisation live here
 * once, so no app re-implements them and they cannot drift apart (TZ §45).
 *
 * Built on the platform `fetch`, which exists in every target: browsers, Node
 * 18+, the Electron/Tauri POS shell and React Native. There is no axios
 * dependency and nothing platform-specific — token persistence is injected
 * through {@link TokenStore}.
 */

export { RestorClient, createRestorClient } from './client';
export { HttpClient } from './http-client';
export type { HttpClientOptions, RequestOptions } from './http-client';
export { RestorApiError } from './errors';
export {
  MemoryTokenStore,
  LocalStorageTokenStore,
  toStoredTokens,
} from './token-store';
export type { TokenStore, StoredTokens } from './token-store';

export { AuthResource } from './resources/auth';
export { PlatformResource } from './resources/platform';
export {
  BranchesResource,
  CompanyResource,
  EmployeesResource,
  RolesResource,
} from './resources/organization';
export { CatalogResource } from './resources/catalog';
export {
  KitchenResource,
  OrdersResource,
  PaymentsResource,
  ReportsResource,
} from './resources/orders';
export { CashResource, PosResource } from './resources/pos';
export { CourierAppResource, CouriersResource } from './resources/delivery';
export {
  AuditResource,
  CustomersResource,
  MarketingResource,
  TablesResource,
  TelegramResource,
} from './resources/misc';
