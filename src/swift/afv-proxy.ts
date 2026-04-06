import http from 'http';
import https from 'https';
import { execSync } from 'child_process';
import fs from 'fs';
import { config } from '../config';

/**
 * HTTPS proxy that intercepts swift's AFV calls via /etc/hosts redirect.
 * Fixes the empty callsign bug by injecting it into URL paths.
 *
 * Setup:
 *   1. Generate self-signed cert for voice1.vatsim.net
 *   2. Add "127.0.0.1 voice1.vatsim.net" to /etc/hosts
 *   3. This proxy listens on 443 with the self-signed cert
 *   4. Forwards to the real AFV server IP directly
 */

const PROXY_PORT = 443;
const AFV_HOST = 'voice1.vatsim.net';
let callsign = '';
let realAfvIp = '';

function resolveAfvIp(): string {
  // Read the real IP saved by entrypoint.sh (before /etc/hosts was modified)
  try {
    const saved = fs.readFileSync('/tmp/afv-real-ip.txt', 'utf-8').trim();
    if (saved && /^\d+\.\d+\.\d+\.\d+$/.test(saved)) return saved;
  } catch (_) {}

  try {
    const result = execSync(`dig +short ${AFV_HOST} 2>/dev/null || echo ""`, { encoding: 'utf-8' }).trim();
    const ip = result.split(/\s+/)[0];
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  } catch (_) {}
  return '167.71.186.243';
}

function generateCert(): { key: string; cert: string } {
  const keyPath = '/tmp/afv-proxy-key.pem';
  const certPath = '/tmp/afv-proxy-cert.pem';

  if (!fs.existsSync(keyPath)) {
    execSync(`openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 365 -nodes -subj "/CN=${AFV_HOST}" 2>/dev/null`);
  }

  return {
    key: fs.readFileSync(keyPath, 'utf-8'),
    cert: fs.readFileSync(certPath, 'utf-8'),
  };
}

function setupHosts(): void {
  try {
    const hosts = fs.readFileSync('/etc/hosts', 'utf-8');
    if (!hosts.includes(AFV_HOST)) {
      fs.appendFileSync('/etc/hosts', `\n127.0.0.1 ${AFV_HOST}\n`);
      console.log('[AFV Proxy] Added /etc/hosts redirect');
    }
  } catch (err) {
    console.error('[AFV Proxy] Could not modify /etc/hosts:', (err as Error).message);
  }
}

export function startAfvProxy(cid: string): https.Server | null {
  callsign = `${cid}_OBS`;

  // Resolve real IP before hosts override
  realAfvIp = resolveAfvIp();
  console.log(`[AFV Proxy] Real AFV IP: ${realAfvIp}`);

  if (!realAfvIp) {
    console.error('[AFV Proxy] Could not resolve AFV server IP');
    return null;
  }

  // Generate self-signed cert
  let tlsOptions;
  try {
    tlsOptions = generateCert();
  } catch (err) {
    console.error('[AFV Proxy] Could not generate cert:', (err as Error).message);
    return null;
  }

  // Override /etc/hosts BEFORE swift tries to connect
  setupHosts();

  const server = https.createServer(tlsOptions, (req, res) => {
    let path = req.url || '/';

    // Inject callsign into empty paths
    path = path.replace(/\/callsigns\/\//, `/callsigns/${callsign}/`);
    path = path.replace(/\/callsigns\/$/, `/callsigns/${callsign}`);

    const logPrefix = `[AFV Proxy] ${req.method} ${path}`;

    // Forward to real AFV server by IP (bypasses our hosts override)
    const options: https.RequestOptions = {
      hostname: realAfvIp,
      port: 443,
      path: path,
      method: req.method,
      headers: {
        ...req.headers,
        host: AFV_HOST, // keep original Host header
      },
      rejectUnauthorized: true,
      servername: AFV_HOST, // SNI
    };

    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);

      const proxyReq = https.request(options, (proxyRes) => {
        const status = proxyRes.statusCode || 502;
        console.log(`${logPrefix} → ${status}`);
        // Remove HSTS and other headers that could cause issues
        const headers = { ...proxyRes.headers };
        delete headers['strict-transport-security'];
        res.writeHead(status, headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error(`${logPrefix} ERROR: ${err.message}`);
        res.writeHead(502);
        res.end('Proxy error');
      });

      if (body.length > 0) proxyReq.write(body);
      proxyReq.end();
    });
  });

  server.listen(PROXY_PORT, '0.0.0.0', () => {
    console.log(`[AFV Proxy] HTTPS proxy on port ${PROXY_PORT}`);
    console.log(`[AFV Proxy] Injecting callsign "${callsign}" into AFV URLs`);
    console.log(`[AFV Proxy] Forwarding to ${realAfvIp}:443`);
  });

  server.on('error', (err) => {
    console.error('[AFV Proxy] Server error:', (err as Error).message);
  });

  return server;
}
