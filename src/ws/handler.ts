import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { getSession, UserSession } from '../auth/sessionStore';

interface ConnectedClient {
  ws: WebSocket;
  id: string;
  session: UserSession;
}

let clients: ConnectedClient[] = [];
let clientIdCounter = 0;

export function setupWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Authenticate via query parameter: /ws?token=<sessionToken>
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4401, 'Missing session token');
      return;
    }

    const session = getSession(token);
    if (!session) {
      ws.close(4401, 'Invalid or expired session');
      return;
    }

    const clientId = `client-${++clientIdCounter}`;
    const client: ConnectedClient = { ws, id: clientId, session };
    clients.push(client);

    console.log(`[WS] ${session.callsign} connected as ${clientId} (${clients.length} total)`);

    // Forward audio from this user's voice client to their WebSocket
    const audioHandler = (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'audio',
          data: data.toString('base64'),
          timestamp: Date.now(),
        }));
      }
    };

    const connHandler = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'afvStatus', connected: true }));
      }
    };

    const disconnHandler = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'afvStatus', connected: false }));
      }
    };

    session.voiceClient.on('audio', audioHandler);
    session.voiceClient.on('connected', connHandler);
    session.voiceClient.on('disconnected', disconnHandler);

    // Send welcome
    ws.send(JSON.stringify({
      type: 'welcome',
      clientId,
      callsign: session.callsign,
      afvConnected: session.voiceClient.isConnected(),
      tunedFrequencies: session.voiceClient.getTunedFrequencies(),
    }));

    // Handle messages from client
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'tune':
            await session.voiceClient.tuneFrequency(String(msg.frequency), msg.lat, msg.lon);
            ws.send(JSON.stringify({ type: 'tuneOk', frequency: msg.frequency }));
            break;
          case 'untune':
            await session.voiceClient.untuneFrequency(String(msg.frequency));
            ws.send(JSON.stringify({ type: 'untuneOk', frequency: msg.frequency }));
            break;
          case 'getStatus':
            ws.send(JSON.stringify({
              type: 'status',
              afvConnected: session.voiceClient.isConnected(),
              tunedFrequencies: session.voiceClient.getTunedFrequencies(),
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
      session.voiceClient.off('audio', audioHandler);
      session.voiceClient.off('connected', connHandler);
      session.voiceClient.off('disconnected', disconnHandler);
      clients = clients.filter((c) => c.id !== clientId);
      console.log(`[WS] ${session.callsign} disconnected (${clients.length} total)`);
    });
  });
}

export function getConnectedClientCount(): number {
  return clients.length;
}
