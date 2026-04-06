#!/bin/bash
set -e

echo "[entrypoint] VATRadio Server v3 starting"

export XDG_RUNTIME_DIR=/tmp/runtime-root
mkdir -p /tmp/runtime-root /run/dbus

# 1. DBus
dbus-daemon --system --fork 2>/dev/null || true
eval $(dbus-launch --sh-syntax 2>/dev/null) || true
export DBUS_SESSION_BUS_ADDRESS

# 2. Xvfb
Xvfb :99 -screen 0 1024x768x16 -ac -noreset &
sleep 2

# 3. PulseAudio
pulseaudio -D --exit-idle-time=-1 --log-level=error 2>/dev/null || true
sleep 1
pactl load-module module-null-sink sink_name=vatradio sink_properties=device.description=VATRadio 2>/dev/null || true
pactl set-default-sink vatradio 2>/dev/null || true
echo "[entrypoint] PulseAudio ready"

# 4. swiftCore (handles FSD network presence)
if [ -x /opt/swift/bin/swiftcore ]; then
    export LD_LIBRARY_PATH=/opt/swift/bin:${LD_LIBRARY_PATH:-}
    /opt/swift/bin/swiftcore 2>&1 | sed 's/^/[swift] /' &
    sleep 5
    echo "[entrypoint] swiftCore running"
fi

# 5. Node.js (handles AFV audio directly + WebSocket + Whisper)
echo "[entrypoint] Starting server on port ${PORT:-3000}"
exec node /app/dist/index.js
