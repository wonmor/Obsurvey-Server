import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { SwiftManager } from '../swift/manager';
import { AudioCapture } from '../swift/audio';
import { WhisperTranscriber } from '../swift/whisper';

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
): void {
  // Forward captured audio to all connected WebSocket clients
  audio.on('audio', (chunk: Buffer) => {
    if (clients.length === 0) return;

    const msg = JSON.stringify({
      type: 'audio',
      data: chunk.toString('base64'),
      sampleRate: 48000,
      channels: 1,
      format: 's16le',
      timestamp: Date.now(),
    });

    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  });

  // Forward whisper transcripts to all clients
  whisper.on('transcript', (transcript: { text: string; timestamp: number }) => {
    broadcast({
      type: 'transcript',
      text: transcript.text,
      timestamp: transcript.timestamp,
    });
  });

  swift.on('connected', () => broadcast({ type: 'swiftStatus', connected: true }));
  swift.on('disconnected', () => broadcast({ type: 'swiftStatus', connected: false }));
  swift.on('tuned', (freq: string) => broadcast({ type: 'frequencyTuned', frequency: freq }));
  swift.on('untuned', (freq: string) => broadcast({ type: 'frequencyUntuned', frequency: freq }));

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const clientId = `client-${++clientIdCounter}`;
    const client: ConnectedClient = { ws, id: clientId };
    clients.push(client);

    console.log(`[WS] Client ${clientId} connected (${clients.length} total)`);

    // Send current state
    ws.send(JSON.stringify({
      type: 'welcome',
      clientId,
      swiftInstalled: swift.isSwiftInstalled(),
      swiftConnected: swift.isConnected(),
      tunedFrequencies: swift.getTunedFrequencies(),
      audioCapturing: audio.isRunning(),
    }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'tune':
            await swift.tuneFrequency(String(msg.frequency));
            ws.send(JSON.stringify({ type: 'tuneOk', frequency: msg.frequency }));
            break;
          case 'untune':
            await swift.untuneFrequency(String(msg.frequency));
            ws.send(JSON.stringify({ type: 'untuneOk', frequency: msg.frequency }));
            break;
          case 'getStatus':
            ws.send(JSON.stringify({
              type: 'status',
              swiftConnected: swift.isConnected(),
              tunedFrequencies: swift.getTunedFrequencies(),
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
      clients = clients.filter((c) => c.id !== clientId);
      console.log(`[WS] Client ${clientId} disconnected (${clients.length} total)`);
    });
  });
}

function broadcast(data: object): void {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}

export function getConnectedClientCount(): number {
  return clients.length;
}
