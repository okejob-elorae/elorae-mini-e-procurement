# syntax=docker/dockerfile:1.7
# Multi-stage build for apps/web (Next.js) in a pnpm + Turborepo monorepo.
# Build context: repo root (NOT apps/web). docker-compose.prod.yml sets this.

# ---------- 1. base ----------
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# ---------- 2. deps ----------
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- 3. builder (prisma generate + db build + web build) ----------
FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig*.json ./
COPY packages/db ./packages/db
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
# Bump node heap for the Next.js build — default 2GB OOMs on the apps/web bundle.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm --filter @elorae/db generate \
 && pnpm --filter @elorae/db build \
 && pnpm --filter @elorae/web build

# ---------- 4. runtime ----------
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
# Copy standalone output (self-contained) + static + public
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public
# Non-root user
RUN useradd --create-home --shell /bin/sh elorae \
  && chown -R elorae:elorae /app
USER elorae
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["node", "server.js"]
