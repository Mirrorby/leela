import { useCallback, useState } from 'react';
import type { Entitlements, Product, ProductId } from '../types/payments';
import {
  getEntitlementsFromServer,
  getProductsFromServer,
  createInvoiceOnServer,
  WorkerApiError,
} from '../api/workerClient';
import { openInvoice, type InvoiceStatus } from '../telegram/telegramAdapter';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof WorkerApiError ? err.message : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * usePayments — единственная точка входа UI в монетизацию, тот же принцип,
 * что у useGameSession для партий ("экраны никогда не обращаются к Worker
 * API напрямую"). Отдельный хук, а не расширение useGameSession — баланс/
 * покупки логически не привязаны к конкретной партии (можно купить партию,
 * ещё не создав/не открыв ни одной).
 */
export function usePayments() {
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ent, prods] = await Promise.all([getEntitlementsFromServer(), getProductsFromServer()]);
      setEntitlements(ent);
      setProducts(prods);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось загрузить информацию о балансе — проверь соединение.'));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Создаёт инвойс, открывает нативный экран оплаты Stars, и по статусу
   * 'paid' переспрашивает сервер с несколькими короткими повторами —
   * вебхук successful_payment обычно приходит почти мгновенно, но НЕ
   * синхронно с закрытием экрана оплаты (см. openInvoice в telegramAdapter.ts:
   * статус от Telegram — сигнал с клиента, не подтверждение начисления).
   * Если после всех попыток баланс так и не отразил покупку — это не
   * ошибка самого buyProduct (платёж мог и правда пройти чуть позже),
   * вызывающий экран просто увидит старые entitlements и человек может
   * обновить вручную.
   */
  const buyProduct = useCallback(async (productId: ProductId): Promise<InvoiceStatus> => {
    setError(null);
    let invoiceUrl: string;
    try {
      invoiceUrl = await createInvoiceOnServer(productId);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось создать счёт на оплату — проверь соединение.'));
      return 'failed';
    }

    const status = await openInvoice(invoiceUrl);
    if (status === 'paid') {
      for (let attempt = 0; attempt < 3; attempt++) {
        await delay(1200);
        try {
          const [ent, prods] = await Promise.all([getEntitlementsFromServer(), getProductsFromServer()]);
          setEntitlements(ent);
          setProducts(prods);
        } catch {
          // Офлайн-моргание сразу после возврата из системного экрана
          // оплаты — не повод показывать ошибку, следующая попытка (или
          // обычный refresh() экрана) досчитает.
        }
      }
    }
    return status;
  }, []);

  return { entitlements, products, loading, error, refresh, buyProduct };
}

export type PaymentsSession = ReturnType<typeof usePayments>;
