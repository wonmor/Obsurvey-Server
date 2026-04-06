import { Router, Request, Response } from 'express';
import { SwiftManager } from '../swift/manager';
import { AudioCapture } from '../swift/audio';
import { getConnectedClientCount } from '../ws/handler';
import { config } from '../config';

export function createApiRouter(swift: SwiftManager, audio: AudioCapture): Router {
  const router = Router();

  // Health check (public)
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      swift: {
        installed: swift.isSwiftInstalled(),
        connected: swift.isConnected(),
      },
      audio: {
        capturing: audio.isRunning(),
      },
      tunedFrequencies: swift.getTunedFrequencies(),
      connectedClients: getConnectedClientCount(),
      uptime: process.uptime(),
    });
  });

  // Proxy VATSIM data feed (public)
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

  // Get status
  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      swift: {
        installed: swift.isSwiftInstalled(),
        connected: swift.isConnected(),
      },
      audio: audio.isRunning(),
      frequencies: swift.getTunedFrequencies(),
      clients: getConnectedClientCount(),
    });
  });

  // Connect swift to VATSIM
  router.post('/connect', async (_req: Request, res: Response) => {
    try {
      if (!config.vatsim.cid || !config.vatsim.password) {
        res.status(400).json({ error: 'VATSIM_CID and VATSIM_PASSWORD env vars not set' });
        return;
      }
      await swift.connect(config.vatsim.cid, config.vatsim.password);
      audio.start();
      res.json({ ok: true, connected: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Disconnect swift
  router.post('/disconnect', async (_req: Request, res: Response) => {
    try {
      await swift.disconnect();
      audio.stop();
      res.json({ ok: true, connected: false });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Tune a frequency
  router.post('/tune', async (req: Request, res: Response) => {
    try {
      const { frequency } = req.body;
      if (!frequency) {
        res.status(400).json({ error: 'frequency is required' });
        return;
      }
      await swift.tuneFrequency(String(frequency));
      res.json({ ok: true, frequency, tunedFrequencies: swift.getTunedFrequencies() });
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
      await swift.untuneFrequency(String(frequency));
      res.json({ ok: true, frequency, tunedFrequencies: swift.getTunedFrequencies() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get tuned frequencies
  router.get('/frequencies', (_req: Request, res: Response) => {
    res.json({ frequencies: swift.getTunedFrequencies() });
  });

  return router;
}
