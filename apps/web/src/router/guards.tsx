import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { PermissionCode } from '@gatehouse/contract';
import { AppShell } from '../components/AppShell';
import { LoadingState } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { hasPermission } from '../lib/format';
import { preferredWorkspacePath } from '../lib/workspace-routes';
import { useCurrentWorkspace } from './useCurrentWorkspace';

export function ProtectedShell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="app-loading"><LoadingState label="正在建立安全会话…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell />;
}

export function PermissionBoundary({ permission, children }: { permission: PermissionCode; children: ReactNode }) {
  const { user } = useAuth();
  return hasPermission(user, permission) ? children : <Navigate to="/" replace />;
}

export function RootRedirect() {
  const { workspaces, loading } = useWorkspace();
  if (loading) return <div className="app-loading"><LoadingState label="正在读取工作区…" /></div>;
  return <Navigate to={preferredWorkspacePath(workspaces)} replace />;
}

export function WorkspaceBoundary() {
  const { current, currentId, workspaces, loading } = useCurrentWorkspace();
  if (loading) return <div className="app-loading"><LoadingState label="正在校验工作区权限…" /></div>;
  if (currentId && !current) return <Navigate to={preferredWorkspacePath(workspaces)} replace />;
  return <Outlet />;
}

export function LegacyRedirect() {
  const location = useLocation();
  const { workspaces, loading } = useWorkspace();
  if (loading) return <div className="app-loading"><LoadingState label="正在恢复工作区…" /></div>;
  return <Navigate to={preferredWorkspacePath(workspaces, location.pathname)} replace />;
}
