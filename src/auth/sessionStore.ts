import crypto from 'crypto';
import { AfvVoiceClient } from '../afv/voice';
import { afvLogin } from '../afv/session';

export interface UserSession {
  sessionToken: string;
  cid: string;
  callsign: string;
  afvToken: string;
  afvTokenExpiresAt: number;
  voiceClient: AfvVoiceClient;
  createdAt: number;
  lastActivity: number;
}

const sessions = new Map<string, UserSession>();
const MAX_SESSIONS = 50;
const SESSION_MAX_AGE_MS = 3_600_000; // 1 hour

export async function createSession(cid: string, password: string): Promise<{ sessionToken: string; callsign: string }> {
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error('Server at capacity. Try again later.');
  }

  const callsign = `${cid}_OBS`;

  // Authenticate with AFV — password is used only here, never stored
  const afvSession = await afvLogin(cid, password, callsign);

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const voiceClient = new AfvVoiceClient();

  const session: UserSession = {
    sessionToken,
    cid,
    callsign,
    afvToken: afvSession.token,
    afvTokenExpiresAt: afvSession.expiresAt,
    voiceClient,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  sessions.set(sessionToken, session);
  console.log(`[Session] Created for CID ${cid} (${sessions.size} active)`);

  // Connect voice client in background
  voiceClient.connect(afvSession.token, callsign).catch((err) => {
    console.error(`[Session] AFV voice connect failed for CID ${cid}:`, err.message);
  });

  return { sessionToken, callsign };
}

export function getSession(token: string): UserSession | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    destroySession(token);
    return null;
  }
  session.lastActivity = Date.now();
  return session;
}

export function destroySession(token: string): void {
  const session = sessions.get(token);
  if (!session) return;
  session.voiceClient.disconnect();
  sessions.delete(token);
  console.log(`[Session] Destroyed for CID ${session.cid} (${sessions.size} active)`);
}

export function cleanupExpired(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_MAX_AGE_MS) {
      destroySession(token);
    }
  }
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

// Run cleanup every 5 minutes
setInterval(cleanupExpired, 300_000);
