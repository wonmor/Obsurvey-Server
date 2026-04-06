import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { SwiftManager } from '../swift/manager';
import { AudioCapture } from '../swift/audio';
import { AfvClient } from '../afv/client';
import { getConnectedClientCount } from '../ws/handler';
import { getAtis, getAllVatsimAtis } from '../services/atis';
import { config } from '../config';

export function createApiRouter(swift: SwiftManager, audio: AudioCapture, afv: AfvClient): Router {
  const router = Router();

  // Health check
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      swift: {
        installed: swift.isSwiftInstalled(),
        connected: swift.isConnected(),
        com1: swift.getCom1(),
        com2: swift.getCom2(),
      },
      afv: { connected: afv.isConnected() },
      audio: { capturing: audio.isRunning() },
      tunedFrequencies: swift.getTunedFrequencies(),
      frequencyVotes: swift.getFrequencyVotes(),
      connectedClients: getConnectedClientCount(),
      uptime: process.uptime(),
    });
  });

  // Debug: introspect swift DBus
  router.get('/debug/dbus', (req: Request, res: Response) => {
    const path = (req.query.path as string) || '/';
    exec(`dbus-send --address=tcp:host=127.0.0.1,port=45000 --type=method_call --print-reply --dest=org.swift_project.swiftcore ${path} org.freedesktop.DBus.Introspectable.Introspect 2>&1`, { timeout: 5000 }, (err, stdout, stderr) => {
      res.json({ path, stdout: stdout || '', stderr: stderr || '', error: err?.message || null });
    });
  });

  // Debug: send a swift dot-command
  router.post('/debug/cmd', async (req: Request, res: Response) => {
    try {
      const result = await swift.swiftCommand(String(req.body.context), String(req.body.command));
      res.json({ ok: true, result });
    } catch (err) {
      res.json({ ok: false, error: (err as Error).message });
    }
  });

  // Debug: run shell command inside container
  router.post('/debug/exec', (req: Request, res: Response) => {
    const { cmd } = req.body;
    if (!cmd) { res.status(400).json({ error: 'cmd required' }); return; }
    exec(String(cmd), { timeout: 10000 }, (err, stdout, stderr) => {
      res.json({ stdout, stderr, error: err?.message || null });
    });
  });

  // VATSIM data feed proxy
  router.get('/vatsim-data', async (_req: Request, res: Response) => {
    try {
      const upstream = await fetch(config.vatsimData.url);
      if (!upstream.ok) { res.status(upstream.status).json({ error: 'unavailable' }); return; }
      res.json(await upstream.json());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // --- ATIS ---

  // Get ATIS for a specific airport (VATSIM + real-world)
  router.get('/atis/:icao', async (req: Request, res: Response) => {
    try {
      const results = await getAtis(req.params.icao);
      res.json({ icao: req.params.icao.toUpperCase(), atis: results });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get all VATSIM ATIS stations online
  router.get('/atis', async (_req: Request, res: Response) => {
    try {
      const results = await getAllVatsimAtis();
      res.json({ count: results.length, atis: results });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Status & Control ---

  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      swift: {
        installed: swift.isSwiftInstalled(),
        connected: swift.isConnected(),
        com1: swift.getCom1(),
        com2: swift.getCom2(),
      },
      audio: audio.isRunning(),
      frequencies: swift.getTunedFrequencies(),
      votes: swift.getFrequencyVotes(),
      clients: getConnectedClientCount(),
    });
  });

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

  router.post('/disconnect', async (_req: Request, res: Response) => {
    try {
      await swift.disconnect();
      audio.stop();
      res.json({ ok: true, connected: false });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Tune frequency (sets both swift COM and AFV transceiver)
  router.post('/tune', async (req: Request, res: Response) => {
    try {
      const { frequency, com } = req.body;
      if (!frequency) { res.status(400).json({ error: 'frequency required' }); return; }
      if (com === 2) {
        await swift.tuneCom2(String(frequency));
        afv.setCom2(String(frequency));
      } else {
        await swift.tuneCom1(String(frequency));
        afv.setCom1(String(frequency));
      }
      res.json({ ok: true, frequency, com1: swift.getCom1(), com2: swift.getCom2(), afv: afv.isConnected() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/untune', async (req: Request, res: Response) => {
    try {
      const { frequency } = req.body;
      if (!frequency) { res.status(400).json({ error: 'frequency required' }); return; }
      await swift.untuneFrequency(String(frequency));
      res.json({ ok: true, com1: swift.getCom1(), com2: swift.getCom2() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/frequencies', (_req: Request, res: Response) => {
    res.json({
      com1: swift.getCom1(),
      com2: swift.getCom2(),
      votes: swift.getFrequencyVotes(),
    });
  });

  return router;
}
