import dgram from 'dgram';
import https from 'https';
import { EventEmitter } from 'events';
import { config } from '../config';

/**
 * Direct AFV (Audio for VATSIM) client — no swift dependency for audio.
 * Handles REST auth, transceiver registration, and UDP voice reception.
 *
 * Swift is still used for FSD network presence. This handles AFV audio only.
 */

interface AfvTokenResponse {
  token: string;
}

interface VoiceServer {
  name: string;
  address: string;
}

export class AfvClient extends EventEmitter {
  private token: string | null = null;
  private cid: string = '';
  private password: string = '';
  private callsign: string = '';
  private voiceSocket: dgram.Socket | null = null;
  private connected = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private transceiverTimer: ReturnType<typeof setInterval> | null = null;
  private com1Freq: number = 0; // Hz
  private com2Freq: number = 0; // Hz

  async connect(cid: string, password: string): Promise<void> {
    this.cid = cid;
    this.password = password;
    this.callsign = `${cid}_OBS`;

    // 1. Authenticate with AFV
    console.log(`[AFV] Authenticating ${this.callsign}...`);
    this.token = await this.authenticate();
    console.log(`[AFV] Authenticated`);

    // 2. Register callsign
    await this.registerCallsign();
    console.log(`[AFV] Callsign registered: ${this.callsign}`);

    // 3. Get voice servers
    const servers = await this.getVoiceServers();
    if (servers.length === 0) throw new Error('No voice servers available');
    const voiceServer = servers[0];
    console.log(`[AFV] Voice server: ${voiceServer.name} (${voiceServer.address})`);

    // 4. Connect UDP voice socket
    await this.connectVoice(voiceServer);

    // 5. Start heartbeat / transceiver updates
    this.transceiverTimer = setInterval(() => this.updateTransceivers(), 5000);

    this.connected = true;
    this.emit('connected');
    console.log(`[AFV] Connected — receive only`);
  }

  disconnect(): void {
    this.connected = false;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.transceiverTimer) { clearInterval(this.transceiverTimer); this.transceiverTimer = null; }
    if (this.voiceSocket) { this.voiceSocket.close(); this.voiceSocket = null; }

    // Deregister callsign
    if (this.token) {
      this.afvRequest('DELETE', `/api/v1/users/${this.cid}/callsigns/${this.callsign}`).catch(() => {});
    }
    this.token = null;
    this.emit('disconnected');
    console.log('[AFV] Disconnected');
  }

  isConnected(): boolean { return this.connected; }

  setCom1(freqMhz: string): void {
    this.com1Freq = Math.round(parseFloat(freqMhz) * 1_000_000);
    this.updateTransceivers().catch(() => {});
    console.log(`[AFV] COM1 → ${freqMhz} MHz`);
  }

  setCom2(freqMhz: string): void {
    this.com2Freq = Math.round(parseFloat(freqMhz) * 1_000_000);
    this.updateTransceivers().catch(() => {});
    console.log(`[AFV] COM2 → ${freqMhz} MHz`);
  }

  // --- AFV REST API ---

  private async authenticate(): Promise<string> {
    // Get JWT from VATSIM auth server (not AFV directly)
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ cid: this.cid, password: this.password });
      const req = https.request({
        hostname: 'auth.vatsim.net',
        port: 443,
        path: '/api/fsd-jwt',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            if (data.success && data.token) {
              resolve(data.token);
            } else {
              reject(new Error(`Auth failed: ${JSON.stringify(data)}`));
            }
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private async registerCallsign(): Promise<void> {
    await this.afvRequest('POST', `/api/v1/users/${this.cid}/callsigns/${this.callsign}`);
  }

  private async getVoiceServers(): Promise<VoiceServer[]> {
    const data = await this.afvRequest('GET', '/api/v1/network/voiceservers');
    if (Array.isArray(data)) {
      return data.map((s: any) => ({
        name: s.name || s.Name || '',
        address: s.address || s.Address || s.hostname || '',
      }));
    }
    return [];
  }

  private async updateTransceivers(): Promise<void> {
    if (!this.token) return;

    const transceivers: any[] = [];
    if (this.com1Freq > 0) {
      transceivers.push({
        ID: 0,
        Frequency: this.com1Freq,
        LatDeg: 0,
        LonDeg: 0,
        HeightMslM: 100,
        HeightAglM: 100,
      });
    }
    if (this.com2Freq > 0) {
      transceivers.push({
        ID: 1,
        Frequency: this.com2Freq,
        LatDeg: 0,
        LonDeg: 0,
        HeightMslM: 100,
        HeightAglM: 100,
      });
    }

    if (transceivers.length === 0) return;

    try {
      await this.afvRequest(
        'POST',
        `/api/v1/users/${this.cid}/callsigns/${this.callsign}/transceivers`,
        transceivers,
      );
    } catch (err) {
      console.error('[AFV] Transceiver update failed:', (err as Error).message);
    }
  }

  // --- UDP Voice ---

  private async connectVoice(server: VoiceServer): Promise<void> {
    this.voiceSocket = dgram.createSocket('udp4');

    this.voiceSocket.on('message', (msg) => {
      if (msg.length > 4) {
        // Voice packet — emit raw audio data (Opus encoded)
        this.emit('audio', msg);
      }
    });

    this.voiceSocket.on('error', (err) => {
      console.error('[AFV] Voice socket error:', err.message);
    });

    await new Promise<void>((resolve) => {
      this.voiceSocket!.bind(0, () => resolve());
    });

    // Send authentication packet to voice server
    const [host, portStr] = server.address.includes(':')
      ? server.address.split(':')
      : [server.address, '50000'];
    const port = parseInt(portStr, 10) || 50000;

    // AFV voice auth: send JWT as initial packet
    const authPacket = Buffer.from(JSON.stringify({
      token: this.token,
      callsign: this.callsign,
    }));
    this.voiceSocket.send(authPacket, port, host);
    console.log(`[AFV] Voice UDP connected to ${host}:${port}`);

    // Heartbeat
    this.heartbeatTimer = setInterval(() => {
      if (this.voiceSocket) {
        const hb = Buffer.alloc(4);
        hb.writeUInt32LE(0, 0);
        this.voiceSocket.send(hb, port, host);
      }
    }, 5000);
  }

  // --- HTTP helper ---

  private afvRequest(method: string, path: string, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: 'voice1.vatsim.net',
        port: 443,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString();
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`AFV ${method} ${path} → ${res.statusCode}: ${data}`));
            return;
          }
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
}
