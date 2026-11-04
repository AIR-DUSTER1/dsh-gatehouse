import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { WorkspaceListItem } from '@gatehouse/contract';
import { ApiError, api } from '../api/client';
import { useAuth } from './useAuth';

const LAST_WORKSPACE_KEY = 'gatehouse:last-workspace';

interface WorkspaceContextValue {
  workspaces: WorkspaceListItem[];
  current: WorkspaceListItem | null;
  preferred: WorkspaceListItem | null;
  currentId: string | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const currentId = /^\/w\/([^/]+)/.exec(location.pathname)?.[1] ?? null;

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

  useEffect(() => {
    if (currentId) localStorage.setItem(LAST_WORKSPACE_KEY, currentId);
  }, [currentId]);

  const current = workspaces.find((workspace) => workspace.id === currentId) ?? null;
  const preferred = preferredWorkspace(workspaces);
  const effectiveLoading = loading || Boolean(user && loadedForUser !== user.id);
  const value = useMemo(() => ({ workspaces, current, preferred, currentId, loading: effectiveLoading, error, reload }),
    [workspaces, current, preferred, currentId, effectiveLoading, error, reload]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}

/** Picks the most useful default without silently preferring historical or disabled workspaces. */
export function preferredWorkspace(workspaces: WorkspaceListItem[]): WorkspaceListItem | null {
  const active = workspaces.filter((workspace) => workspace.status === 'active');
  return active.find((workspace) => workspace.repositories.length > 0)
    ?? active[0]
    ?? workspaces.find((workspace) => workspace.status === 'onboarding')
    ?? workspaces[0]
    ?? null;
}

/** Keeps the user's last accessible workspace, then falls back to the production-ready default. */
export function preferredWorkspacePath(workspaces: WorkspaceListItem[], suffix = ''): string {
  const remembered = localStorage.getItem(LAST_WORKSPACE_KEY);
  const selected = remembered ? workspaces.find((workspace) => workspace.id === remembered) : undefined;
  const workspace = selected ?? preferredWorkspace(workspaces);
  return workspace ? workspacePath(workspace.id, suffix) : '/workspaces';
}

export function workspacePath(workspaceId: string, suffix = ''): string {
  const clean = suffix.replace(/^\/+/, '');
  return `/w/${workspaceId}${clean ? `/${clean}` : ''}`;
}

export function workspaceSuffix(pathname: string): string {
  const match = /^\/w\/[^/]+\/?(.*)$/.exec(pathname);
  return match?.[1] ?? '';
}
