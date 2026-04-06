import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { createApiRouter } from './routes/api';
import { SwiftManager } from './swift/manager';
import { AudioCapture } from './swift/audio';
import { WhisperTranscriber } from './swift/whisper';
import { AfvClient } from './afv/client';
import { setupWebSocket } from './ws/handler';

async function main() {
  const app = express();
  const server = createServer(app);

  app.use(cors());
  app.use(express.json());

  const swift = new SwiftManager();
  const audio = new AudioCapture();
  const whisper = new WhisperTranscriber();
  const afv = new AfvClient();

  // Pipe PulseAudio capture into whisper (for any swift-generated audio)
  audio.on('audio', (chunk: Buffer) => {
    whisper.feed(chunk);
  });

  // Also pipe AFV UDP audio into whisper and forward to WebSocket
  afv.on('audio', (chunk: Buffer) => {
    whisper.feed(chunk);
  });

  // REST API
  app.use('/api', createApiRouter(swift, audio, afv));

  app.get('/', (_req, res) => {
    res.json({
      name: 'VATRadio Server',
      version: '3.0.0',
      description: 'VATSIM audio relay — swift (FSD) + direct AFV client (audio)',
      swift: { installed: swift.isSwiftInstalled(), connected: swift.isConnected() },
      afv: { connected: afv.isConnected() },
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  setupWebSocket(wss, swift, audio, whisper, afv);

  server.listen(config.port, () => {
    console.log(`[Server] VATRadio Server v3.0 on port ${config.port}`);
    console.log('[Server] Architecture: swift (FSD network) + direct AFV (audio)');
  });

  whisper.start().catch((err) => {
    console.error('[Server] Whisper start failed:', err.message);
  });

  // Auto-connect
  if (config.vatsim.cid && config.vatsim.password) {
    // Wait for swift to appear
    const waitForSwift = async () => {
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (swift.isSwiftInstalled()) {
          try {
            // Connect swift to FSD
            await swift.connect(config.vatsim.cid, config.vatsim.password);
            audio.start();
            console.log('[Server] swift connected to FSD');
          } catch (err) {
            console.error('[Server] swift FSD connect failed:', (err as Error).message);
          }

          try {
            // Connect AFV directly for audio
            await afv.connect(config.vatsim.cid, config.vatsim.password);
            console.log('[Server] AFV audio connected');
          } catch (err) {
            console.error('[Server] AFV connect failed:', (err as Error).message);
          }
          return;
        }
      }
      // No swift — try AFV standalone
      console.log('[Server] swift not found, trying AFV standalone...');
      try {
        await afv.connect(config.vatsim.cid, config.vatsim.password);
        console.log('[Server] AFV audio connected (standalone)');
      } catch (err) {
        console.error('[Server] AFV standalone failed:', (err as Error).message);
      }
    };
    waitForSwift();
  }
}

main().catch((err) => {
  console.error('[Server] Fatal:', err);
  process.exit(1);
});
