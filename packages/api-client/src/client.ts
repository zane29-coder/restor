import { HttpClient, type HttpClientOptions } from './http-client';
import { AuthResource } from './resources/auth';
import { CatalogResource } from './resources/catalog';
import { CourierAppResource, CouriersResource } from './resources/delivery';
import {
  AuditResource,
  CustomersResource,
  MarketingResource,
  TablesResource,
  TelegramResource,
} from './resources/misc';
import {
  BranchesResource,
  CompanyResource,
  EmployeesResource,
  RolesResource,
} from './resources/organization';
import {
  KitchenResource,
  OrdersResource,
  PaymentsResource,
  ReportsResource,
} from './resources/orders';
import { PlatformResource } from './resources/platform';
import { CashResource, PosResource } from './resources/pos';

/**
 * The full RESTOR API surface, grouped by resource.
 *
 * Every app builds one of these at startup and shares it. Apps only touch the
 * groups they need — the POS never imports the platform resource — but they all
 * get the same auth, refresh and error behaviour (TZ §45).
 */
export class RestorClient {
  readonly http: HttpClient;

  readonly auth: AuthResource;
  readonly platform: PlatformResource;
  readonly company: CompanyResource;
  readonly branches: BranchesResource;
  readonly employees: EmployeesResource;
  readonly roles: RolesResource;
  readonly catalog: CatalogResource;
  readonly orders: OrdersResource;
  readonly payments: PaymentsResource;
  readonly kitchen: KitchenResource;
  readonly cash: CashResource;
  readonly pos: PosResource;
  readonly couriers: CouriersResource;
  readonly courierApp: CourierAppResource;
  readonly customers: CustomersResource;
  readonly marketing: MarketingResource;
  readonly telegram: TelegramResource;
  readonly tables: TablesResource;
  readonly audit: AuditResource;
  readonly reports: ReportsResource;

  constructor(options: HttpClientOptions) {
    this.http = new HttpClient(options);

    this.auth = new AuthResource(this.http);
    this.platform = new PlatformResource(this.http);
    this.company = new CompanyResource(this.http);
    this.branches = new BranchesResource(this.http);
    this.employees = new EmployeesResource(this.http);
    this.roles = new RolesResource(this.http);
    this.catalog = new CatalogResource(this.http);
    this.orders = new OrdersResource(this.http);
    this.payments = new PaymentsResource(this.http);
    this.kitchen = new KitchenResource(this.http);
    this.cash = new CashResource(this.http);
    this.pos = new PosResource(this.http);
    this.couriers = new CouriersResource(this.http);
    this.courierApp = new CourierAppResource(this.http);
    this.customers = new CustomersResource(this.http);
    this.marketing = new MarketingResource(this.http);
    this.telegram = new TelegramResource(this.http);
    this.tables = new TablesResource(this.http);
    this.audit = new AuditResource(this.http);
    this.reports = new ReportsResource(this.http);
  }
}

export function createRestorClient(options: HttpClientOptions): RestorClient {
  return new RestorClient(options);
}
