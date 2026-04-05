import dgram from 'dgram';
import { EventEmitter } from 'events';
import { AfvTransceiver, AfvVoiceServerInfo, encodeTransceiverDto, mhzToHz } from './protocol';
import { ensureSession, getVoiceServers, updateTransceivers } from './session';
import { config } from '../config';

/**
 * AfvVoiceClient manages the UDP connection to AFV voice servers.
 * It receives Opus-encoded audio for subscribed frequencies
 * and emits 'audio' events with raw Opus frames.
 *
 * This is strictly receive-only — no audio is ever transmitted.
 */
export class AfvVoiceClient extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private transceivers: AfvTransceiver[] = [];
  private nextTransceiverId = 1;
  private connected = false;
  private voiceServer: AfvVoiceServerInfo | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  async connect(): Promise<void> {
    try {
      const session = await ensureSession();
      const servers = await getVoiceServers();

      if (servers.length === 0) {
        throw new Error('No AFV voice servers available');
      }

      this.voiceServer = servers[0];
      console.log(`[AFV Voice] Connecting to ${this.voiceServer.name} (${this.voiceServer.address}:${this.voiceServer.port})`);

      this.socket = dgram.createSocket('udp4');

      this.socket.on('message', (msg, rinfo) => {
        this.handleVoicePacket(msg);
      });

      this.socket.on('error', (err) => {
        console.error('[AFV Voice] Socket error:', err.message);
        this.emit('error', err);
      });

      this.socket.on('close', () => {
        console.log('[AFV Voice] Socket closed');
        this.connected = false;
        this.emit('disconnected');
      });

      // Bind to an ephemeral port
      await new Promise<void>((resolve) => {
        this.socket!.bind(0, () => resolve());
      });

      // Send initial handshake/keepalive
      this.sendHandshake(session.token);

      this.connected = true;
      this.emit('connected');
      console.log('[AFV Voice] Connected');

      // Heartbeat every 5 seconds
      this.heartbeatTimer = setInterval(() => {
        if (this.connected && this.socket) {
          this.sendHeartbeat();
        }
      }, 5000);
    } catch (err) {
      console.error('[AFV Voice] Connection failed:', (err as Error).message);
      this.emit('error', err);
      throw err;
    }
  }

  async tuneFrequency(frequencyMhz: string, lat = 0, lon = 0): Promise<void> {
    const freqHz = mhzToHz(frequencyMhz);

    // Check if already tuned
    if (this.transceivers.some((t) => t.frequency === freqHz)) return;

    const transceiver: AfvTransceiver = {
      id: this.nextTransceiverId++,
      frequency: freqHz,
      latDeg: lat,
      lonDeg: lon,
      heightMslM: 100,
      heightAglM: 100,
    };

    this.transceivers.push(transceiver);

    try {
      await updateTransceivers(encodeTransceiverDto(this.transceivers));
      console.log(`[AFV Voice] Tuned ${frequencyMhz} MHz`);
      this.emit('tuned', frequencyMhz);
    } catch (err) {
      // Rollback
      this.transceivers = this.transceivers.filter((t) => t.id !== transceiver.id);
      throw err;
    }
  }

  async untuneFrequency(frequencyMhz: string): Promise<void> {
    const freqHz = mhzToHz(frequencyMhz);
    this.transceivers = this.transceivers.filter((t) => t.frequency !== freqHz);

    try {
      await updateTransceivers(encodeTransceiverDto(this.transceivers));
      console.log(`[AFV Voice] Untuned ${frequencyMhz} MHz`);
      this.emit('untuned', frequencyMhz);
    } catch (err) {
      console.error('[AFV Voice] Failed to untune:', (err as Error).message);
    }
  }

  getTunedFrequencies(): string[] {
    return this.transceivers.map((t) => (t.frequency / 1_000_000).toFixed(3));
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    this.connected = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.transceivers = [];
    console.log('[AFV Voice] Disconnected');
    this.emit('disconnected');
  }

  private sendHandshake(token: string): void {
    if (!this.socket || !this.voiceServer) return;

    // AFV handshake: send the JWT as the initial packet
    const buf = Buffer.from(JSON.stringify({ token, callsign: config.vatsim.callsign }));
    this.socket.send(buf, this.voiceServer.port, this.voiceServer.address);
  }

  private sendHeartbeat(): void {
    if (!this.socket || !this.voiceServer) return;

    // Simple keepalive packet
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(0x00, 0); // keepalive marker
    this.socket.send(buf, this.voiceServer.port, this.voiceServer.address);
  }

  private handleVoicePacket(data: Buffer): void {
    if (data.length < 8) return; // Too small to be a voice packet

    // Emit raw audio data for downstream processing
    // The exact format depends on AFV protocol version,
    // but the audio payload is Opus-encoded PCM
    this.emit('audio', data);
  }
}
