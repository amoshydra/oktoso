# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build:single-port

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HUB_CONFIG=/data/hub.config.json \
    HUB_DATA_DIR=/data
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "dist/hub.js", "--config", "/data/hub.config.json"]
