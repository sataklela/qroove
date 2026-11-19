# syntax=docker/dockerfile:1
FROM node:24-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @qroove/server deploy --prod --legacy /out/server

FROM node:24-slim AS runtime
ENV NODE_ENV=production
# curl for Coolify's health check (GET /api/health) on the Sataklela VPS.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends curl >/dev/null && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/docs/.vitepress/dist ./docs/.vitepress/dist
USER node
CMD ["node", "apps/server/dist/main.js"]
