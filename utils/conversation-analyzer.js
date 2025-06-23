function isGoodbyeIntent(aiText) {
  if (!aiText || typeof aiText !== "string") {
    return false;
  }

  // Приводим к нижнему регистру для анализа
  const text = aiText.toLowerCase().trim();

  // ЗАВЕРШАЮЩИЕ ФРАЗЫ AI АГЕНТА ЛЕНКИ
  const aiGoodbyePatterns = [
    // === ОСНОВНЫЕ ЗАВЕРШАЮЩИЕ ФРАЗЫ ===

    // "Prajem pekný deň" и вариации
    /\b(prajem\s+(pekný|príjemný)\s+deň)\b/,
    /\b(pekný\s+deň)\b/,
    /\b(príjemný\s+deň)\b/,

    // "Dovidenia" и вариации
    /\b(dovidenia)\b/,
    /\b(zbohom)\b/,

    // === ФРАЗЫ УСПЕШНОЙ ДОГОВОРЕННОСТИ ===

    // "Ďakujem za spoluprácu"
    /\b(ďakujem\s+za\s+spoluprácu)\b/,
    /\b(ďakujem\s+za\s+pochopenie)\b/,
    /\b(ďakujem\s+za\s+(váš\s+)?čas)\b/,

    // "Očakávame splátku"
    /\b(očakávame\s+(prvú\s+)?splátku)\b/,
    /\b(teším\s+sa\s+na\s+(vašu\s+)?(prvú\s+)?splátku)\b/,

    // "Dohodli sme sa"
    /\b(dohodli\s+sme\s+sa)\b/,
    /\b(výborne[,]?\s+(dohodli\s+sme\s+sa)?)\b/,

    // === ФРАЗЫ ПРИ ОТКАЗЕ КЛИЕНТА ===

    // "Rozumiem vašej situácii"
    /\b(rozumiem\s+(vašej\s+)?situácii)\b/,
    /\b(chápem\s+(vašu\s+situáciu)?)\b/,

    // "Ak sa niečo zmení"
    /\b(ak\s+sa\s+(niečo\s+)?zmení[,]?\s+kontaktujte\s+nás)\b/,
    /\b(ak\s+budete\s+potrebovať\s+pomoc)\b/,
    /\b(ak\s+sa\s+rozhodnete[,]?\s+môžete\s+nás\s+kontaktovať)\b/,

    // === КОРОТКИЕ ЗАВЕРШАЮЩИЕ ФРАЗЫ ===

    // "Neváhajte ma kontaktovať"
    /\b(neváhajte\s+(ma\s+)?kontaktovať)\b/,
    /\b(môžete\s+(ma\s+)?kontaktovať)\b/,

    // === ПАТТЕРНЫ ПОСЛЕДОВАТЕЛЬНОСТИ ===

    // Фразы содержащие "ďakujem" + завершение
    /\b(ďakujem.*dovidenia)\b/,
    /\b(ďakujem.*pekný\s+deň)\b/,

    // Фразы содержащие завершение + благодарность
    /\b(prajem.*ďakujem)\b/,
    /\b(dovidenia.*ďakujem)\b/,
  ];

  // === ТОЧНЫЕ КОРОТКИЕ ФРАЗЫ ===
  const exactGoodbyePhrases = [
    "dovidenia",
    "dovidenia!",
    "ďakujem, dovidenia",
    "ďakujem, dovidenia!",
    "pekný deň",
    "pekný deň!",
    "prajem pekný deň",
    "prajem pekný deň!",
    "prajem príjemný deň",
    "prajem príjemný deň!",
    "zbohom",
    "zbohom!",
    "ďakujem a dovidenia",
    "ďakujem a dovidenia!",
    "výborne, dovidenia",
    "výborne, dovidenia!",
  ];

  // Проверяем точные фразы
  if (exactGoodbyePhrases.includes(text)) {
    return true;
  }

  // Проверяем паттерны
  for (const pattern of aiGoodbyePatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  // === ДОПОЛНИТЕЛЬНЫЕ ПРОВЕРКИ ===

  // Проверяем комбинации ключевых слов
  const hasThankYou = /\b(ďakujem)\b/.test(text);
  const hasGoodbye = /\b(dovidenia|pekný\s+deň|príjemný\s+deň)\b/.test(text);
  const hasCooperation = /\b(spoluprácu|pochopenie)\b/.test(text);
  const hasExpectation = /\b(očakávame|teším\s+sa)\b/.test(text);

  // Если есть благодарность + прощание = завершение
  if (hasThankYou && hasGoodbye) {
    return true;
  }

  // Если есть благодарность + сотрудничество + прощание = завершение
  if (hasThankYou && hasCooperation) {
    return true;
  }

  // Если есть ожидание + прощание = завершение
  if (hasExpectation && hasGoodbye) {
    return true;
  }

  return false;
}

// === ДОПОЛНИТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ОПРЕДЕЛЕНИЯ ТИПА ЗАВЕРШЕНИЯ ===
function getGoodbyeType(aiText) {
  if (!isGoodbyeIntent(aiText)) {
    return null;
  }

  const text = aiText.toLowerCase().trim();

  // Успешная договоренность
  if (/\b(dohodli\s+sme\s+sa|očakávame|teším\s+sa|spoluprácu)\b/.test(text)) {
    return "AGREEMENT_SUCCESS";
  }

  // Понимание отказа
  if (
    /\b(rozumiem|chápem|ak\s+sa\s+zmení|ak\s+budete\s+potrebovať)\b/.test(text)
  ) {
    return "UNDERSTANDING_REFUSAL";
  }

  // Простое прощание
  if (
    /\b(dovidenia|pekný\s+deň|zbohom)\b/.test(text) &&
    !/\b(ďakujem|spoluprácu|rozumiem)\b/.test(text)
  ) {
    return "SIMPLE_GOODBYE";
  }

  return "GENERAL_GOODBYE";
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
 * @param {string} text - последний текст клиента
 * @param {Array} dialog - история диалога
 * @returns {Object} - результат анализа
 */
function shouldEndConversation(text, dialog) {
  const isExplicitGoodbye = isGoodbyeIntent(text);
  const tooManyAttempts = hasTooManyPersuasionAttempts(dialog);
  const goodbyeType = getGoodbyeType(text);

  const shouldEnd = isExplicitGoodbye || tooManyAttempts;

  return {
    shouldEnd,
    reason: isExplicitGoodbye
      ? "explicit_goodbye"
      : tooManyAttempts
      ? "conversation_too_long"
      : "continue",
    goodbyeMessage: shouldEnd ? generateGoodbyeMessage() : null,
    goodbyeType,
  };
}

module.exports = {
  isGoodbyeIntent,
  generateGoodbyeMessage,
  hasTooManyPersuasionAttempts,
  shouldEndConversation,
};
