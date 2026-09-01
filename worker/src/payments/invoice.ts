import type { Product } from '../types/payments';
import { SUBSCRIPTION_PERIOD_SECONDS } from './catalog';

interface CreateInvoiceLinkResponse {
  ok: boolean;
  result?: string;
  description?: string;
}

/**
 * Создаёт ссылку на оплату через Telegram Stars (валюта XTR — provider_token
 * ОБЯЗАН отсутствовать для Stars, см. Bot API changelog 28 мая 2024).
 * transactionId (см. payments/repository.ts:createPendingTransaction)
 * передаётся как payload — ровно то значение, которое потом придёт назад в
 * pre_checkout_query.invoice_payload и successful_payment.invoice_payload,
 * это единственная связь между конкретным инвойсом и нашей записью в
 * transactions.
 *
 * subscription_period — ТОЛЬКО для product.isSubscription, и Bot API
 * принимает для него СТРОГО SUBSCRIPTION_PERIOD_SECONDS (2592000, см.
 * catalog.ts) — другое значение отклоняется на стороне Telegram.
 */
export async function createInvoiceLink(botToken: string, transactionId: string, product: Product): Promise<string> {
  const body: Record<string, unknown> = {
    title: product.title,
    description: `Лила — ${product.title}`,
    payload: transactionId,
    currency: 'XTR',
    prices: [{ label: product.title, amount: product.stars }],
  };
  if (product.isSubscription) {
    body.subscription_period = SUBSCRIPTION_PERIOD_SECONDS;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as CreateInvoiceLinkResponse;
  if (!data.ok || !data.result) {
    throw new Error(`createInvoiceLink failed: ${data.description ?? 'unknown error'}`);
  }
  return data.result;
}
