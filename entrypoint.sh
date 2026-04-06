#!/bin/bash
set -e

echo "[entrypoint] VATRadio Server starting"

export XDG_RUNTIME_DIR=/tmp/runtime-root
mkdir -p /tmp/runtime-root /run/dbus

# 1. Resolve AFV server IP BEFORE modifying /etc/hosts
AFV_IP=$(dig +short voice1.vatsim.net | head -1)
if [ -z "$AFV_IP" ]; then
    AFV_IP="167.71.186.243"
fi
echo "[entrypoint] voice1.vatsim.net resolved to $AFV_IP"

# Save real IP for the proxy to use
echo "$AFV_IP" > /tmp/afv-real-ip.txt

# 2. DBus
dbus-daemon --system --fork 2>/dev/null || true
eval $(dbus-launch --sh-syntax 2>/dev/null) || true
export DBUS_SESSION_BUS_ADDRESS

# 3. Xvfb
Xvfb :99 -screen 0 1024x768x16 -ac -noreset &
sleep 2

# 4. PulseAudio
pulseaudio -D --exit-idle-time=-1 --log-level=error 2>/dev/null || true
sleep 1
pactl load-module module-null-sink sink_name=vatradio sink_properties=device.description=VATRadio 2>/dev/null || true
pactl set-default-sink vatradio 2>/dev/null || true
echo "[entrypoint] PulseAudio + vatradio sink ready"

# 5. Start Node.js (which starts the AFV proxy on port 443)
echo "[entrypoint] Starting Node.js server (includes AFV proxy)..."
node /app/dist/index.js &
NODE_PID=$!
sleep 3

# 6. Start swiftCore AFTER the proxy is running
if [ -x /opt/swift/bin/swiftcore ]; then
    export LD_LIBRARY_PATH=/opt/swift/bin:${LD_LIBRARY_PATH:-}
    echo "[entrypoint] Starting swiftCore..."
    /opt/swift/bin/swiftcore 2>&1 | sed 's/^/[swift] /' &
    sleep 8
    echo "[entrypoint] swiftCore running"
else
    echo "[entrypoint] WARNING: swiftCore not found"
fi

# Wait for Node.js
wait $NODE_PID
