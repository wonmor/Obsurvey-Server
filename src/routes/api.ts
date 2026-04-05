import { Router, Request, Response } from 'express';
import { AfvVoiceClient } from '../afv/voice';
import { getSession, afvLogin } from '../afv/session';
import { getConnectedClientCount } from '../ws/handler';
import { config } from '../config';

export function createApiRouter(voiceClient: AfvVoiceClient): Router {
  const router = Router();

  // Health check
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      afvConnected: voiceClient.isConnected(),
      tunedFrequencies: voiceClient.getTunedFrequencies(),
      connectedClients: getConnectedClientCount(),
      uptime: process.uptime(),
    });
  });

  // Get current status
  router.get('/status', (_req: Request, res: Response) => {
    const session = getSession();
    res.json({
      afv: {
        connected: voiceClient.isConnected(),
        authenticated: !!session,
        tokenExpiresAt: session?.expiresAt ?? null,
      },
      frequencies: voiceClient.getTunedFrequencies(),
      clients: getConnectedClientCount(),
    });
  });

  // Tune a frequency
  router.post('/tune', async (req: Request, res: Response) => {
    try {
      const { frequency, lat, lon } = req.body;
      if (!frequency) {
        res.status(400).json({ error: 'frequency is required' });
        return;
      }
      await voiceClient.tuneFrequency(String(frequency), lat, lon);
      res.json({ ok: true, frequency, tunedFrequencies: voiceClient.getTunedFrequencies() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Untune a frequency
  router.post('/untune', async (req: Request, res: Response) => {
    try {
      const { frequency } = req.body;
      if (!frequency) {
        res.status(400).json({ error: 'frequency is required' });
        return;
      }
      await voiceClient.untuneFrequency(String(frequency));
      res.json({ ok: true, frequency, tunedFrequencies: voiceClient.getTunedFrequencies() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get tuned frequencies
  router.get('/frequencies', (_req: Request, res: Response) => {
    res.json({ frequencies: voiceClient.getTunedFrequencies() });
  });

  // Reconnect AFV
  router.post('/reconnect', async (_req: Request, res: Response) => {
    try {
      voiceClient.disconnect();
      await afvLogin();
      await voiceClient.connect();
      res.json({ ok: true, connected: voiceClient.isConnected() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Proxy VATSIM data feed (so mobile app can fetch from one server)
  router.get('/vatsim-data', async (_req: Request, res: Response) => {
    try {
      const upstream = await fetch(config.vatsimData.url);
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: 'VATSIM data feed unavailable' });
        return;
      }
      const data = await upstream.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
