#!/bin/sh
set -eu
# A private null sink supplies an audio clock/decoder output without host devices.
pulseaudio --system --disallow-exit --daemonize=yes --exit-idle-time=-1 -n \
  --load="module-native-protocol-unix socket=/tmp/playwright-pulse.native auth-anonymous=1" \
  --load="module-null-sink sink_name=playwright"
exec ./node_modules/.bin/playwright run-server --host 0.0.0.0 --port 31927 \
  --path /media-recorder-firefox --max-clients 1 --unsafe
