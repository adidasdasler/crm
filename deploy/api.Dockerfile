# ── build ──
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && apt-get clean
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @salon/api...
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate && pnpm build \
 && npx tsc prisma/seed.ts --outDir dist-seed --rootDir . --esModuleInterop --skipLibCheck --module commonjs --target es2022
RUN pnpm deploy --filter @salon/api --prod --legacy /out \
 && cp -r apps/api/dist apps/api/dist-seed apps/api/prisma /out/ \
 && cd /out && npx prisma@6.19.3 generate --schema prisma/schema.prisma

# ── runtime ──
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && apt-get clean
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out /app
# Папка для фото дизайнов: том Docker наследует её владельца при первом создании
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Миграции применяются при старте (идемпотентно), затем seed тарифов и запуск API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist-seed/prisma/seed.js && node dist/main.js"]
