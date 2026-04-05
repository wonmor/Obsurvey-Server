import dgram from 'dgram';
import { EventEmitter } from 'events';
import { AfvTransceiver, encodeTransceiverDto, mhzToHz } from './protocol';
import { getVoiceServers, updateTransceivers } from './session';

/**
 * AfvVoiceClient manages the UDP connection to AFV voice servers.
 * Each user gets their own instance with their own AFV token.
 * Strictly receive-only — no audio is ever transmitted.
 */
export class AfvVoiceClient extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private transceivers: AfvTransceiver[] = [];
  private nextTransceiverId = 1;
  private connected = false;
  private voiceServer: { name: string; address: string; port: number } | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private afvToken: string = '';
  private callsign: string = '';

  async connect(afvToken: string, callsign: string): Promise<void> {
    this.afvToken = afvToken;
    this.callsign = callsign;

    try {
      const servers = await getVoiceServers(afvToken);
      if (servers.length === 0) throw new Error('No AFV voice servers available');

      this.voiceServer = servers[0];
      console.log(`[AFV Voice] ${callsign} connecting to ${this.voiceServer.name}`);

      this.socket = dgram.createSocket('udp4');

      this.socket.on('message', (msg) => {
        this.handleVoicePacket(msg);
      });

      this.socket.on('error', (err) => {
        console.error(`[AFV Voice] ${callsign} socket error:`, err.message);
        this.emit('error', err);
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
      });

      await new Promise<void>((resolve) => {
        this.socket!.bind(0, () => resolve());
      });

      this.sendHandshake();
      this.connected = true;
      this.emit('connected');
      console.log(`[AFV Voice] ${callsign} connected`);

      this.heartbeatTimer = setInterval(() => {
        if (this.connected && this.socket) this.sendHeartbeat();
      }, 5000);
    } catch (err) {
      console.error(`[AFV Voice] ${callsign} connection failed:`, (err as Error).message);
      this.emit('error', err);
      throw err;
    }
  }

  async tuneFrequency(frequencyMhz: string, lat = 0, lon = 0): Promise<void> {
    const freqHz = mhzToHz(frequencyMhz);
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
      await updateTransceivers(this.afvToken, this.callsign, encodeTransceiverDto(this.transceivers));
      console.log(`[AFV Voice] ${this.callsign} tuned ${frequencyMhz} MHz`);
      this.emit('tuned', frequencyMhz);
    } catch (err) {
      this.transceivers = this.transceivers.filter((t) => t.id !== transceiver.id);
      throw err;
    }
  }

  async untuneFrequency(frequencyMhz: string): Promise<void> {
    const freqHz = mhzToHz(frequencyMhz);
    this.transceivers = this.transceivers.filter((t) => t.frequency !== freqHz);

    try {
      await updateTransceivers(this.afvToken, this.callsign, encodeTransceiverDto(this.transceivers));
      console.log(`[AFV Voice] ${this.callsign} untuned ${frequencyMhz} MHz`);
      this.emit('untuned', frequencyMhz);
    } catch (err) {
      console.error(`[AFV Voice] ${this.callsign} untune failed:`, (err as Error).message);
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
    console.log(`[AFV Voice] ${this.callsign} disconnected`);
    this.emit('disconnected');
  }

  private sendHandshake(): void {
    if (!this.socket || !this.voiceServer) return;
    const buf = Buffer.from(JSON.stringify({ token: this.afvToken, callsign: this.callsign }));
    this.socket.send(buf, this.voiceServer.port, this.voiceServer.address);
  }

  private sendHeartbeat(): void {
    if (!this.socket || !this.voiceServer) return;
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(0x00, 0);
    this.socket.send(buf, this.voiceServer.port, this.voiceServer.address);
  }

  private handleVoicePacket(data: Buffer): void {
    if (data.length < 8) return;
    this.emit('audio', data);
  }
}
