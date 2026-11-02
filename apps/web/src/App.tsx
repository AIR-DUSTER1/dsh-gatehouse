import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AppShell } from './components/AppShell';
import { LoadingState } from './components/ui';

const LoginPage = lazy(() => import('./pages/Login/LoginPage').then(module => ({ default: module.LoginPage })));
const DashboardPage = lazy(() => import('./pages/Dashboard/DashboardPage').then(module => ({ default: module.DashboardPage })));
const ReviewQueuePage = lazy(() => import('./pages/ReviewQueue/ReviewQueuePage').then(module => ({ default: module.ReviewQueuePage })));
const CaseDetailPage = lazy(() => import('./pages/CaseDetail/CaseDetailPage').then(module => ({ default: module.CaseDetailPage })));
const SchedulePage = lazy(() => import('./pages/Schedule/SchedulePage').then(module => ({ default: module.SchedulePage })));
const ExecutionPage = lazy(() => import('./pages/Execution/ExecutionPage').then(module => ({ default: module.ExecutionPage })));
const AuditPage = lazy(() => import('./pages/Audit/AuditPage').then(module => ({ default: module.AuditPage })));
const SettingsPage = lazy(() => import('./pages/Settings/SettingsPage').then(module => ({ default: module.SettingsPage })));

function ProtectedShell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="app-loading"><LoadingState label="正在建立安全会话…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell />;
}

export function App() {
  return (
    <Suspense fallback={<div className="app-loading"><LoadingState /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/review" element={<ReviewQueuePage />} />
          <Route path="/review/:id" element={<CaseDetailPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/executions" element={<ExecutionPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
