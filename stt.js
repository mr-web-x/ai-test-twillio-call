const fs = require("fs");
const { SpeechClient } = require("@google-cloud/speech");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const client = new SpeechClient({
  keyFilename: "google-credentials.json", // путь к вашему ключу
});

async function transcribeAudio(audioBuffer) {
  const tempFilePath = path.join(__dirname, "temp", `${uuidv4()}.raw`);

  // Сохраняем временный файл для STT (Linear16, 8000 Hz)
  fs.writeFileSync(tempFilePath, audioBuffer);

  const audio = {
    content: audioBuffer.toString("base64"),
  };

  const config = {
    encoding: "LINEAR16",
    sampleRateHertz: 8000,
    languageCode: "ru-RU",
  };

  const request = {
    audio,
    config,
  };

  try {
    const [response] = await client.recognize(request);
    const transcription = response.results
      .map((result) => result.alternatives[0].transcript)
      .join(" ");

    console.log("📄 Распознанный текст:", transcription);
    return transcription;
  } catch (err) {
    console.error("Ошибка STT:", err);
    return "";
  } finally {
    fs.unlinkSync(tempFilePath); // удаляем временный файл
  }
}

module.exports = { transcribeAudio };
