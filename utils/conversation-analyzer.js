/**
 * Анализирует текст клиента на предмет ЯВНОГО намерения завершить разговор
 * @param {string} clientText - текст клиента
 * @returns {boolean} - true если клиент ЯВНО прощается или просит завершить звонок
 */
function isGoodbyeIntent(clientText) {
  if (!clientText || typeof clientText !== "string") {
    return false;
  }

  // Приводим к нижнему регистру для анализа
  const text = clientText.toLowerCase().trim();

  // ТОЛЬКО явные прощания и просьбы завершить звонок
  const explicitGoodbyePatterns = [
    // Прямые прощания
    /\b(dovidenia|zbohom|čau)\b/,

    // Явные просьбы завершить звонок
    /\b(zavesím|zavešujem)\b/,
    /\b(ukončujem\s+(hovor|rozhovor))\b/,
    /\b(končím\s+(hovor|rozhovor))\b/,

    // Категорические просьбы не звонить
    /\b(nevolajte\s+(mi|už|viac))\b/,
    /\b(prestať\s+volať)\b/,
    /\b(nepotrebujem\s+(vaše\s+)?služby)\b/,

    // Явные отказы с просьбой оставить в покое
    /\b(nechajte\s+ma\s+(na\s+)?pokoji)\b/,
    /\b(neobťažujte\s+ma)\b/,
  ];

  // Проверяем только явные паттерны прощаний
  for (const pattern of explicitGoodbyePatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  // Очень короткие явные прощания
  if (
    text === "dovidenia" ||
    text === "zbohom" ||
    text === "čau" ||
    text === "pa"
  ) {
    return true;
  }

  return false;
}

/**
 * Генерирует вежливое прощальное сообщение
 * @returns {string} - прощальное сообщение
 */
function generateGoodbyeMessage() {
  const goodbyeMessages = [
    "Rozumiem. Ďakujem za váš čas. Dovidenia.",
    "V poriadku. Dovidenia a pekný deň.",
    "Chápem. Ďakujem za rozhovor. Dovidenia.",
    "Dobre. Želám vám pekný deň. Dovidenia.",
    "Rozumiem. Dovidenia.",
  ];

  // Возвращаем случайное прощальное сообщение
  return goodbyeMessages[Math.floor(Math.random() * goodbyeMessages.length)];
}

/**
 * Проверяет, было ли слишком много попыток убедить клиента (более агрессивный подход)
 * @param {Array} dialog - история диалога
 * @returns {boolean} - true если было ОЧЕНЬ много попыток убеждения
 */
function hasTooManyPersuasionAttempts(dialog) {
  if (!dialog || !Array.isArray(dialog)) {
    return false;
  }

  let totalAiMessages = 0;
  let persuasionCount = 0;

  for (const message of dialog) {
    if (message.from === "ai") {
      totalAiMessages++;
      const text = message.text.toLowerCase();

      // Считаем повторяющиеся попытки убеждения
      const persuasionKeywords = [
        "rozumiem",
        "ale",
        "potrebné",
        "dôležité",
        "nutné",
        "nájsť riešenie",
        "spoločne",
      ];
      const hasPersuasion = persuasionKeywords.some((keyword) =>
        text.includes(keyword)
      );

      if (hasPersuasion) {
        persuasionCount++;
      }
    }
  }

  // Завершаем только если AI говорил очень много раз (более 8 сообщений)
  // И при этом более 80% его сообщений - попытки убеждения
  return totalAiMessages > 8 && persuasionCount / totalAiMessages > 0.8;
}

/**
 * Главная функция анализа - нужно ли завершать разговор (только при явных прощаниях)
 * @param {string} clientText - последний текст клиента
 * @param {Array} dialog - история диалога
 * @returns {Object} - результат анализа
 */
function shouldEndConversation(clientText, dialog) {
  const isExplicitGoodbye = isGoodbyeIntent(clientText);
  const tooManyAttempts = hasTooManyPersuasionAttempts(dialog);

  const shouldEnd = isExplicitGoodbye || tooManyAttempts;

  return {
    shouldEnd,
    reason: isExplicitGoodbye
      ? "explicit_goodbye"
      : tooManyAttempts
      ? "conversation_too_long"
      : "continue",
    goodbyeMessage: shouldEnd ? generateGoodbyeMessage() : null,
  };
}

module.exports = {
  isGoodbyeIntent,
  generateGoodbyeMessage,
  hasTooManyPersuasionAttempts,
  shouldEndConversation,
};
