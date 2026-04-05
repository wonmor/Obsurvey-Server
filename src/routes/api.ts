import { Router, Request, Response } from 'express';
import { createSession, destroySession, getActiveSessionCount } from '../auth/sessionStore';
import { authMiddleware } from '../auth/middleware';
import { getConnectedClientCount } from '../ws/handler';
import { config } from '../config';

export function createApiRouter(): Router {
  const router = Router();

  // --- Public routes (no auth required) ---

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      activeSessions: getActiveSessionCount(),
      connectedClients: getConnectedClientCount(),
      uptime: process.uptime(),
    });
  });

  // Proxy VATSIM data feed (no auth needed)
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

  // Login — accepts CID + password, returns session token
  // Password is used only to authenticate with AFV, then discarded
  router.post('/auth/login', async (req: Request, res: Response) => {
    try {
      const { cid, password } = req.body;
      if (!cid || !password) {
        res.status(400).json({ error: 'cid and password are required' });
        return;
      }

      const { sessionToken, callsign } = await createSession(String(cid), String(password));
      console.log(`[API] Login success for CID ${cid}`);
      res.json({
        sessionToken,
        callsign,
        expiresIn: config.session.maxAge,
      });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('auth failed') || msg.includes('401') ? 401 : 500;
      console.log(`[API] Login failed: ${msg}`);
      res.status(status).json({ error: msg });
    }
  });

  // --- Protected routes (require Bearer session token) ---

  router.post('/auth/logout', authMiddleware, (req: Request, res: Response) => {
    destroySession(req.userSession!.sessionToken);
    res.json({ ok: true });
  });

  router.get('/status', authMiddleware, (req: Request, res: Response) => {
    const s = req.userSession!;
    res.json({
      cid: s.cid,
      callsign: s.callsign,
      afvConnected: s.voiceClient.isConnected(),
      frequencies: s.voiceClient.getTunedFrequencies(),
    });
  });

  router.post('/tune', authMiddleware, async (req: Request, res: Response) => {
    try {
      const { frequency, lat, lon } = req.body;
      if (!frequency) {
        res.status(400).json({ error: 'frequency is required' });
        return;
      }
      await req.userSession!.voiceClient.tuneFrequency(String(frequency), lat, lon);
      res.json({ ok: true, frequency, tunedFrequencies: req.userSession!.voiceClient.getTunedFrequencies() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/untune', authMiddleware, async (req: Request, res: Response) => {
    try {
      const { frequency } = req.body;
      if (!frequency) {
        res.status(400).json({ error: 'frequency is required' });
        return;
      }
      await req.userSession!.voiceClient.untuneFrequency(String(frequency));
      res.json({ ok: true, frequency, tunedFrequencies: req.userSession!.voiceClient.getTunedFrequencies() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/frequencies', authMiddleware, (req: Request, res: Response) => {
    res.json({ frequencies: req.userSession!.voiceClient.getTunedFrequencies() });
  });

  return router;
}
