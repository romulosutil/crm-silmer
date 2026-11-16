FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579
WORKDIR /tooling
RUN apt-get update && apt-get install -y --no-install-recommends pulseaudio && rm -rf /var/lib/apt/lists/*
RUN npm install --no-audit --no-fund --ignore-scripts playwright@1.62.1
COPY docker/playwright-firefox-entrypoint.sh ./entrypoint.sh
ENV PULSE_SERVER=unix:/tmp/playwright-pulse.native
CMD ["sh", "./entrypoint.sh"]
