FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/edge-web/package.json apps/edge-web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY modules/audit-privacy/package.json modules/audit-privacy/package.json
COPY modules/catalog/package.json modules/catalog/package.json
COPY modules/configuration/package.json modules/configuration/package.json
COPY modules/contacts/package.json modules/contacts/package.json
COPY modules/database/package.json modules/database/package.json
COPY modules/identity-access/package.json modules/identity-access/package.json
COPY modules/inbox-channels/package.json modules/inbox-channels/package.json
COPY modules/integration-reliability/package.json modules/integration-reliability/package.json
COPY modules/shared/package.json modules/shared/package.json
RUN npm ci --ignore-scripts
COPY apps apps
COPY modules modules
COPY scripts scripts
RUN npm run build

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS production-dependencies

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/edge-web/package.json apps/edge-web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY modules/audit-privacy/package.json modules/audit-privacy/package.json
COPY modules/catalog/package.json modules/catalog/package.json
COPY modules/configuration/package.json modules/configuration/package.json
COPY modules/contacts/package.json modules/contacts/package.json
COPY modules/database/package.json modules/database/package.json
COPY modules/identity-access/package.json modules/identity-access/package.json
COPY modules/inbox-channels/package.json modules/inbox-channels/package.json
COPY modules/integration-reliability/package.json modules/integration-reliability/package.json
COPY modules/shared/package.json modules/shared/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

ENV HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=3000
WORKDIR /app

RUN rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/dist/runtime/apps ./apps
COPY --from=build --chown=node:node /workspace/dist/runtime/modules ./modules

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]
CMD ["node", "apps/api/src/server.js"]
