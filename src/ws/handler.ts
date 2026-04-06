import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { SwiftManager } from '../swift/manager';
import { AudioCapture } from '../swift/audio';
import { WhisperTranscriber } from '../swift/whisper';
import { AfvClient } from '../afv/client';

interface ConnectedClient {
  ws: WebSocket;
  id: string;
}

let clients: ConnectedClient[] = [];
let clientIdCounter = 0;

export function setupWebSocket(
  wss: WebSocketServer,
  swift: SwiftManager,
  audio: AudioCapture,
  whisper: WhisperTranscriber,
  afv: AfvClient,
): void {
  // Forward PulseAudio capture (from swift) to clients
  audio.on('audio', (chunk: Buffer) => {
    if (clients.length === 0) return;
    const msg = JSON.stringify({
      type: 'audio',
      data: chunk.toString('base64'),
      sampleRate: 48000,
      channels: 1,
      format: 's16le',
      source: 'pulseaudio',
      timestamp: Date.now(),
    });
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(msg);
    }
  });

  // Forward AFV UDP voice packets to clients
  afv.on('audio', (chunk: Buffer) => {
    if (clients.length === 0) return;
    const msg = JSON.stringify({
      type: 'audio',
      data: chunk.toString('base64'),
      source: 'afv',
      timestamp: Date.now(),
    });
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(msg);
    }
  });

  whisper.on('transcript', (t: { text: string; timestamp: number }) => {
    broadcast({ type: 'transcript', text: t.text, timestamp: t.timestamp });
  });

  swift.on('connected', () => broadcast({ type: 'swiftStatus', connected: true }));
  swift.on('disconnected', () => broadcast({ type: 'swiftStatus', connected: false }));
  swift.on('tuned', (info: { com: number; frequency: string }) => {
    broadcast({ type: 'frequencyTuned', ...info });
  });
  swift.on('untuned', (freq: string) => broadcast({ type: 'frequencyUntuned', frequency: freq }));
  swift.on('rebalanced', (info: any) => broadcast({ type: 'rebalanced', ...info }));

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    const clientId = `client-${++clientIdCounter}`;
    const client: ConnectedClient = { ws, id: clientId };
    clients.push(client);

    console.log(`[WS] ${clientId} connected (${clients.length} total)`);

    ws.send(JSON.stringify({
      type: 'welcome',
      clientId,
      swiftConnected: swift.isConnected(),
      afvConnected: afv.isConnected(),
      com1: swift.getCom1(),
      com2: swift.getCom2(),
      tunedFrequencies: swift.getTunedFrequencies(),
      frequencyVotes: swift.getFrequencyVotes(),
      audioCapturing: audio.isRunning(),
    }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'tune': {
            const freq = String(msg.frequency);
            swift.requestFrequency(clientId, freq);
            // Also set on AFV client
            const ranked = swift.getFrequencyVotes();
            if (ranked[0]) afv.setCom1(ranked[0].frequency);
            if (ranked[1]) afv.setCom2(ranked[1].frequency);
            ws.send(JSON.stringify({
              type: 'tuneOk', frequency: freq,
              com1: swift.getCom1(), com2: swift.getCom2(),
              votes: ranked,
            }));
            break;
          }
          case 'untune': {
            const freq = String(msg.frequency);
            swift.unrequestFrequency(clientId, freq);
            ws.send(JSON.stringify({
              type: 'untuneOk', frequency: freq,
              com1: swift.getCom1(), com2: swift.getCom2(),
              votes: swift.getFrequencyVotes(),
            }));
            break;
          }
          case 'getStatus':
            ws.send(JSON.stringify({
              type: 'status',
              swiftConnected: swift.isConnected(),
              com1: swift.getCom1(),
              com2: swift.getCom2(),
              tunedFrequencies: swift.getTunedFrequencies(),
              votes: swift.getFrequencyVotes(),
              audioCapturing: audio.isRunning(),
              connectedClients: clients.length,
            }));
            break;
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
      }
    });

    ws.on('close', () => {
      swift.removeClient(clientId);
      clients = clients.filter((c) => c.id !== clientId);
      console.log(`[WS] ${clientId} disconnected (${clients.length} total)`);
    });
  });
}

function broadcast(data: object): void {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(msg);
  }
}

export function getConnectedClientCount(): number {
  return clients.length;
}
