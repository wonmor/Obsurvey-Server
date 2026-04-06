import { exec, execSync } from 'child_process';
import { EventEmitter } from 'events';

const SWIFT_DBUS = 'tcp:host=127.0.0.1,port=45000';
const SWIFT_DEST = 'org.swift_project.swiftcore';

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

  async connect(cid: string, password: string): Promise<void> {
    if (!this.isSwiftInstalled()) throw new Error('swiftCore not installed');

    const callsign = `${cid}_OBS`;
    try {
      await this.dbusCall('/network', 'org.swift_project.swiftcore.context.network',
        'connectToNetwork', `string:"${callsign}" string:"${cid}" string:"${password}" int32:2`);
      this.connected = true;
      this.emit('connected');
      console.log(`[Swift] Connected as ${callsign}`);
    } catch (err) {
      console.error('[Swift] DBus connect failed:', (err as Error).message);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.dbusCall('/network', 'org.swift_project.swiftcore.context.network', 'disconnectFromNetwork', '');
    } catch (_) {}
    this.connected = false;
    this.tunedFrequencies = [];
    this.emit('disconnected');
  }

  async tuneFrequency(frequencyMhz: string): Promise<void> {
    const freqKhz = Math.round(parseFloat(frequencyMhz) * 1000);
    try {
      await this.dbusCall('/audio', 'org.swift_project.swiftcore.context.audio',
        'setComActiveFrequency', `int32:0 int32:${freqKhz}`);
    } catch (err) {
      console.error(`[Swift] Tune failed:`, (err as Error).message);
    }
    if (!this.tunedFrequencies.includes(frequencyMhz)) {
      this.tunedFrequencies.push(frequencyMhz);
    }
    this.emit('tuned', frequencyMhz);
    console.log(`[Swift] Tuned ${frequencyMhz} MHz`);
  }

  async untuneFrequency(frequencyMhz: string): Promise<void> {
    this.tunedFrequencies = this.tunedFrequencies.filter((f) => f !== frequencyMhz);
    this.emit('untuned', frequencyMhz);
  }

  private dbusCall(path: string, iface: string, method: string, args: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const cmd = `dbus-send --address=${SWIFT_DBUS} --type=method_call --print-reply --dest=${SWIFT_DEST} ${path} ${iface}.${method} ${args}`.trim();
      exec(cmd, { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
  }
}
