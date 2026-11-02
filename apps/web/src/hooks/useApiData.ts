import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';

export function useApiData<T>(path: string | null): { data: T | null; loading: boolean; error: ApiError | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((value) => { if (!cancelled) setData(value); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof ApiError ? reason : new ApiError({ error: { code: 'UNKNOWN', message: '加载失败', action: '刷新重试', trace_id: '' } }, 0)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, version]);

  return { data, loading, error, reload };
}
