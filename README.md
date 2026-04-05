# Obsurvey Server

Docker-based VATSIM AFV audio relay for VATRadio. Runs on CapRover.

Connects to VATSIM as an observer, tunes into ATC frequencies via AFV, and streams received audio to mobile clients over WebSocket. **Strictly receive-only — no audio is ever transmitted.**

## Architecture

```
Mobile App ←→ WebSocket (wss://) ←→ This Server ←→ AFV Voice Server (UDP)
Mobile App ←→ REST API (/api/*)  ←→ This Server ←→ VATSIM Data Feed
```

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check + status |
| GET | `/api/status` | AFV connection + frequency state |
| POST | `/api/tune` | Tune a frequency `{ frequency: "121.500" }` |
| POST | `/api/untune` | Untune a frequency |
| GET | `/api/frequencies` | List tuned frequencies |
| POST | `/api/reconnect` | Reconnect to AFV |
| GET | `/api/vatsim-data` | Proxy VATSIM v3 data feed |
| WS | `/ws` | Audio stream + realtime events |

## WebSocket Messages

**Server → Client:**
- `{ type: "welcome", clientId, afvConnected, tunedFrequencies }`
- `{ type: "audio", data: "<base64 opus>", timestamp }`
- `{ type: "afvStatus", connected }`
- `{ type: "frequencyTuned", frequency }`
- `{ type: "frequencyUntuned", frequency }`

**Client → Server:**
- `{ type: "tune", frequency: "121.500" }`
- `{ type: "untune", frequency: "121.500" }`
- `{ type: "getStatus" }`
- `{ type: "ping" }`

## Setup

```bash
cp .env.example .env
# Edit .env with your VATSIM credentials
npm install
npm run dev
```

## Deploy to CapRover

```bash
caprover deploy -a obsurvey-server
```

Or push to a repo connected to CapRover — it reads `captain-definition` automatically.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: 3000) |
| `VATSIM_CID` | Yes | Your VATSIM CID |
| `VATSIM_PASSWORD` | Yes | Your VATSIM password |
| `AFV_SERVER` | No | AFV server URL (default: voice1.vatsim.net) |

## License

MIT
