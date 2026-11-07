# Собирает статику: сайт + онлайн-запись (apps/web) и веб-версию CRM (apps/mobile → Expo web),
# и отдаёт её внутренним Nginx, который также проксирует /v1 → api.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
ARG PUBLIC_WEB_URL=https://mioflow.ru
ARG APP_URL=https://app.mioflow.ru
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter @salon/web... --filter @salon/mobile...
COPY apps/web apps/web
COPY apps/mobile apps/mobile
# API на том же домене (/v1) — без CORS, cookie SameSite работают «из коробки».
RUN cd apps/web && VITE_API_URL=/v1 VITE_APP_URL=$APP_URL pnpm build
RUN cd apps/mobile && CI=1 EXPO_OFFLINE=1 EXPO_PUBLIC_API_URL=/v1 EXPO_PUBLIC_WEB_URL=$PUBLIC_WEB_URL EXPO_PUBLIC_APP_URL=$APP_URL \
    npx expo export --platform web --output-dir dist

FROM nginx:1.27-alpine
COPY deploy/nginx/internal.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/salon-common.conf /etc/nginx/snippets/salon-common.conf
COPY --from=build /repo/apps/web/dist /srv/site
COPY --from=build /repo/apps/mobile/dist /srv/app
