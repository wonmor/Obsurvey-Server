import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  afv: {
    server: process.env.AFV_SERVER || 'https://voice1.vatsim.net',
    voiceServers: [
      'voice1.vatsim.net',
      'voice2.vatsim.net',
    ],
  },
  vatsimData: {
    url: 'https://data.vatsim.net/v3/vatsim-data.json',
  },
  session: {
    maxAge: 3_600_000, // 1 hour
    maxSessions: 50,
  },
};
