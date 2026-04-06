import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { BrandMark } from '@/components/shared/BrandMark'

/**
 * Guards protected routes — redirects to /login if no token.
 */
export default function ProtectedRoute() {
  const { authStatus } = useAuthStore()

  if (authStatus === 'unknown') {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
        <div className="glass-card relative z-10 w-full max-w-md rounded-[2rem] px-8 py-10 text-center">
          <div className="mx-auto flex w-fit justify-center">
            <BrandMark compact />
          </div>
          <div className="mx-auto mt-6 h-12 w-12 animate-spin rounded-full border-4 border-shakti-300/25 border-t-shakti-600" />
          <p className="mt-5 text-sm font-medium text-slate-600 dark:text-slate-300">Restoring secure officer session...</p>
        </div>
      </div>
    )
  }

  if (authStatus !== 'authenticated') {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
