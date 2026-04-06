import { exec, execSync, ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Manages the swiftCore process and communicates via DBus.
 * swiftCore is the headless backend of the swift pilot client.
 * It connects to VATSIM as observer and handles AFV audio.
 */
export class SwiftManager extends EventEmitter {
  private process: ChildProcess | null = null;
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
   * Connect to VATSIM as observer via swiftCore DBus interface.
   */
  async connect(cid: string, password: string): Promise<void> {
    if (!this.isSwiftInstalled()) {
      throw new Error('swiftCore not installed');
    }

    try {
      // Use dbus-send to tell swiftCore to connect
      // The DBus interface varies by swift version — these are the common paths
      const callsign = `${cid}_OBS`;

      // Set credentials via DBus
      await this.dbusCall('org.swift_project.swiftcore',
        '/swift/core', 'org.swift_project.swiftcore.context',
        'setOwnAircraftCallsign', `string:"${callsign}"`);

      // Connect as observer
      await this.dbusCall('org.swift_project.swiftcore',
        '/swift/core', 'org.swift_project.swiftcore.network',
        'connectToNetwork', '');

      this.connected = true;
      this.emit('connected');
      console.log(`[Swift] Connected as ${callsign}`);
    } catch (err) {
      console.error('[Swift] Connection failed:', (err as Error).message);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.dbusCall('org.swift_project.swiftcore',
        '/swift/core', 'org.swift_project.swiftcore.network',
        'disconnectFromNetwork', '');
    } catch (_) {}
    this.connected = false;
    this.tunedFrequencies = [];
    this.emit('disconnected');
    console.log('[Swift] Disconnected');
  }

  /**
   * Tune a COM frequency in swiftCore.
   * swift uses COM1/COM2 radios — we tune COM1 for primary listening.
   */
  async tuneFrequency(frequencyMhz: string): Promise<void> {
    const freqKhz = Math.round(parseFloat(frequencyMhz) * 1000);

    try {
      // Set COM1 active frequency
      await this.dbusCall('org.swift_project.swiftcore',
        '/swift/core', 'org.swift_project.swiftcore.audio',
        'setCom1ActiveFrequency', `int32:${freqKhz}`);

      if (!this.tunedFrequencies.includes(frequencyMhz)) {
        this.tunedFrequencies.push(frequencyMhz);
      }
      this.emit('tuned', frequencyMhz);
      console.log(`[Swift] Tuned COM1 to ${frequencyMhz} MHz`);
    } catch (err) {
      console.error(`[Swift] Failed to tune ${frequencyMhz}:`, (err as Error).message);
      throw err;
    }
  }

  async untuneFrequency(frequencyMhz: string): Promise<void> {
    this.tunedFrequencies = this.tunedFrequencies.filter((f) => f !== frequencyMhz);
    this.emit('untuned', frequencyMhz);
    console.log(`[Swift] Untuned ${frequencyMhz} MHz`);
  }

  private dbusCall(dest: string, path: string, iface: string, method: string, args: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const cmd = `dbus-send --session --dest=${dest} --type=method_call --print-reply ${path} ${iface}.${method} ${args}`.trim();
      exec(cmd, { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`DBus call failed: ${stderr || err.message}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
