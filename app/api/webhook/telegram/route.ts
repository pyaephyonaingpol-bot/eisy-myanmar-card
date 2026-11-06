/**
 * Telegram support webhook — App Router shape.
 *
 * Production on Vercel rewrites `/api/*` to Express (`api/index.js`).
 * Live path: POST https://eisymyanmar.com/api/webhook/telegram
 *   → backend/src/routes/webhook.js
 *
 * `request.json()` throws on the empty body Telegram sends while checking
 * setWebhook. That non-2xx response is what makes setWebhook return ok:false,
 * so an empty or invalid body still answers HTTP 200.
 */

import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'package.json'));

type TelegramService = {
  canonicalTelegramWebhookUrl: () => string;
  parseTelegramWebhookPayload: (body: unknown) => { update: unknown; message: unknown };
  handleTelegramUpdate: (update: unknown) => Promise<unknown>;
  isWebhookSecret: (value: string) => boolean;
};

function loadService(): TelegramService {
  return require(path.join(process.cwd(), 'backend/src/services/supportTelegramService.js')) as TelegramService;
}

export async function GET() {
  const service = loadService();
  return Response.json({
    ok: true,
    service: 'telegram-support-webhook',
    method: 'POST',
    path: '/api/webhook/telegram',
    url: service.canonicalTelegramWebhookUrl(),
  });
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}

export async function POST(request: Request) {
  const service = loadService();
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  const header = request.headers.get('x-telegram-bot-api-secret-token') || '';
  const parsed = service.parseTelegramWebhookPayload(body);
  const update = parsed.update as { update_id?: unknown } | null;
  const isProbe = !parsed.message && (update == null || update.update_id == null);
  if (service.isWebhookSecret(secret) && header !== secret && !isProbe) {
    return Response.json({ ok: false, error: 'Invalid webhook secret' }, { status: 401 });
  }

  try {
    const result = await service.handleTelegramUpdate(update || {});
    return Response.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook error';
    console.error('[webhook/telegram]', message);
    return Response.json({ ok: true, received: true, error: message });
  }
}
