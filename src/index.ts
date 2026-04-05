import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { createApiRouter } from './routes/api';
import { setupWebSocket } from './ws/handler';

async function main() {
  const app = express();
  const server = createServer(app);

  app.use(cors());
  app.use(express.json());

  // REST API
  app.use('/api', createApiRouter());

  // Root
  app.get('/', (_req, res) => {
    res.json({
      name: 'VATRadio Server',
      version: '1.0.0',
      description: 'VATSIM AFV audio relay — per-user sessions, observer mode, receive only',
      endpoints: {
        health: 'GET /api/health',
        login: 'POST /api/auth/login { cid, password }',
        logout: 'POST /api/auth/logout (Bearer token)',
        status: 'GET /api/status (Bearer token)',
        tune: 'POST /api/tune { frequency } (Bearer token)',
        untune: 'POST /api/untune { frequency } (Bearer token)',
        frequencies: 'GET /api/frequencies (Bearer token)',
        vatsimData: 'GET /api/vatsim-data',
        websocket: 'ws://host/ws?token=<sessionToken>',
      },
    });
  });

  // WebSocket for audio streaming (authenticated via query token)
  const wss = new WebSocketServer({ server, path: '/ws' });
  setupWebSocket(wss);

  server.listen(config.port, () => {
    console.log(`[Server] VATRadio Server listening on port ${config.port}`);
    console.log(`[Server] REST API: http://localhost:${config.port}/api`);
    console.log(`[Server] WebSocket: ws://localhost:${config.port}/ws?token=<session>`);
    console.log('[Server] Per-user auth — no server-side credentials stored');
    console.log('[Server] Observer mode only — receive audio, never transmit');
  });
}

main().catch((err) => {
  console.error('[Server] Fatal:', err);
  process.exit(1);
});
