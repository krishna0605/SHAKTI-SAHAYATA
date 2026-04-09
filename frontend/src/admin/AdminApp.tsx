import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import RouteLoadingShell from '../components/RouteLoadingShell'
import AdminProtectedRoute from './components/AdminProtectedRoute'
import { AdminLiveUpdatesProvider } from './components/AdminLiveUpdatesProvider'
import AdminLayout from './layout/AdminLayout'
import { adminPaths } from './lib/paths'
import { useAuthStore } from '../stores/authStore'

const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage'))
const AdminForcePasswordChangePage = lazy(() => import('./pages/AdminForcePasswordChangePage'))
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'))
const AdminCasesPage = lazy(() => import('./pages/AdminCasesPage'))
const AdminCaseDetailPage = lazy(() => import('./pages/AdminCaseDetailPage'))
const AdminIngestionPipelinePage = lazy(() => import('./pages/AdminIngestionPipelinePage'))
const AdminNormalizationPage = lazy(() => import('./pages/AdminNormalizationPage'))
const AdminTableEditorPage = lazy(() => import('./pages/AdminTableEditorPage'))
const AdminDatabaseWorkspacePage = lazy(() => import('./pages/AdminDatabaseWorkspacePage'))
const AdminUsersRolesPage = lazy(() => import('./pages/AdminUsersRolesPage'))
const AdminAuditTrailPage = lazy(() => import('./pages/AdminAuditTrailPage'))
const AdminAlertsIncidentsPage = lazy(() => import('./pages/AdminAlertsIncidentsPage'))
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage'))

export default function AdminApp() {
  const initTheme = useAuthStore((state) => state.initTheme)

  useEffect(() => {
    initTheme()
  }, [initTheme])

  return (
    <Suspense fallback={<RouteLoadingShell label="Loading admin console" />}>
      <Routes>
        <Route path={adminPaths.login} element={<AdminLoginPage />} />

        <Route element={<AdminProtectedRoute />}>
          <Route path={adminPaths.forcePasswordChange} element={<AdminForcePasswordChangePage />} />
          <Route
            element={
              <AdminLiveUpdatesProvider>
                <AdminLayout />
              </AdminLiveUpdatesProvider>
            }
          >
            <Route path={adminPaths.home} element={<AdminDashboardPage />} />
            <Route path={adminPaths.cases} element={<AdminCasesPage />} />
            <Route path="/cases/:caseId" element={<AdminCaseDetailPage />} />
            <Route path={adminPaths.ingestion} element={<AdminIngestionPipelinePage />} />
            <Route path={adminPaths.normalization} element={<AdminNormalizationPage />} />
            <Route path={adminPaths.tableEditor} element={<AdminTableEditorPage />} />
            <Route path={adminPaths.database} element={<AdminDatabaseWorkspacePage />} />
            <Route path={adminPaths.users} element={<AdminUsersRolesPage />} />
            <Route path={adminPaths.audit} element={<AdminAuditTrailPage />} />
            <Route path={adminPaths.alerts} element={<AdminAlertsIncidentsPage />} />
            <Route path={adminPaths.settings} element={<AdminSettingsPage />} />

            <Route path={adminPaths.legacyOverview} element={<Navigate to={adminPaths.dashboard} replace />} />
            <Route path={adminPaths.activity} element={<Navigate to={adminPaths.audit} replace />} />
            <Route path={adminPaths.files} element={<Navigate to={adminPaths.ingestion} replace />} />
            <Route path={adminPaths.system} element={<Navigate to={`${adminPaths.database}?tab=observability`} replace />} />
            <Route path={adminPaths.exports} element={<Navigate to={adminPaths.audit} replace />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
