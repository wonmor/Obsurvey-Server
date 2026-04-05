/**
 * AFV (Audio for VATSIM) protocol types and helpers.
 *
 * The AFV protocol uses:
 *   - REST API for session management (login, transceiver config)
 *   - UDP for voice data (Opus-encoded audio frames)
 *
 * Voice packet layout (from afv-native source):
 *   [4 bytes] callsign length + callsign
 *   [4 bytes] sequence number
 *   [variable] Opus-encoded audio frame(s)
 *
 * Each voice server connection carries audio for subscribed frequencies.
 */

export interface AfvSession {
  token: string;
  expiresAt: number;
}

export interface AfvTransceiver {
  id: number;
  frequency: number; // Hz
  latDeg: number;
  lonDeg: number;
  heightMslM: number;
  heightAglM: number;
}

export interface AfvVoiceServerInfo {
  name: string;
  address: string;
  port: number;
}

export interface VoicePacket {
  callsign: string;
  sequenceNumber: number;
  audioData: Buffer; // Opus-encoded
}

export function encodeTransceiverDto(transceivers: AfvTransceiver[]) {
  return transceivers.map((t) => ({
    ID: t.id,
    Frequency: t.frequency,
    LatDeg: t.latDeg,
    LonDeg: t.lonDeg,
    HeightMslM: t.heightMslM,
    HeightAglM: t.heightAglM,
  }));
}

export function mhzToHz(freqMhz: string | number): number {
  return Math.round(Number(freqMhz) * 1_000_000);
}

export function hzToMhz(freqHz: number): string {
  return (freqHz / 1_000_000).toFixed(3);
}
