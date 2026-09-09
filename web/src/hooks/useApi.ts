import { useEffect, useState, useCallback } from "react";
import { getApiUrl, getApiHeaders } from "../lib/api";

export function useApi<T>(url: string, pollIntervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(getApiUrl(url), { headers: getApiHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
    
    if (pollIntervalMs) {
      const timer = setInterval(fetchData, pollIntervalMs);
      return () => clearInterval(timer);
    }
  }, [fetchData, pollIntervalMs]);

  return { data, loading, error, refetch: fetchData };
}
