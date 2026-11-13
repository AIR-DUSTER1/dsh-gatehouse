import type { WorkspaceListItem } from '@gatehouse/contract';

const LAST_WORKSPACE_KEY = 'gatehouse:last-workspace';

/** Picks the most useful default without silently preferring historical or disabled workspaces. */
export function preferredWorkspace(workspaces: WorkspaceListItem[]): WorkspaceListItem | null {
  const active = workspaces.filter((workspace) => workspace.status === 'active');
  return active.find((workspace) => workspace.repositories.length > 0)
    ?? active[0]
    ?? workspaces.find((workspace) => workspace.status === 'onboarding')
    ?? workspaces[0]
    ?? null;
}

export function rememberedWorkspaceId(): string | null {
  return localStorage.getItem(LAST_WORKSPACE_KEY);
}

export function rememberWorkspaceId(workspaceId: string): void {
  localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}

/** Keeps the user's last accessible workspace, then falls back to the production-ready default. */
export function preferredWorkspacePath(workspaces: WorkspaceListItem[], suffix = ''): string {
  const remembered = rememberedWorkspaceId();
  const selected = remembered ? workspaces.find((workspace) => workspace.id === remembered) : undefined;
  const workspace = selected ?? preferredWorkspace(workspaces);
  return workspace ? workspacePath(workspace.id, suffix) : '/workspaces';
}

export function workspacePath(workspaceId: string, suffix = ''): string {
  const clean = suffix.replace(/^\/+/, '');
  return `/w/${workspaceId}${clean ? `/${clean}` : ''}`;
}

export function workspaceIdFromPath(pathname: string): string | null {
  return /^\/w\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

export function workspaceSuffix(pathname: string): string {
  const match = /^\/w\/[^/]+\/?(.*)$/.exec(pathname);
  return match?.[1] ?? '';
}
