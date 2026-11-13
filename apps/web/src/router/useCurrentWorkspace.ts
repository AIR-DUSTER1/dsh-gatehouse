import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import type { WorkspaceListItem } from '@gatehouse/contract';
import { useWorkspace, type WorkspaceContextValue } from '../hooks/useWorkspace';
import { rememberWorkspaceId, workspaceIdFromPath } from '../lib/workspace-routes';

export interface CurrentWorkspaceContextValue extends WorkspaceContextValue {
  currentId: string | null;
  current: WorkspaceListItem | null;
}

/**
 * Route adapter for workspace-aware pages.
 * The workspace store owns server state; this hook alone derives selection from the URL.
 */
export function useCurrentWorkspace(): CurrentWorkspaceContextValue {
  const location = useLocation();
  const workspace = useWorkspace();
  const currentId = workspaceIdFromPath(location.pathname);

  useEffect(() => {
    if (currentId) rememberWorkspaceId(currentId);
  }, [currentId]);

  const current = workspace.workspaces.find((item) => item.id === currentId) ?? null;
  return useMemo(() => ({ ...workspace, currentId, current }), [workspace, currentId, current]);
}
