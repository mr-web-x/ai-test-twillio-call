const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID; // Получи ID нужного голоса из ElevenLabs

async function synthesizeSpeech(text) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!response.ok) {
    console.error("Ошибка озвучки:", await response.text());
    return null;
  }

  const fileName = `${uuidv4()}.mp3`;
  const filePath = path.join(__dirname, "public/audio", fileName);
  const dest = fs.createWriteStream(filePath);
  await new Promise((resolve, reject) => {
    response.body.pipe(dest);
    response.body.on("error", reject);
    dest.on("finish", resolve);
  });

  console.log("🔊 Аудио сгенерировано:", fileName);
  return fileName;
}

module.exports = { synthesizeSpeech };
