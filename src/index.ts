import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { createApiRouter } from './routes/api';
import { AfvVoiceClient } from './afv/voice';
import { setupWebSocket } from './ws/handler';
import { afvLogin } from './afv/session';

async function main() {
  const app = express();
  const server = createServer(app);

  app.use(cors());
  app.use(express.json());

  // AFV voice client (receive-only observer)
  const voiceClient = new AfvVoiceClient();

  // REST API
  app.use('/api', createApiRouter(voiceClient));

  // Root
  app.get('/', (_req, res) => {
    res.json({
      name: 'VATRadio Server',
      version: '1.0.0',
      description: 'VATSIM AFV audio relay — observer mode, receive only',
      endpoints: {
        health: 'GET /api/health',
        status: 'GET /api/status',
        tune: 'POST /api/tune { frequency: "121.500" }',
        untune: 'POST /api/untune { frequency: "121.500" }',
        frequencies: 'GET /api/frequencies',
        reconnect: 'POST /api/reconnect',
        vatsimData: 'GET /api/vatsim-data',
        websocket: 'ws://host/ws (audio stream)',
      },
    });
  });

  // WebSocket server for audio streaming
  const wss = new WebSocketServer({ server, path: '/ws' });
  setupWebSocket(wss, voiceClient);

  // Start HTTP server
  server.listen(config.port, () => {
    console.log(`[Server] VATRadio Server listening on port ${config.port}`);
    console.log(`[Server] REST API: http://localhost:${config.port}/api`);
    console.log(`[Server] WebSocket: ws://localhost:${config.port}/ws`);
  });

  // Connect to AFV if credentials are configured
  if (config.vatsim.cid && config.vatsim.password) {
    console.log('[Server] VATSIM credentials found, connecting to AFV...');
    try {
      await afvLogin();
      await voiceClient.connect();
      console.log('[Server] AFV connected — observer mode, receive only');
    } catch (err) {
      console.error('[Server] AFV connection failed:', (err as Error).message);
      console.error('[Server] Server will run without audio. Set VATSIM_CID and VATSIM_PASSWORD, and ensure you have a registered client token.');
    }
  } else {
    console.log('[Server] No VATSIM credentials configured. Set VATSIM_CID and VATSIM_PASSWORD in .env');
    console.log('[Server] Running in data-only mode (no audio)');
  }
}

main().catch((err) => {
  console.error('[Server] Fatal:', err);
  process.exit(1);
});
