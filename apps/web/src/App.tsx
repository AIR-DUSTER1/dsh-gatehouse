import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AppShell } from './components/AppShell';
import { LoadingState } from './components/ui';
import { preferredWorkspacePath, useWorkspace } from './hooks/useWorkspace';

const LoginPage = lazy(() => import('./pages/Login/LoginPage').then(module => ({ default: module.LoginPage })));
const DashboardPage = lazy(() => import('./pages/Dashboard/DashboardPage').then(module => ({ default: module.DashboardPage })));
const ReviewQueuePage = lazy(() => import('./pages/ReviewQueue/ReviewQueuePage').then(module => ({ default: module.ReviewQueuePage })));
const CaseDetailPage = lazy(() => import('./pages/CaseDetail/CaseDetailPage').then(module => ({ default: module.CaseDetailPage })));
const SchedulePage = lazy(() => import('./pages/Schedule/SchedulePage').then(module => ({ default: module.SchedulePage })));
const ExecutionPage = lazy(() => import('./pages/Execution/ExecutionPage').then(module => ({ default: module.ExecutionPage })));
const AuditPage = lazy(() => import('./pages/Audit/AuditPage').then(module => ({ default: module.AuditPage })));
const SettingsPage = lazy(() => import('./pages/Settings/SettingsPage').then(module => ({ default: module.SettingsPage })));
const WorkspacesPage = lazy(() => import('./pages/Workspaces/WorkspacesPage').then(module => ({ default: module.WorkspacesPage })));
const AnalyticsPage = lazy(() => import('./pages/Analytics/AnalyticsPage').then(module => ({ default: module.AnalyticsPage })));

function ProtectedShell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="app-loading"><LoadingState label="正在建立安全会话…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell />;
}

function RootRedirect() {
  const { workspaces, loading } = useWorkspace();
  if (loading) return <div className="app-loading"><LoadingState label="正在读取工作区…" /></div>;
  return <Navigate to={preferredWorkspacePath(workspaces)} replace />;
}

function WorkspaceBoundary() {
  const { current, currentId, workspaces, loading } = useWorkspace();
  if (loading) return <div className="app-loading"><LoadingState label="正在校验工作区权限…" /></div>;
  if (currentId && !current) return <Navigate to={preferredWorkspacePath(workspaces)} replace />;
  return <Outlet />;
}

function LegacyRedirect() {
  const location = useLocation();
  const { workspaces, loading } = useWorkspace();
  if (loading) return <div className="app-loading"><LoadingState label="正在恢复工作区…" /></div>;
  return <Navigate to={preferredWorkspacePath(workspaces, location.pathname)} replace />;
}

export function App() {
  return (
    <Suspense fallback={<div className="app-loading"><LoadingState /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedShell />}>
          <Route index element={<RootRedirect />} />
          <Route path="/w/:workspaceId" element={<WorkspaceBoundary />}>
            <Route index element={<DashboardPage />} />
            <Route path="review" element={<ReviewQueuePage />} />
            <Route path="review/:id" element={<CaseDetailPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="executions" element={<ExecutionPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/review" element={<LegacyRedirect />} />
          <Route path="/review/:id" element={<LegacyRedirect />} />
          <Route path="/schedule" element={<LegacyRedirect />} />
          <Route path="/executions" element={<LegacyRedirect />} />
          <Route path="/audit" element={<LegacyRedirect />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
