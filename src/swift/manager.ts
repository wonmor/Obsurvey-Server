import { exec, execSync } from 'child_process';
import { EventEmitter } from 'events';

const SWIFT_DBUS = 'tcp:host=127.0.0.1,port=45000';
const SWIFT_DEST = 'org.swift_project.swiftcore';

// dbus-send can't easily send complex structs, so we use gdbus instead
const USE_GDBUS = true;

export class SwiftManager extends EventEmitter {
  private connected = false;
  private tunedFrequencies: string[] = [];

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

  getTunedFrequencies(): string[] {
    return [...this.tunedFrequencies];
  }

  /**
   * Send a swift dot-command via parseCommandLine on the network context.
   * Swift commands: .con (connect), .dis (disconnect), .com1 (tune COM1), etc.
   */
  async swiftCommand(context: string, command: string): Promise<string> {
    const path = `/${context}`;
    const iface = `org.swift_project.blackcore.context${context}`;
    const escapedCmd = command.replace(/'/g, "'\\''");

    // Use python3-dbus for complex struct types since dbus-send can't handle them
    // and gdbus has address issues with P2P connections
    const pyScript = `
import dbus
bus = dbus.bus.BusConnection('tcp:host=127.0.0.1,port=45000')
obj = bus.get_object('org.swift_project.swiftcore', '${path}')
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
      // Set callsign first
      await this.swiftCommand('ownaircraft', `.callsign ${callsign}`);
      // Connect as observer — swift .con command
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
    try {
      await this.swiftCommand('network', '.dis');
    } catch (_) {}
    this.connected = false;
    this.tunedFrequencies = [];
    this.emit('disconnected');
  }

  async tuneFrequency(frequencyMhz: string): Promise<void> {
    try {
      // .com1 <freq> sets COM1 active frequency
      await this.swiftCommand('ownaircraft', `.com1 ${frequencyMhz}`);
    } catch (err) {
      console.error(`[Swift] Tune failed:`, (err as Error).message);
    }
    if (!this.tunedFrequencies.includes(frequencyMhz)) {
      this.tunedFrequencies.push(frequencyMhz);
    }
    this.emit('tuned', frequencyMhz);
    console.log(`[Swift] Tuned COM1 to ${frequencyMhz} MHz`);
  }

  async untuneFrequency(frequencyMhz: string): Promise<void> {
    this.tunedFrequencies = this.tunedFrequencies.filter((f) => f !== frequencyMhz);
    this.emit('untuned', frequencyMhz);
  }
}
