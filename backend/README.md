# RESTOR API

The single backend for every RESTOR client (TZ §3, §69). NestJS 10 +
PostgreSQL 16 + Prisma 6.

## Requirements

Node ≥ 20 · PostgreSQL ≥ 14 · Redis (optional in development)

## Install

```bash
npm install                  # from the repository root
npm run build:packages       # the backend imports @restor/* from dist
```

## Environment

```bash
cp backend/.env.example backend/.env
```

Generate the secrets it asks for:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # JWT ×2
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"     # ENCRYPTION_KEY
```

Every variable is validated at boot by `src/config/env.validation.ts`. The
process **refuses to start** on a bad value — discovering at 3am under load
that `JWT_ACCESS_SECRET` was empty is far worse than failing at deploy time.

Production additionally rejects an empty or wildcard `CORS_ORIGINS`, two
matching JWT secrets, and a missing `ENCRYPTION_KEY`.

## Development

```bash
npm run db:migrate           # create and apply a migration
npm run db:seed              # demo tenant, staff, menu
npm run start:dev            # watch mode on :3000
```

OpenAPI docs: `http://localhost:3000/api/docs` (development only).

## Build and run

```bash
npm run build                # → dist/main.js
npm run start:prod
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run typecheck` | `tsc --noEmit`, includes the seed |
| `npm test` | Unit tests |
| `npm run test:cov` | With coverage |
| `npm run db:migrate` | Create + apply a migration |
| `npm run db:migrate:deploy` | Apply pending migrations (production) |
| `npm run db:seed` | Development data |
| `npm run db:sync-roles` | Re-apply role grants after adding a permission |
| `npm run db:studio` | Prisma Studio |

## Layout

```
src/
├── main.ts                  Bootstrap: prefix, helmet, CORS, Swagger
├── app.module.ts            Module wiring, global guards, middleware order
├── config/                  Environment validation + typed accessor
├── common/
│   ├── context/             AsyncLocalStorage request context
│   ├── middleware/          Context creation, tenant resolution
│   ├── guards/              JWT, permissions, branch scope
│   ├── interceptors/        Response envelope
│   ├── filters/             Exception → envelope
│   ├── pipes/               Zod validation
│   ├── crypto/              AES-256-GCM for stored secrets
│   └── errors/              AppException
├── database/
│   ├── prisma.service.ts    The extended client
│   └── tenant-scope.extension.ts   ← the isolation mechanism
└── modules/                 auth, rbac, platform, subscriptions, branches,
                             employees, catalog, orders, kitchen, storage,
                             audit, realtime, health
```

## Testing

```bash
npm test                     # 36 unit tests
pwsh tests/smoke.ps1         # 59 API checks against a running server
```

See [tests/README.md](tests/README.md) for what each layer proves and why the
split exists.

## Docker

Built from the **repository root** — the backend depends on the workspace
packages:

```bash
docker build -f backend/Dockerfile --target production -t restor-api .
```

The production image runs as a non-root user, has a `dumb-init` PID 1 so
`SIGTERM` reaches Node and Nest's shutdown hooks drain in-flight requests, and
applies migrations on start.

## Notes

- **Tenant isolation** is enforced by a Prisma client extension below the
  service layer. Read the comment at the top of
  `src/database/tenant-scope.extension.ts` before touching a query.
- **Money is an integer in minor units.** Use `@restor/shared-utils/money`; it
  throws on non-integer input.
- **Authentication is opt-out.** The guards are global; a route without
  `@Public()` is protected.
- **Validation schemas are shared** with the web forms via `@restor/validation`,
  so a rule cannot drift between them.
