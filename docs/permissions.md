# Permissions & roles

Source of truth: [`packages/shared-types/src/rbac.ts`](../packages/shared-types/src/rbac.ts).
The backend, the admin UI and the seed all read from it — there is no second
list.

---

## Model

```
User ──< UserRole >── Role ──< RolePermission >── Permission
             │
             └─ branchId (nullable)
```

- A **permission** is a dotted `resource.action` string: `orders.cancel`.
- A **role** is a named bundle of permissions.
- A **user** holds one or more roles, each optionally scoped to a branch.

Guards check permissions, never role names. That is what lets a tenant's own
custom role behave exactly like a built-in one, and it means granting a
capability is a data change rather than a code change.

### Branch scoping

A `UserRole` row may carry a `branchId`. **An empty branch list means "every
branch of the tenant"** — that is how owners and company admins are stored, and
why a cashier with one branch sees exactly one branch in a list.

---

## System roles

Seeded per tenant as ordinary rows, so an admin can duplicate one and adjust
the copy.

| Role | Intent |
| --- | --- |
| `SUPER_ADMIN` | Platform staff. `tenantId: null`; outside every tenant |
| `OWNER` | Everything inside their own tenant |
| `COMPANY_ADMIN` | Day-to-day administration; no branding or destructive deletes |
| `BRANCH_MANAGER` | Full control of one branch's floor |
| `CASHIER` | The till |
| `KITCHEN` | The KDS. Cannot see money |
| `COURIER` | Own jobs and own wallet. Nothing else |
| `FINANCE` | Money, reports, courier settlement |
| `OPERATOR` | Call centre / dispatch |
| `MARKETING` | Promotions, loyalty, customer export |
| `SUPPORT` | Read-only, plus correcting a customer's details |

`SUPER_ADMIN` is granted `ALL_PERMISSIONS` at seed time **and** short-circuits
the guard, so a newly added permission never has to be back-filled into it.

---

## Boundaries worth stating

These are asserted in [`backend/tests/unit/rbac.spec.ts`](../backend/tests/unit/rbac.spec.ts),
so a change that crosses one fails a test rather than shipping.

| Boundary | Why |
| --- | --- |
| A cashier can **take** payment but not **refund** it | Reversing a payment is a different level of trust from accepting one |
| A cashier cannot reprice the menu | `products.price.update` is separate from `products.update` precisely so a shift manager can fix a typo without repricing |
| The kitchen sees no money at all | A KDS is a wall-mounted screen in a shared space |
| A courier sees only their own jobs and wallet | Enforced server-side: the app never sends its own courier id |
| `SUPER_ADMIN` cannot be assigned by a tenant admin | Otherwise any company admin could escalate to platform access |
| Platform permissions appear in no tenant role | Same reason |
| Support can update a customer but not delete one | Support corrects a phone number; it does not erase history |

Cashier, kitchen and courier roles each hold `branches.view`: a POS header, a
KDS branch picker and a courier's pickup address all need it, and a screen that
cannot read its own branch cannot render.

---

## Permission groups

Used to lay out the role editor. Every permission belongs to exactly one group
— asserted by a test, so a new permission cannot go missing from the UI.

Platform · Company · Branches · Staff · Menu · Orders · Kitchen · POS & Cash ·
Delivery · Customers · Marketing · Tables · Telegram · Finance · Audit

---

## Using permissions

**Backend** — on a controller method or the whole class:

```ts
@RequirePermissions(Permission.ORDERS_CANCEL)          // all of them
@RequireAnyPermission(Permission.PRODUCTS_UPDATE,      // at least one
                      Permission.PRODUCTS_PRICE_UPDATE)
@SuperAdminOnly()                                      // platform staff only
@Public()                                              // no token required
```

Authentication is **opt-out**: the guards are global, so forgetting a decorator
leaves a route protected rather than open.

**Frontend** — presentation only:

```tsx
const { can } = useAuth();
{can(Permission.ORDERS_CANCEL) && <CancelButton />}
<Can permission={Permission.PRODUCTS_CREATE}><AddProduct /></Can>
```

A hidden button is a courtesy, never a control. The backend enforces the same
permission on the call itself.

---

## Custom roles

An admin with `roles.create` can build a role from the same catalog — the
spec's "Senior Cashier" example is exactly this:

```
orders.view · orders.create · orders.cancel · payments.receive · cashbox.view
```

System roles cannot be edited or deleted; the API returns 403 and suggests
duplicating instead. A role still held by a user cannot be deleted either —
the error names how many.

---

## After adding a permission

Permissions are baked into the access token, and existing tenants were seeded
with the old set.

1. Add it to `Permission` and to a `PERMISSION_GROUPS` entry.
2. Add it to the relevant `DEFAULT_ROLE_PERMISSIONS` roles.
3. `npm run build:packages`
4. `npm run db:sync-roles --workspace=backend`

The sync script upserts the catalog and reconciles every `isSystem` role across
all tenants. Custom roles are left alone — their grants are a deliberate
choice. Staff must sign in again for the change to reach their tokens.

---

## Why permissions live in the token

Authorising a request costs no database round trip. The trade-off is that a
permission change takes effect at the next refresh, which is why the access
token's TTL is 15 minutes and why every path that changes a user's access —
role assignment, deactivation, password change — revokes their refresh tokens
immediately.
