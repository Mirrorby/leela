export interface Env {
  DB: D1Database;
  // Секреты, добавляются через Cloudflare Dashboard (не в этом файле):
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Проверка живости воркера и доступности D1 — используем на этапе 7.1
    // как первый чек после деплоя, до появления реальных эндпойнтов.
    if (url.pathname === "/api/v1/health") {
      try {
        await env.DB.prepare("SELECT 1").first();
        return Response.json({ ok: true, db: "reachable", ts: Date.now() });
      } catch (err) {
        return Response.json(
          { ok: false, db: "unreachable", error: String(err) },
          { status: 500 }
        );
      }
    }

    // Заглушки — будут заменены в этапах 7.3–7.6:
    // - валидация initData (HMAC) на каждый запрос к /api/v1/*
    // - games: create/list/get/rolls с идемпотентностью по clientEventId
    if (url.pathname.startsWith("/api/v1/")) {
      return Response.json({ error: "not_implemented" }, { status: 501 });
    }

    // Заглушка — обработчик /start и открытие Mini App появится в этапе 7.6
    if (url.pathname === "/telegram/webhook") {
      return Response.json({ error: "not_implemented" }, { status: 501 });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },
};
