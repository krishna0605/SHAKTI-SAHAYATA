import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import AuthenticatedLayout from './components/AuthenticatedLayout'
import RouteLoadingShell from './components/RouteLoadingShell'
import LegacyAdminRedirectPage from './admin/components/LegacyAdminRedirectPage'
import { useAuthStore } from './stores/authStore'

const LandingPage = lazy(() => import('./pages/LandingPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SignUpPage = lazy(() => import('./pages/SignUpPage'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const CaseView = lazy(() => import('./pages/CaseView'))
const CreateCasePage = lazy(() => import('./pages/CreateCasePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.Settings })))
const OSINTTools = lazy(() => import('./components/osint/OSINT').then((m) => ({ default: m.OSINTTools })))

function App() {
  const { initTheme, bootstrapAuth } = useAuthStore()

  useEffect(() => {
    initTheme()
    bootstrapAuth()
  }, [bootstrapAuth, initTheme])

  return (
    <Suspense fallback={<RouteLoadingShell label="Loading workspace" />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/admin/*" element={<LegacyAdminRedirectPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AuthenticatedLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/create-case" element={<CreateCasePage />} />
            <Route path="/case/:id" element={<CaseView />} />
            <Route path="/case/:id/:dataType" element={<CaseView />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/osint" element={<OSINTTools />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}

export default App
