FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf
WORKDIR /tooling
RUN apt-get update && apt-get install -y --no-install-recommends pulseaudio && rm -rf /var/lib/apt/lists/*
RUN npm install --no-audit --no-fund --ignore-scripts playwright@1.62.1
COPY docker/playwright-firefox-entrypoint.sh ./entrypoint.sh
ENV PULSE_SERVER=unix:/tmp/playwright-pulse.native
CMD ["sh", "./entrypoint.sh"]
