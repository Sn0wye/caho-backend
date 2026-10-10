FROM node:24.15.0-alpine AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate \
  && pnpm config set store-dir /pnpm/store

FROM base AS dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
# CI exports ordinary layers; cache mounts disappear with ephemeral runners.
RUN pnpm fetch --frozen-lockfile

FROM dependencies AS prod-deps
COPY package.json ./
# fetch populates the virtual store with dev packages too. Recreate only prod
# links and package files instead of carrying orphaned build tools into runtime.
RUN rm -rf node_modules && pnpm install --offline --frozen-lockfile --prod

FROM dependencies AS builder
COPY package.json ./
RUN pnpm install --offline --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN pnpm run build

FROM node:24.15.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 8080
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Read at startup by dist/migrate.js, including standalone Coolify deployments.
COPY migrations ./migrations
COPY package.json ./
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD wget -q -T 3 -O /dev/null http://127.0.0.1:8080/ping || exit 1
# Failed migrations must stop startup; exec lets Node receive container signals.
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/server.js"]
