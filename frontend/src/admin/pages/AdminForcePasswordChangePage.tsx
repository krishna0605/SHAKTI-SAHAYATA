import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Eye, EyeOff, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { adminPaths } from '../lib/paths'
import { adminAuthAPI } from '../lib/api'
import { useAdminAuthStore } from '../store/adminAuthStore'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to update admin password.'
}

const passwordRules = [
  { id: 'length', label: 'At least 14 characters', test: (value: string) => value.length >= 14 },
  { id: 'upper', label: 'One uppercase letter', test: (value: string) => /[A-Z]/.test(value) },
  { id: 'lower', label: 'One lowercase letter', test: (value: string) => /[a-z]/.test(value) },
  { id: 'digit', label: 'One number', test: (value: string) => /[0-9]/.test(value) },
  { id: 'special', label: 'One special character', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
] as const

export default function AdminForcePasswordChangePage() {
  const navigate = useNavigate()
  const { admin, authStatus, refreshAdminIdentity } = useAdminAuthStore()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const hasTotpPrompt = Boolean(admin?.totpEnabled || admin?.totpSecretConfigured)

  const ruleStates = useMemo(
    () =>
      passwordRules.map((rule) => ({
        ...rule,
        passed: rule.test(newPassword),
      })),
    [newPassword],
  )

  useEffect(() => {
    if (authStatus === 'authenticated' && admin && !admin.mustChangePassword) {
      navigate(adminPaths.home, { replace: true })
    }
  }, [admin, authStatus, navigate])

  useEffect(() => {
    if (authStatus === 'authenticated' && admin?.mustChangePassword && admin.totpEnabled === undefined && admin.totpSecretConfigured === undefined) {
      void refreshAdminIdentity()
    }
  }, [admin, authStatus, refreshAdminIdentity])

  if (authStatus !== 'authenticated' || !admin) {
    return <Navigate to={adminPaths.login} replace />
  }

  if (!admin.mustChangePassword) {
    return <Navigate to={adminPaths.home} replace />
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSuccessMessage('')

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }

    setLoading(true)

    try {
      const payload = await adminAuthAPI.changePassword(currentPassword, newPassword, totpCode.trim() || undefined)
      const refreshed = await refreshAdminIdentity()
      setSuccessMessage(payload.message || 'Password updated successfully.')
      if (refreshed && !refreshed.mustChangePassword) {
        navigate(adminPaths.home, { replace: true })
      }
    } catch (error) {
      setError(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl items-center justify-center">
        <Card className="glass-card mx-auto w-full max-w-xl rounded-[2rem] border-white/60 bg-white/80 shadow-[0_28px_80px_rgba(10,19,51,0.18)] dark:border-white/10 dark:bg-surface-900/82">
          <CardHeader className="space-y-5 border-b border-border/70 px-6 pb-6 pt-6 sm:px-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-[1.35rem] bg-slate-900 text-white dark:bg-white dark:text-slate-900">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <div>
              <CardTitle className="text-3xl">Security update required</CardTitle>
              <CardDescription className="mt-2 text-base leading-7">
                Your admin account is marked for password rotation. Update it now before entering the SHAKTI backend console.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 p-6 sm:p-8">
            {error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              </div>
            ) : null}

            {successMessage ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{successMessage}</span>
                </div>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="admin-current-password" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Current password
                </label>
                <div className="relative">
                  <Input
                    id="admin-current-password"
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    className="h-12 rounded-xl border-slate-200 bg-white/80 pr-12 dark:border-white/10 dark:bg-surface-900/90"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowCurrentPassword((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl"
                  >
                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="admin-new-password" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  New password
                </label>
                <div className="relative">
                  <Input
                    id="admin-new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="h-12 rounded-xl border-slate-200 bg-white/80 pr-12 dark:border-white/10 dark:bg-surface-900/90"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowNewPassword((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="admin-confirm-password" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Confirm new password
                </label>
                <div className="relative">
                  <Input
                    id="admin-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="h-12 rounded-xl border-slate-200 bg-white/80 pr-12 dark:border-white/10 dark:bg-surface-900/90"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowConfirmPassword((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {hasTotpPrompt ? (
                <div className="space-y-2">
                  <label htmlFor="admin-update-totp" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    TOTP code
                  </label>
                  <Input
                    id="admin-update-totp"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={totpCode}
                    onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit authenticator code"
                    className="h-12 rounded-xl border-slate-200 bg-white/80 dark:border-white/10 dark:bg-surface-900/90"
                  />
                </div>
              ) : null}

              <div className="rounded-2xl border border-slate-300/25 bg-slate-100 px-4 py-4 dark:border-slate-400/20 dark:bg-slate-500/10">
                <div className="mb-3 text-sm font-medium text-slate-800 dark:text-slate-100">Password policy</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ruleStates.map((rule) => (
                    <div key={rule.id} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className={`h-4 w-4 ${rule.passed ? 'text-emerald-500' : 'text-slate-500'}`} />
                      <span className={rule.passed ? 'text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}>
                        {rule.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <Button type="submit" disabled={loading} className="h-12 w-full rounded-2xl text-base bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
                {loading ? 'Updating password...' : 'Update Password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
