FROM node:26.8.1-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS build

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

FROM nginx:1.31.4-alpine-slim@sha256:1870de6d59aafee152589b64404556d2535922cdd998e6dac1c4888c938ed8f9

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=nginx:nginx /workspace/dist/edge-web/ /usr/share/nginx/html/

USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:8080/healthz"]
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
