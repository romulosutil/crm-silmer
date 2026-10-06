FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac
WORKDIR /tooling
RUN apt-get update && apt-get install -y --no-install-recommends pulseaudio && rm -rf /var/lib/apt/lists/*
RUN npm install --no-audit --no-fund --ignore-scripts playwright@1.62.1
COPY docker/playwright-firefox-entrypoint.sh ./entrypoint.sh
ENV PULSE_SERVER=unix:/tmp/playwright-pulse.native
CMD ["sh", "./entrypoint.sh"]
