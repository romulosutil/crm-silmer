FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/edge-web/package.json apps/edge-web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY modules/shared/package.json modules/shared/package.json
RUN npm ci --ignore-scripts
COPY apps apps
COPY modules modules
COPY scripts scripts
RUN npm run build

FROM nginx:1.31.7-alpine-slim@sha256:ebd058041a732a2b2dc0b606e34572dd8e0034de6a4aa4d50d8c13a240ac6005

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=nginx:nginx /workspace/dist/edge-web/ /usr/share/nginx/html/

USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:8080/healthz"]
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
