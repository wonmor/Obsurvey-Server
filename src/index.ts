import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { createApiRouter } from './routes/api';
import { SwiftManager } from './swift/manager';
import { AudioCapture } from './swift/audio';
import { WhisperTranscriber } from './swift/whisper';
import { setupWebSocket } from './ws/handler';

async function main() {
  const app = express();
  const server = createServer(app);

  app.use(cors());
  app.use(express.json());

  const swift = new SwiftManager();
  const audio = new AudioCapture();
  const whisper = new WhisperTranscriber();

  // Pipe audio into whisper for transcription
  audio.on('audio', (chunk: Buffer) => {
    whisper.feed(chunk);
  });

  // REST API
  app.use('/api', createApiRouter(swift, audio));

  // Root
  app.get('/', (_req, res) => {
    res.json({
      name: 'VATRadio Server',
      version: '2.1.0',
      description: 'VATSIM audio relay via swift + Whisper transcription',
      swift: {
        installed: swift.isSwiftInstalled(),
        connected: swift.isConnected(),
      },
      endpoints: {
        health: 'GET /api/health',
        status: 'GET /api/status',
        connect: 'POST /api/connect',
        disconnect: 'POST /api/disconnect',
        tune: 'POST /api/tune { frequency }',
        untune: 'POST /api/untune { frequency }',
        frequencies: 'GET /api/frequencies',
        vatsimData: 'GET /api/vatsim-data',
        websocket: 'ws://host/ws (audio + transcripts)',
      },
    });
  });

  // WebSocket for audio streaming + transcripts
  const wss = new WebSocketServer({ server, path: '/ws' });
  setupWebSocket(wss, swift, audio, whisper);

  server.listen(config.port, () => {
    console.log(`[Server] VATRadio Server v2.1 on port ${config.port}`);
    console.log(`[Server] swift installed: ${swift.isSwiftInstalled()}`);
    console.log('[Server] Whisper transcription: tiny.en model');
    console.log('[Server] Observer mode — receive audio only, never transmit');
  });

  // Start whisper
  whisper.start().catch((err) => {
    console.error('[Server] Whisper start failed:', err.message);
  });

  // Auto-connect if credentials are set
  if (config.vatsim.cid && config.vatsim.password && swift.isSwiftInstalled()) {
    console.log('[Server] VATSIM credentials found, auto-connecting...');
    try {
      await swift.connect(config.vatsim.cid, config.vatsim.password);
      audio.start();
      console.log('[Server] swift connected and audio capture started');
    } catch (err) {
      console.error('[Server] Auto-connect failed:', (err as Error).message);
    }
  }
}

main().catch((err) => {
  console.error('[Server] Fatal:', err);
  process.exit(1);
});
