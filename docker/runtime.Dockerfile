FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS build

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

FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS production-dependencies

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/edge-web/package.json apps/edge-web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY modules/shared/package.json modules/shared/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8

ENV HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/dist/runtime/apps ./apps
COPY --from=build --chown=node:node /workspace/dist/runtime/modules ./modules

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]
CMD ["node", "apps/api/src/server.js"]
