/** Localized Telegram profile metadata; these calls never send chat messages.
 * https://core.telegram.org/bots/api#setmydescription */
export const BOT_PROFILE = {
  en: {
    description: 'Leela is a game of self-discovery. Set an intention, roll the die and explore the meaning of each square along your journey. Save your progress and reflect on your path with AI. New accounts receive 1 free game and 1 short AI review. Full AI reviews are available separately. Available in English and Russian. Tap Start to open the game.',
    shortDescription: 'Leela: a game of self-discovery with saved journeys and AI reflections. English and Russian.',
    commands: [
      { command: 'start', description: 'Open Leela' },
      { command: 'paysupport', description: 'Get help with a payment' },
    ],
  },
  ru: {
    description: 'Лила — игра самопознания. Сформулируй намерение, бросай кубик и исследуй смысл клеток на своём пути. Сохраняй прогресс и осмысляй пройденный путь с помощью ИИ. Для новых аккаунтов: 1 бесплатная партия и 1 короткий ИИ-разбор. Полные ИИ-разборы доступны за отдельную плату. Игра доступна на русском и английском. Нажми «Старт», чтобы открыть игру.',
    shortDescription: 'Лила — игра самопознания с сохранением пути и ИИ-разборами. На русском и английском.',
    commands: [
      { command: 'start', description: 'Открыть Лилу' },
      { command: 'paysupport', description: 'Помощь с оплатой' },
    ],
  },
};

export function botLanguage(languageCode?: string): 'ru' | 'en' {
  return /^ru(?:[-_]|$)/i.test(languageCode?.trim() ?? '') ? 'ru' : 'en';
}

/** Run from production cron. The receipt is written only after every API call
 * succeeds. Partial failures retry on the next tick; repeated setters are safe.
 * Hashing the copy makes future edits apply without manual version changes.
 * Bot ID scopes the receipt if the installation is moved to a different bot. */
export async function synchronizeBotProfile(db: D1Database, botToken: string): Promise<boolean> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(BOT_PROFILE)));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const botId = /^(\d+):/.exec(botToken)?.[1] ?? 'configured';
    const receipt = `telegram-profile:${botId}:${hash}`;
    if (await db.prepare('SELECT id FROM application_policies WHERE id = ?').bind(receipt).first()) return true;

    // English is also the fallback for users without a dedicated translation.
    for (const language_code of ['', 'en', 'ru'] as const) {
      const copy = BOT_PROFILE[language_code === 'ru' ? 'ru' : 'en'];
      const updates = [
        ['setMyDescription', { description: copy.description }],
        ['setMyShortDescription', { short_description: copy.shortDescription }],
        ['setMyCommands', { commands: copy.commands, scope: { type: 'default' } }],
      ] as const;
      for (const [method, fields] of updates) {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000),
          body: JSON.stringify({ ...fields, language_code }),
        });
        const body = await response.json() as { ok?: boolean; result?: boolean };
        if (!response.ok || body.ok !== true || body.result !== true) {
          // Never log provider bodies or exceptions: they can contain tokens.
          console.warn('Telegram profile update rejected', { method, language_code, status: response.status });
          return false;
        }
      }
    }
    await db.prepare('INSERT INTO application_policies (id, applied_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(receipt, Date.now()).run();
    return true;
  } catch {
    console.warn('Telegram profile synchronization failed; will retry on the next cron tick');
    return false;
  }
}
