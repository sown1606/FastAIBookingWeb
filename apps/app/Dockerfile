FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY apps/app/package.json ./package.json
RUN npm install

COPY apps/app/tsconfig.json ./tsconfig.json
COPY apps/app/tsconfig.node.json ./tsconfig.node.json
COPY apps/app/vite.config.ts ./vite.config.ts
COPY apps/app/index.html ./index.html
COPY apps/app/public ./public
COPY apps/app/src ./src

ARG VITE_API_BASE_URL=https://api-new-nail.kendemo.com
ARG VITE_APP_BASE_URL=https://app-new-nail.kendemo.com
ARG VITE_ADMIN_BASE_URL=https://admin-new-nail.kendemo.com
ARG VITE_APP_NAME=FastAIBooking

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_APP_BASE_URL=${VITE_APP_BASE_URL}
ENV VITE_ADMIN_BASE_URL=${VITE_ADMIN_BASE_URL}
ENV VITE_APP_NAME=${VITE_APP_NAME}

RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY apps/app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
