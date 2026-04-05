import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  vatsim: {
    cid: process.env.VATSIM_CID || '',
    password: process.env.VATSIM_PASSWORD || '',
    callsign: process.env.VATSIM_CID ? `${process.env.VATSIM_CID}_OBS` : '',
  },
  afv: {
    server: process.env.AFV_SERVER || 'https://voice1.vatsim.net',
    voiceServers: [
      'voice1.vatsim.net',
      'voice2.vatsim.net',
    ],
  },
  vatsimData: {
    url: 'https://data.vatsim.net/v3/vatsim-data.json',
    pollIntervalMs: 15_000,
  },
};
