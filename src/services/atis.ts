import { config } from '../config';

export interface AtisInfo {
  icao: string;
  source: 'vatsim' | 'real';
  code?: string;
  text: string[];
  frequency?: string;
  updated: string;
}

// Cache real-world ATIS for 5 minutes
const realAtisCache = new Map<string, { data: AtisInfo; expires: number }>();

/**
 * Get ATIS for an airport — tries VATSIM first, falls back to real-world.
 */
export async function getAtis(icao: string): Promise<AtisInfo[]> {
  const results: AtisInfo[] = [];

  // 1. VATSIM ATIS from live data
  try {
    const vatsimAtis = await getVatsimAtis(icao);
    results.push(...vatsimAtis);
  } catch (_) {}

  // 2. Real-world ATIS from AVWX
  try {
    const realAtis = await getRealWorldAtis(icao);
    if (realAtis) results.push(realAtis);
  } catch (_) {}

  return results;
}

async function getVatsimAtis(icao: string): Promise<AtisInfo[]> {
  const res = await fetch(config.vatsimData.url);
  if (!res.ok) return [];
  const data = await res.json() as any;

  const prefix = icao.toUpperCase();
  const atisStations = (data.atis ?? []).filter((a: any) =>
    a.callsign.toUpperCase().startsWith(prefix)
  );

  return atisStations.map((a: any) => ({
    icao: prefix,
    source: 'vatsim' as const,
    code: a.atis_code ?? undefined,
    text: a.text_atis ?? [],
    frequency: a.frequency,
    updated: a.last_updated,
  }));
}

async function getRealWorldAtis(icao: string): Promise<AtisInfo | null> {
  const cached = realAtisCache.get(icao);
  if (cached && Date.now() < cached.expires) return cached.data;

  // Use FAA D-ATIS API (free, no key needed, US airports only)
  // For international, could use AVWX API (needs key) or aviationweather.gov
  try {
    const res = await fetch(
      `https://datis.clowd.io/api/${icao.toUpperCase()}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;

    if (Array.isArray(data) && data.length > 0) {
      const d = data[0];
      const info: AtisInfo = {
        icao: icao.toUpperCase(),
        source: 'real',
        code: d.code ?? undefined,
        text: [d.datis ?? d.combined ?? ''],
        updated: new Date().toISOString(),
      };
      realAtisCache.set(icao, { data: info, expires: Date.now() + 300_000 });
      return info;
    }
  } catch (_) {}

  // Fallback: aviationweather.gov METAR (not ATIS but useful)
  try {
    const res = await fetch(
      `https://aviationweather.gov/api/data/metar?ids=${icao.toUpperCase()}&format=json`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as any[];
    if (data.length > 0) {
      const info: AtisInfo = {
        icao: icao.toUpperCase(),
        source: 'real',
        text: [`METAR: ${data[0].rawOb}`],
        updated: data[0].reportTime ?? new Date().toISOString(),
      };
      realAtisCache.set(icao, { data: info, expires: Date.now() + 300_000 });
      return info;
    }
  } catch (_) {}

  return null;
}

/**
 * Get all VATSIM ATIS stations currently online.
 */
export async function getAllVatsimAtis(): Promise<AtisInfo[]> {
  try {
    const res = await fetch(config.vatsimData.url);
    if (!res.ok) return [];
    const data = await res.json() as any;

    return (data.atis ?? []).map((a: any) => ({
      icao: a.callsign.split('_')[0],
      source: 'vatsim' as const,
      code: a.atis_code ?? undefined,
      text: a.text_atis ?? [],
      frequency: a.frequency,
      updated: a.last_updated,
    }));
  } catch (_) {
    return [];
  }
}
