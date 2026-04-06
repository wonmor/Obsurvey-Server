FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99

# System deps: Xvfb, PulseAudio, Qt5, DBus, Node.js 20
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    pulseaudio pulseaudio-utils \
    dbus dbus-x11 \
    libqt5core5a libqt5network5 libqt5dbus5 libqt5multimedia5 \
    libqt5gui5 libqt5widgets5 libqt5xml5 libqt5svg5 \
    libqt5multimedia5-plugins \
    libgl1-mesa-glx libegl1-mesa libxkbcommon0 libxkbcommon-x11-0 \
    libasound2 libopus0 \
    curl wget ca-certificates gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
       | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Download and install swift pilot client (official build includes VATSIM key)
ARG SWIFT_VERSION=0.15.170
ARG SWIFT_URL=https://github.com/swift-project/pilotclient/releases/download/v${SWIFT_VERSION}/swiftinstaller-linux-64-${SWIFT_VERSION}.run
RUN wget -q -O /tmp/swift-installer.run "${SWIFT_URL}" \
    && chmod +x /tmp/swift-installer.run \
    && /tmp/swift-installer.run --mode unattended --prefix /opt/swift 2>/dev/null \
    || echo "[WARN] Swift installer may need manual install — update SWIFT_URL build arg if needed" \
    && rm -f /tmp/swift-installer.run

# Build whisper.cpp for speech-to-text transcription
RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential cmake \
    && git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git /opt/whisper.cpp \
    && cd /opt/whisper.cpp && cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j$(nproc) \
    && rm -rf /var/lib/apt/lists/*

# Download whisper tiny.en model (39MB — fast, English-optimized, perfect for ATC)
RUN cd /opt/whisper.cpp && bash models/download-ggml-model.sh tiny.en

# PulseAudio: null sink to capture swift audio output
RUN mkdir -p /run/pulse /root/.config/pulse \
    && echo "load-module module-null-sink sink_name=vatradio sink_properties=device.description=VATRadio\n\
set-default-sink vatradio\n\
load-module module-always-sink" >> /etc/pulse/default.pa

# Build Node.js server
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc
RUN npm prune --omit=dev

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
CMD ["/entrypoint.sh"]
