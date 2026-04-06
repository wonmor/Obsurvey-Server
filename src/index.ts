import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { createApiRouter } from './routes/api';
import { SwiftManager } from './swift/manager';
import { AudioCapture } from './swift/audio';
import { setupWebSocket } from './ws/handler';

async function main() {
  const app = express();
  const server = createServer(app);

  app.use(cors());
  app.use(express.json());

  const swift = new SwiftManager();
  const audio = new AudioCapture();

  // REST API
  app.use('/api', createApiRouter(swift, audio));

  // Root
  app.get('/', (_req, res) => {
    res.json({
      name: 'VATRadio Server',
      version: '2.0.0',
      description: 'VATSIM audio relay via swift pilot client — observer mode, receive only',
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
        websocket: 'ws://host/ws (audio stream)',
      },
    });
  });

  // WebSocket for audio streaming
  const wss = new WebSocketServer({ server, path: '/ws' });
  setupWebSocket(wss, swift, audio);

  server.listen(config.port, () => {
    console.log(`[Server] VATRadio Server v2.0 on port ${config.port}`);
    console.log(`[Server] swift installed: ${swift.isSwiftInstalled()}`);
    console.log(`[Server] Observer mode — receive audio only, never transmit`);
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
