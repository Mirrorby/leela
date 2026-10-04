import { tr } from '../i18n/language';
import { useCallback, useEffect, useState } from 'react';
import type { Entitlements, Product } from '../types/payments';
import {
  getEntitlementsFromServer,
  getProductsFromServer,
  WorkerApiError,
} from '../api/workerClient';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof WorkerApiError ? err.message : fallback;
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
      setError(errorMessage(err, tr("Не удалось загрузить информацию о балансе — проверь соединение.")));
    } finally {
      setLoading(false);
    }
  }, []);

  // Returning from an external checkout only triggers a server balance read.
  // A link click or browser return is never proof that payment succeeded.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshOnReturn = () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      timer = setTimeout(() => { void refresh(); }, 300);
    };
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [refresh]);

  return { entitlements, products, loading, error, refresh };
}
