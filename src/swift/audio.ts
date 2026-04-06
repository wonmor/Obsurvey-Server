import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Captures audio from PulseAudio's monitor source.
 * swift outputs audio to the default sink (vatradio null sink).
 * We record from its monitor to get the audio stream.
 *
 * Output: raw PCM s16le, 48kHz, mono — emitted as 'audio' events.
 */
export class AudioCapture extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private running = false;

  start(): void {
    if (this.running) return;

    // parec records from PulseAudio monitor source
    this.process = spawn('parec', [
      '--format=s16le',
      '--rate=48000',
      '--channels=1',
      '--device=vatradio.monitor',
      '--latency-msec=100',
    ]);

    this.process.stdout.on('data', (chunk: Buffer) => {
      this.emit('audio', chunk);
    });

    this.process.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error('[AudioCapture]', msg);
    });

    this.process.on('close', (code) => {
      console.log(`[AudioCapture] parec exited with code ${code}`);
      this.running = false;
      // Auto-restart after a delay
      if (code !== null) {
        setTimeout(() => this.start(), 3000);
      }
    });

    this.process.on('error', (err) => {
      console.error('[AudioCapture] Failed to start parec:', err.message);
      this.running = false;
    });

    this.running = true;
    console.log('[AudioCapture] Recording from vatradio.monitor (48kHz s16le mono)');
  }

  stop(): void {
    this.running = false;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
