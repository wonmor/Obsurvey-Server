import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  vatsim: {
    cid: process.env.VATSIM_CID || '',
    password: process.env.VATSIM_PASSWORD || '',
  },
  vatsimData: {
    url: 'https://data.vatsim.net/v3/vatsim-data.json',
  },
  audio: {
    sampleRate: 48000,
    channels: 1,
    // PCM chunk size to buffer before sending (~100ms of audio)
    chunkSize: 9600, // 48000 * 2 bytes * 1 channel * 0.1s
  },
};
