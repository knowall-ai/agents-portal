'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ApiState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
  lastUpdated: Date | null;
}

/**
 * Minimal fetch hook with optional polling. Guards against out-of-order
 * responses and keeps the previous data while refreshing.
 */
export function useApi<T>(url: string | null, refreshMs = 0): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(url));
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const id = ++requestId.current;
    setIsLoading(true);
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => ({}));
      if (id !== requestId.current) return;
      if (!response.ok) {
        throw new Error(body.details || body.error || `Request failed (${response.status})`);
      }
      setData(body as T);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (id === requestId.current) setIsLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
    if (!refreshMs) return;
    const timer = setInterval(load, refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs]);

  return { data, error, isLoading, refetch: load, lastUpdated };
}
