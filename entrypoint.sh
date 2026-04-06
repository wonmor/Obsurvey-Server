#!/bin/bash
set -e

echo "[entrypoint] Starting VATRadio Server with swift audio relay"

# 1. Start DBus
mkdir -p /run/dbus
dbus-daemon --system --fork 2>/dev/null || true
eval $(dbus-launch --sh-syntax)
export DBUS_SESSION_BUS_ADDRESS

# 2. Start virtual display
Xvfb :99 -screen 0 1024x768x16 -ac +extension GLX +render -noreset &
sleep 1
echo "[entrypoint] Xvfb started on :99"

# 3. Start PulseAudio with null sink
pulseaudio --start --exit-idle-time=-1 --log-level=error 2>/dev/null || true
sleep 1

# Ensure the null sink exists
pactl load-module module-null-sink sink_name=vatradio sink_properties=device.description=VATRadio 2>/dev/null || true
pactl set-default-sink vatradio 2>/dev/null || true
echo "[entrypoint] PulseAudio ready with vatradio sink"

# 4. Start swiftCore (headless VATSIM client) if installed
if [ -x /opt/swift/bin/swiftcore ]; then
    echo "[entrypoint] Starting swiftCore..."
    /opt/swift/bin/swiftcore \
        --core \
        --minimized \
        2>&1 | sed 's/^/[swiftcore] /' &
    SWIFT_PID=$!
    sleep 3
    echo "[entrypoint] swiftCore started (PID $SWIFT_PID)"
else
    echo "[entrypoint] WARNING: swiftCore not found at /opt/swift/bin/swiftcore"
    echo "[entrypoint] Running in data-only mode (no audio)"
fi

# 5. Start Node.js server
echo "[entrypoint] Starting Node.js server on port ${PORT:-3000}"
exec node /app/dist/index.js
