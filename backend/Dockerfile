# =============================================================================
# RESTOR API image.
#
# Built from the MONOREPO ROOT, because the backend depends on the workspace
# packages (@restor/shared-types, shared-utils, validation):
#
#   docker build -f backend/Dockerfile -t restor-api .
#
# Multi-stage so the runtime image carries no compiler, no dev dependencies and
# no source — only the compiled output and the production tree.
# =============================================================================

# ---------- Stage 1: install ------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

# Copy only the manifests first: this layer is cached until a dependency
# actually changes, which is what keeps rebuilds fast.
COPY package.json package-lock.json ./
COPY backend/package.json                backend/
COPY packages/shared-types/package.json  packages/shared-types/
COPY packages/shared-utils/package.json  packages/shared-utils/
COPY packages/validation/package.json    packages/validation/
COPY packages/api-client/package.json    packages/api-client/
COPY packages/ui/package.json            packages/ui/

# `--ignore-scripts` because `prisma generate` needs the schema, which is not
# copied yet; it runs explicitly in the build stage below.
RUN npm ci --ignore-scripts --workspace=backend \
      --workspace=@restor/shared-types \
      --workspace=@restor/shared-utils \
      --workspace=@restor/validation \
      --include-workspace-root

# ---------- Stage 2: build --------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/ packages/
COPY backend/ backend/

RUN npm run build:packages \
 && npx prisma generate --schema backend/prisma/schema.prisma \
 && npm run build --workspace=backend

# Re-resolve the tree without dev dependencies for the runtime image.
RUN npm ci --omit=dev --ignore-scripts --workspace=backend \
      --workspace=@restor/shared-types \
      --workspace=@restor/shared-utils \
      --workspace=@restor/validation \
      --include-workspace-root \
 && npx prisma generate --schema backend/prisma/schema.prisma

# ---------- Stage 3: development --------------------------------------------
# Target this stage from docker-compose for hot reload.
FROM node:22-alpine AS development

WORKDIR /app
ENV NODE_ENV=development

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema backend/prisma/schema.prisma

WORKDIR /app/backend
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# ---------- Stage 4: production --------------------------------------------
FROM node:22-alpine AS production

# `dumb-init` gives the app a real PID 1, so SIGTERM reaches Node and Nest's
# shutdown hooks drain in-flight requests instead of the container being killed.
RUN apk add --no-cache dumb-init

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules        ./node_modules
COPY --from=build /app/packages            ./packages
COPY --from=build /app/backend/dist        ./backend/dist
COPY --from=build /app/backend/prisma      ./backend/prisma
COPY --from=build /app/backend/package.json ./backend/
COPY --from=build /app/package.json        ./

# Never run as root.
RUN addgroup -g 1001 -S restor \
 && adduser  -u 1001 -S restor -G restor \
 && mkdir -p /app/backend/storage \
 && chown -R restor:restor /app

USER restor
WORKDIR /app/backend

EXPOSE 3000

# Uses the liveness probe the app already exposes (TZ §60).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]

# Migrations are applied at start-up rather than at build time: the database is
# not reachable while the image is being built, and `migrate deploy` is
# idempotent, so a rolling restart is safe.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
