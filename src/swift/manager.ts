import { exec, execSync } from 'child_process';
import { EventEmitter } from 'events';

const SWIFT_DBUS = 'tcp:host=127.0.0.1,port=45000';
const SWIFT_DEST = 'org.swift_project.swiftcore';

export class SwiftManager extends EventEmitter {
  private connected = false;
  private com1: string | null = null;
  private com2: string | null = null;

  // Track per-client frequency requests for multi-user priority
  private clientRequests = new Map<string, Set<string>>(); // clientId -> requested freqs

  isSwiftInstalled(): boolean {
    try {
      execSync('test -x /opt/swift/bin/swiftcore', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getCom1(): string | null { return this.com1; }
  getCom2(): string | null { return this.com2; }

  getTunedFrequencies(): string[] {
    const freqs: string[] = [];
    if (this.com1) freqs.push(this.com1);
    if (this.com2) freqs.push(this.com2);
    return freqs;
  }

  async swiftCommand(context: string, command: string): Promise<string> {
    const path = `/${context}`;
    const iface = `org.swift_project.blackcore.context${context}`;
    const escapedCmd = command.replace(/'/g, "'\\''");

    const pyScript = `
import dbus
conn = dbus.connection.Connection('tcp:host=127.0.0.1,port=45000')
obj = conn.get_object('org.swift_project.swiftcore', '${path}')
iface = dbus.Interface(obj, '${iface}')
ident = dbus.Struct(['vatradio', '', '', 'vatradio', dbus.Int64(1)], signature='ssssx')
result = iface.parseCommandLine('${escapedCmd}', ident)
print(result)
`.trim();

    const cmd = `python3 -c "${pyScript.replace(/"/g, '\\"').replace(/\n/g, ';')}"`;

    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
  }

  async connect(cid: string, password: string): Promise<void> {
    if (!this.isSwiftInstalled()) throw new Error('swiftCore not installed');
    const callsign = `${cid}_OBS`;
    try {
      await this.swiftCommand('ownaircraft', `.callsign ${callsign}`);
      await this.swiftCommand('network', `.con observer ${cid} ${password}`);
      this.connected = true;
      this.emit('connected');
      console.log(`[Swift] Connected as ${callsign}`);
    } catch (err) {
      console.error('[Swift] Connect failed:', (err as Error).message);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try { await this.swiftCommand('network', '.dis'); } catch (_) {}
    this.connected = false;
    this.com1 = null;
    this.com2 = null;
    this.emit('disconnected');
  }

  /** Tune COM1 to a frequency */
  async tuneCom1(frequencyMhz: string): Promise<void> {
    if (this.com1 === frequencyMhz) return;
    try {
      await this.swiftCommand('ownaircraft', `.com1 ${frequencyMhz}`);
      this.com1 = frequencyMhz;
      this.emit('tuned', { com: 1, frequency: frequencyMhz });
      console.log(`[Swift] COM1 → ${frequencyMhz} MHz`);
    } catch (err) {
      console.error(`[Swift] COM1 tune failed:`, (err as Error).message);
    }
  }

  /** Tune COM2 to a frequency */
  async tuneCom2(frequencyMhz: string): Promise<void> {
    if (this.com2 === frequencyMhz) return;
    try {
      await this.swiftCommand('ownaircraft', `.com2 ${frequencyMhz}`);
      this.com2 = frequencyMhz;
      this.emit('tuned', { com: 2, frequency: frequencyMhz });
      console.log(`[Swift] COM2 → ${frequencyMhz} MHz`);
    } catch (err) {
      console.error(`[Swift] COM2 tune failed:`, (err as Error).message);
    }
  }

  // --- Multi-user frequency management ---

  /** A client requests to listen to a frequency */
  requestFrequency(clientId: string, frequencyMhz: string): void {
    if (!this.clientRequests.has(clientId)) {
      this.clientRequests.set(clientId, new Set());
    }
    this.clientRequests.get(clientId)!.add(frequencyMhz);
    this.rebalanceFrequencies();
  }

  /** A client no longer wants a frequency */
  unrequestFrequency(clientId: string, frequencyMhz: string): void {
    this.clientRequests.get(clientId)?.delete(frequencyMhz);
    this.rebalanceFrequencies();
  }

  /** Remove all requests for a disconnected client */
  removeClient(clientId: string): void {
    this.clientRequests.delete(clientId);
    this.rebalanceFrequencies();
  }

  /** Get frequency request counts sorted by popularity */
  getFrequencyVotes(): Array<{ frequency: string; votes: number }> {
    const counts = new Map<string, number>();
    for (const freqs of this.clientRequests.values()) {
      for (const f of freqs) {
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([frequency, votes]) => ({ frequency, votes }))
      .sort((a, b) => b.votes - a.votes);
  }

  /** Auto-assign top 2 requested frequencies to COM1/COM2 */
  private async rebalanceFrequencies(): Promise<void> {
    const ranked = this.getFrequencyVotes();
    const top1 = ranked[0]?.frequency ?? null;
    const top2 = ranked[1]?.frequency ?? null;

    if (top1 && top1 !== this.com1) await this.tuneCom1(top1);
    if (top2 && top2 !== this.com2) await this.tuneCom2(top2);

    this.emit('rebalanced', { com1: this.com1, com2: this.com2, votes: ranked });
  }

  // Legacy single-tune method (tunes COM1)
  async tuneFrequency(frequencyMhz: string): Promise<void> {
    await this.tuneCom1(frequencyMhz);
  }

  async untuneFrequency(frequencyMhz: string): Promise<void> {
    if (this.com1 === frequencyMhz) this.com1 = null;
    if (this.com2 === frequencyMhz) this.com2 = null;
    this.emit('untuned', frequencyMhz);
  }
}
