# syntax=docker/dockerfile:1.7
# Multi-stage build for apps/api (NestJS) in a pnpm + Turborepo monorepo.
# Build context: repo root (NOT apps/api). docker-compose.prod.yml sets this.

# ---------- 1. base ----------
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# ---------- 2. deps (install all workspace deps) ----------
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- 3. builder (prisma generate + db build + api build) ----------
FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig*.json ./
COPY packages/db ./packages/db
COPY apps/api ./apps/api
# Generate Prisma client + build db package + build api
RUN pnpm --filter @elorae/db generate \
 && pnpm --filter @elorae/db build \
 && pnpm --filter @elorae/api build

# ---------- 4. prod-deps (production-only workspace install) ----------
# Skips devDependencies (prisma CLI, tsx, typescript, @nestjs/cli, ts-jest, etc.)
# --ignore-scripts prevents @elorae/db's postinstall prisma-generate — we bring
# the already-generated client from the builder stage.
FROM base AS prod-deps
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---------- 5. runtime ----------
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# node_modules from prod-deps (no dev deps)
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /repo/packages/db/node_modules ./packages/db/node_modules
# Built artifacts + prisma generated client from builder
COPY --from=builder /repo/packages/db/dist ./packages/db/dist
COPY --from=builder /repo/packages/db/generated ./packages/db/generated
COPY --from=builder /repo/packages/db/package.json ./packages/db/package.json
COPY --from=builder /repo/packages/db/prisma ./packages/db/prisma
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
# Non-root user
RUN useradd --create-home --shell /bin/sh elorae \
  && chown -R elorae:elorae /app
USER elorae
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
