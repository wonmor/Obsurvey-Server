import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { AfvVoiceClient } from '../afv/voice';

interface ConnectedClient {
  ws: WebSocket;
  id: string;
  subscribedFrequencies: Set<string>;
}

let clients: ConnectedClient[] = [];
let clientIdCounter = 0;

export function setupWebSocket(wss: WebSocketServer, voiceClient: AfvVoiceClient): void {
  // Forward audio from AFV to all connected WebSocket clients
  voiceClient.on('audio', (data: Buffer) => {
    const msg = JSON.stringify({
      type: 'audio',
      data: data.toString('base64'),
      timestamp: Date.now(),
    });

    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  });

  voiceClient.on('connected', () => {
    broadcast({ type: 'afvStatus', connected: true });
  });

  voiceClient.on('disconnected', () => {
    broadcast({ type: 'afvStatus', connected: false });
  });

  voiceClient.on('tuned', (freq: string) => {
    broadcast({ type: 'frequencyTuned', frequency: freq });
  });

  voiceClient.on('untuned', (freq: string) => {
    broadcast({ type: 'frequencyUntuned', frequency: freq });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const clientId = `client-${++clientIdCounter}`;
    const client: ConnectedClient = {
      ws,
      id: clientId,
      subscribedFrequencies: new Set(),
    };
    clients.push(client);

    console.log(`[WS] Client connected: ${clientId} (${clients.length} total)`);

    // Send current state
    ws.send(JSON.stringify({
      type: 'welcome',
      clientId,
      afvConnected: voiceClient.isConnected(),
      tunedFrequencies: voiceClient.getTunedFrequencies(),
    }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        await handleClientMessage(client, msg, voiceClient);
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'error',
          message: (err as Error).message,
        }));
      }
    });

    ws.on('close', () => {
      clients = clients.filter((c) => c.id !== clientId);
      console.log(`[WS] Client disconnected: ${clientId} (${clients.length} total)`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Client ${clientId} error:`, err.message);
    });
  });
}

async function handleClientMessage(
  client: ConnectedClient,
  msg: any,
  voiceClient: AfvVoiceClient,
): Promise<void> {
  switch (msg.type) {
    case 'tune': {
      const freq = String(msg.frequency);
      await voiceClient.tuneFrequency(freq, msg.lat, msg.lon);
      client.subscribedFrequencies.add(freq);
      client.ws.send(JSON.stringify({ type: 'tuneOk', frequency: freq }));
      break;
    }

    case 'untune': {
      const freq = String(msg.frequency);
      await voiceClient.untuneFrequency(freq);
      client.subscribedFrequencies.delete(freq);
      client.ws.send(JSON.stringify({ type: 'untuneOk', frequency: freq }));
      break;
    }

    case 'getStatus': {
      client.ws.send(JSON.stringify({
        type: 'status',
        afvConnected: voiceClient.isConnected(),
        tunedFrequencies: voiceClient.getTunedFrequencies(),
        connectedClients: clients.length,
      }));
      break;
    }

    case 'ping': {
      client.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
    }

    default:
      client.ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
  }
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
