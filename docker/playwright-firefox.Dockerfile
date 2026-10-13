FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
WORKDIR /tooling
RUN apt-get update && apt-get install -y --no-install-recommends pulseaudio && rm -rf /var/lib/apt/lists/*
RUN npm install --no-audit --no-fund --ignore-scripts playwright@1.62.1
COPY docker/playwright-firefox-entrypoint.sh ./entrypoint.sh
ENV PULSE_SERVER=unix:/tmp/playwright-pulse.native
CMD ["sh", "./entrypoint.sh"]
