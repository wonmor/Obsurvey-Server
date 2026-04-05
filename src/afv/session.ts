import { config } from '../config';
import { AfvSession, AfvVoiceServerInfo } from './protocol';

/**
 * Authenticate with AFV using user-provided credentials.
 * Password is used only for this call and never stored.
 */
export async function afvLogin(cid: string, password: string, callsign: string): Promise<AfvSession> {
  console.log(`[AFV] Authenticating CID ${cid} as ${callsign}...`);

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
  console.log(`[AFV] CID ${cid} authenticated`);

  return {
    token: data.token ?? data.jwt ?? data.access_token,
    expiresAt: Date.now() + 3_600_000,
  };
}

export async function getVoiceServers(afvToken: string): Promise<AfvVoiceServerInfo[]> {
  const res = await fetch(`${config.afv.server}/api/v1/network/voiceservers`, {
    headers: { Authorization: `Bearer ${afvToken}` },
  });

  if (!res.ok) throw new Error(`Failed to get voice servers: ${res.status}`);
  const servers = await res.json() as any[];

  return servers.map((s) => ({
    name: s.name,
    address: s.address ?? s.hostname,
    port: s.port ?? 50000,
  }));
}

export async function updateTransceivers(afvToken: string, callsign: string, transceivers: any[]): Promise<void> {
  const res = await fetch(`${config.afv.server}/api/v1/users/${callsign}/transceivers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${afvToken}`,
    },
    body: JSON.stringify(transceivers),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to update transceivers: ${res.status} ${body}`);
  }
}
