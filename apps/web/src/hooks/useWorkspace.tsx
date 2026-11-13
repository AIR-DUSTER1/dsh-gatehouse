import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { WorkspaceListItem } from '@gatehouse/contract';
import { ApiError, api } from '../api/client';
import { preferredWorkspace } from '../lib/workspace-routes';
import { useAuth } from './useAuth';

export interface WorkspaceContextValue {
  workspaces: WorkspaceListItem[];
  preferred: WorkspaceListItem | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Owns workspace server state only. URL-derived selection lives in the router adapter. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (authLoading || !user) { setWorkspaces([]); setLoading(false); setLoadedForUser(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<{ items: WorkspaceListItem[] }>('/api/workspaces')
      .then((result) => { if (!cancelled) setWorkspaces(result.items); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof ApiError ? reason : new ApiError({
          error: { code: 'UNKNOWN', message: '工作区加载失败', action: '刷新页面后重试', trace_id: '' },
        }, 0));
      })
      .finally(() => { if (!cancelled) { setLoading(false); setLoadedForUser(user.id); } });
    return () => { cancelled = true; };
  }, [authLoading, user, version]);

  const preferred = preferredWorkspace(workspaces);
  const effectiveLoading = loading || Boolean(user && loadedForUser !== user.id);
  const value = useMemo(() => ({ workspaces, preferred, loading: effectiveLoading, error, reload }),
    [workspaces, preferred, effectiveLoading, error, reload]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}
