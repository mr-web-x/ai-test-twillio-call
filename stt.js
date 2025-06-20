const speech = require("@google-cloud/speech");
const { PassThrough } = require("stream");

class GoogleSTTStream {
  constructor(lang = "ru-RU") {
    this.client = new speech.SpeechClient();
    this.audioStream = new PassThrough();
    this.callbacks = [];
    this.isActive = false;
    this.bytesWritten = 0;
    this.lastActivity = Date.now();

    console.log(`🎤 Инициализация Google STT для языка: ${lang}`);

    // Проверяем подключение к Google Cloud
    this.client
      .getProjectId()
      .then((id) => {
        console.log("✅ Подключено к Google Cloud проекту:", id);
        this.startRecognition(lang);
      })
      .catch((err) => {
        console.error("❌ Ошибка подключения к Google Cloud:", err);
      });
  }

  startRecognition(lang) {
    try {
      console.log("🎯 Запуск распознавания речи...");

      this.recognizeStream = this.client
        .streamingRecognize({
          config: {
            encoding: "MULAW", // μ-law encoding от Twilio
            sampleRateHertz: 8000, // 8kHz от Twilio
            languageCode: lang,
            enableAutomaticPunctuation: true,
            model: "telephony", // Оптимизированная модель для телефонии
            // Добавляем дополнительные настройки для лучшего распознавания
            useEnhanced: true,
            enableWordTimeOffsets: true,
            enableWordConfidence: true,
            maxAlternatives: 1,
            profanityFilter: false,
            enableSpeakerDiarization: false,
          },
          interimResults: true, // Включаем промежуточные результаты для отладки
          singleUtterance: false, // Продолжаем слушать
        })
        .on("data", (data) => {
          // console.log("📊 Получены данные от Google STT:", {
          //   resultsLength: data.results?.length,
          //   hasResults: !!data.results?.[0],
          //   isFinal: data.results?.[0]?.isFinal,
          //   transcript: data.results?.[0]?.alternatives?.[0]?.transcript,
          //   confidence: data.results?.[0]?.alternatives?.[0]?.confidence,
          // });

          if (data.results?.[0]) {
            const result = data.results[0];
            const transcript = result.alternatives[0].transcript;

            if (result.isFinal) {
              console.log(
                `✅ Финальный текст: "${transcript}" (confidence: ${result.alternatives[0].confidence})`
              );
              this.callbacks.forEach((cb) => cb(transcript));
            } else {
              // console.log(`🔄 Промежуточный текст: "${transcript}"`);
            }
          }
        })
        .on("error", (err) => {
          console.error("❌ Google STT ошибка:", err);
          console.error("Код ошибки:", err.code);
          console.error("Детали ошибки:", err.details || err.message);

          // Пытаемся перезапустить через 2 секунды
          setTimeout(() => {
            console.log("🔄 Перезапуск STT...");
            this.restart(lang);
          }, 2000);
        })
        .on("end", () => {
          console.log("🏁 Google STT стрим завершен");
        });

      // Подключаем аудио поток к распознаванию
      this.audioStream.pipe(this.recognizeStream);
      this.isActive = true;
      console.log("✅ Google STT активен и готов к работе");

      // Статистика каждые 10 секунд
      this.statsInterval = setInterval(() => {
        const timeSinceActivity = Date.now() - this.lastActivity;
        console.log(
          `📊 STT Статистика: ${this.bytesWritten} байт отправлено, последняя активность ${timeSinceActivity}ms назад`
        );
      }, 10000);
    } catch (error) {
      console.error("❌ Ошибка при запуске распознавания:", error);
    }
  }

  restart(lang) {
    if (this.recognizeStream) {
      this.recognizeStream.removeAllListeners();
      this.recognizeStream.destroy();
    }

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    this.audioStream = new PassThrough();
    this.bytesWritten = 0;
    this.startRecognition(lang);
  }

  write(buffer) {
    if (!this.isActive || !this.audioStream) {
      console.warn("⚠️ STT не активен, пропускаем аудио данные");
      return;
    }

    try {
      this.bytesWritten += buffer.length;
      this.lastActivity = Date.now();

      // Проверяем качество аудио данных
      const nonZeroBytes = buffer.filter(
        (byte) => byte !== 255 && byte !== 127
      ).length;
      const audioActivity = (nonZeroBytes / buffer.length) * 100;

      // Логируем каждый 100-й буфер с дополнительной информацией
      if (this.bytesWritten % (160 * 100) === 0) {
        console.log(
          `🎵 STT получил ${
            this.bytesWritten
          } байт, активность аудио: ${audioActivity.toFixed(1)}%`
        );
      }

      this.audioStream.write(buffer);
    } catch (error) {
      console.error("❌ Ошибка записи аудио:", error);
    }
  }

  onText(cb) {
    console.log("📝 Добавлен callback для текста");
    this.callbacks.push(cb);
  }

  close() {
    console.log("🔒 Закрытие Google STT...");
    this.isActive = false;

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    try {
      if (this.audioStream) {
        this.audioStream.end();
      }
      if (this.recognizeStream) {
        this.recognizeStream.removeAllListeners();
        this.recognizeStream.destroy();
      }
    } catch (error) {
      console.error("❌ Ошибка при закрытии STT:", error);
    }

    console.log(
      `✅ Google STT закрыт (всего обработано ${this.bytesWritten} байт)`
    );
  }
}

module.exports = { GoogleSTTStream };
