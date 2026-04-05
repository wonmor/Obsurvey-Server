import { config } from '../config';
import { AfvSession, AfvVoiceServerInfo } from './protocol';

let currentSession: AfvSession | null = null;

export async function afvLogin(): Promise<AfvSession> {
  const { cid, password, callsign } = config.vatsim;
  if (!cid || !password) {
    throw new Error('VATSIM_CID and VATSIM_PASSWORD must be set');
  }

  console.log(`[AFV] Logging in as ${callsign}...`);

  const res = await fetch(`${config.afv.server}/api/v1/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cid, password, callsign }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AFV auth failed (${res.status}): ${body}`);
  }

  const data = await res.json() as Record<string, string>;
  currentSession = {
    token: data.token ?? data.jwt ?? data.access_token,
    expiresAt: Date.now() + 3_600_000,
  };

  console.log('[AFV] Authenticated successfully');
  return currentSession;
}

export function getSession(): AfvSession | null {
  if (currentSession && Date.now() < currentSession.expiresAt) return currentSession;
  return null;
}

export async function ensureSession(): Promise<AfvSession> {
  const existing = getSession();
  if (existing) return existing;
  return afvLogin();
}

export async function getVoiceServers(): Promise<AfvVoiceServerInfo[]> {
  const session = await ensureSession();

  const res = await fetch(`${config.afv.server}/api/v1/network/voiceservers`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });

  if (!res.ok) throw new Error(`Failed to get voice servers: ${res.status}`);
  const servers = await res.json() as any[];

  return servers.map((s) => ({
    name: s.name,
    address: s.address ?? s.hostname,
    port: s.port ?? 50000,
  }));
}

export async function updateTransceivers(transceivers: any[]): Promise<void> {
  const session = await ensureSession();

  const res = await fetch(`${config.afv.server}/api/v1/users/${config.vatsim.callsign}/transceivers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify(transceivers),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to update transceivers: ${res.status} ${body}`);
  }
}
