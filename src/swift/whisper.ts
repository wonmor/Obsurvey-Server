import { execFile } from 'child_process';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { EventEmitter } from 'events';

const WHISPER_BIN = '/opt/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = '/opt/whisper.cpp/models/ggml-tiny.en.bin';
const BUFFER_DURATION_MS = 5_000; // Transcribe every 5 seconds
const SAMPLE_RATE = 48000;
const BYTES_PER_SAMPLE = 2; // s16le

/**
 * Buffers PCM audio from AudioCapture, runs whisper.cpp every N seconds,
 * and emits 'transcript' events with the recognized text.
 */
export class WhisperTranscriber extends EventEmitter {
  private buffer: Buffer[] = [];
  private bufferBytes = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private enabled = true;
  private tmpDir: string | null = null;

  async start(): Promise<void> {
    this.tmpDir = await mkdtemp(path.join(tmpdir(), 'vatradio-whisper-'));
    this.timer = setInterval(() => this.flush(), BUFFER_DURATION_MS);
    console.log('[Whisper] Transcriber started (tiny.en model, 5s chunks)');
  }

  stop(): void {
    this.enabled = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.buffer = [];
    this.bufferBytes = 0;
  }

  /** Feed raw PCM audio (s16le, 48kHz, mono) */
  feed(chunk: Buffer): void {
    if (!this.enabled) return;
    this.buffer.push(chunk);
    this.bufferBytes += chunk.length;
  }

  private async flush(): Promise<void> {
    if (this.processing || this.bufferBytes === 0 || !this.tmpDir) return;

    // Grab current buffer
    const pcmData = Buffer.concat(this.buffer);
    this.buffer = [];
    this.bufferBytes = 0;

    // Skip if too short (< 0.5s)
    const durationSamples = pcmData.length / BYTES_PER_SAMPLE;
    if (durationSamples < SAMPLE_RATE * 0.5) return;

    this.processing = true;

    try {
      // Convert 48kHz to 16kHz (whisper expects 16kHz)
      const pcm16k = downsample48to16(pcmData);

      // Write WAV file
      const wavPath = path.join(this.tmpDir, `chunk-${Date.now()}.wav`);
      await writeFile(wavPath, createWavHeader(pcm16k, 16000));

      // Run whisper.cpp
      const text = await runWhisper(wavPath);

      // Clean up
      await unlink(wavPath).catch(() => {});

      // Filter out silence hallucinations and noise
      const trimmed = text.trim().replace(/^\(.*\)$/, '').trim(); // Remove (parenthesized noise markers)
      const NOISE_WORDS = ['you', 'the', 'a', 'i', 'it', 'is', 'so', 'thank you', 'thanks', 'bye', 'hmm', 'um'];
      const isNoise = !trimmed
        || trimmed === '[BLANK_AUDIO]'
        || trimmed.length < 4
        || NOISE_WORDS.includes(trimmed.toLowerCase())
        || /^\[.*\]$/.test(trimmed)
        || /^\.+$/.test(trimmed);

      if (!isNoise) {
        console.log(`[Whisper] "${trimmed}"`);
        this.emit('transcript', {
          text: trimmed,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      console.error('[Whisper] Transcription error:', (err as Error).message);
    } finally {
      this.processing = false;
    }
  }
}

function runWhisper(wavPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(WHISPER_BIN, [
      '-m', WHISPER_MODEL,
      '-f', wavPath,
      '--no-timestamps',
      '--no-prints',
      '-t', '2',        // 2 threads
      '-l', 'en',       // English
    ], { timeout: 10_000 }, (err, stdout, stderr) => {
      if (err) {
        // If whisper binary not found, return empty
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve('');
          return;
        }
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Downsample s16le PCM from 48kHz to 16kHz (3:1 ratio) */
function downsample48to16(pcm48k: Buffer): Buffer {
  const samples48 = new Int16Array(pcm48k.buffer, pcm48k.byteOffset, pcm48k.length / 2);
  const len16 = Math.floor(samples48.length / 3);
  const samples16 = new Int16Array(len16);

  for (let i = 0; i < len16; i++) {
    // Average 3 samples for basic anti-aliasing
    const idx = i * 3;
    samples16[i] = Math.round((samples48[idx] + samples48[idx + 1] + samples48[idx + 2]) / 3);
  }

  return Buffer.from(samples16.buffer);
}

/** Create a minimal WAV header + data */
function createWavHeader(pcmData: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcmData.length;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);           // chunk size
  header.writeUInt16LE(1, 20);            // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, pcmData]);
}
