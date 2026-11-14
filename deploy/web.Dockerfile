# Статика: сайт + онлайн-запись (apps/web) и веб-версия приложения (apps/mobile → Expo web).
# Адреса НЕ зашиваются при сборке — их подставляет 40-mioflow-config.sh при запуске контейнера.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter @salon/web... --filter @salon/mobile...
COPY apps/web apps/web
COPY apps/mobile apps/mobile
# API на том же адресе (/v1) — без CORS
RUN cd apps/web && VITE_API_URL=/v1 pnpm build
RUN cd apps/mobile && CI=1 EXPO_OFFLINE=1 EXPO_PUBLIC_API_URL=/v1 npx expo export --platform web --output-dir dist

FROM nginx:1.27-alpine
COPY deploy/nginx/internal.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/salon-common.conf /etc/nginx/snippets/salon-common.conf
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --chmod=755 deploy/nginx/40-mioflow-config.sh /docker-entrypoint.d/40-mioflow-config.sh
COPY --from=build /repo/apps/web/dist /srv/site
COPY --from=build /repo/apps/mobile/dist /srv/app
