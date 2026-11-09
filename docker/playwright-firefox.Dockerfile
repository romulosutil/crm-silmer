FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d
WORKDIR /tooling
RUN apt-get update && apt-get install -y --no-install-recommends pulseaudio && rm -rf /var/lib/apt/lists/*
RUN npm install --no-audit --no-fund --ignore-scripts playwright@1.62.1
COPY docker/playwright-firefox-entrypoint.sh ./entrypoint.sh
ENV PULSE_SERVER=unix:/tmp/playwright-pulse.native
CMD ["sh", "./entrypoint.sh"]
