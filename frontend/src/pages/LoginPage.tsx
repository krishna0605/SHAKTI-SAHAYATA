import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BrandMark } from '@/components/shared/BrandMark'
import { TextGenerateEffect } from '@/components/ui/aceternity/text-generate-effect'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Login failed. Please try again.'
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()

  const [buckleId, setBuckleId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await api.login(buckleId.trim(), email.trim().toLowerCase(), password)
      setAuth(data.accessToken, data.user, data.session)
      navigate('/dashboard')
    } catch (error: unknown) {
      setError(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl items-center">
        <div className="grid w-full gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="hidden lg:block">
            <div className="section-aura max-w-xl space-y-6">
              <Badge className="rounded-full border border-shakti-300/30 bg-shakti-100/80 px-4 py-1 text-[11px] uppercase tracking-[0.22em] text-shakti-700 dark:border-shakti-400/20 dark:bg-shakti-500/10 dark:text-shakti-200">
                Officer Access Portal
              </Badge>
              <BrandMark />
              <h1 className="text-5xl font-semibold tracking-tight text-balance">
                <TextGenerateEffect words="Secure sign-in for investigation-grade telecom analytics." duration={0.6} />
              </h1>
              <p className="text-lg leading-8 text-slate-600 dark:text-slate-300">
                Continue into the SHAKTI workspace with your Buckle ID, protected officer session, and case-centric analysis environment.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {['JWT-hardened sessions', 'Local AI runtime', 'Case-centric guardrails', 'Police-theme operational shell'].map((item) => (
                  <div key={item} className="glass-card-hover px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Card className="glass-card mx-auto w-full max-w-lg rounded-[2rem] border-white/60 bg-white/80 p-0 shadow-[0_28px_80px_rgba(10,19,51,0.18)] dark:border-white/10 dark:bg-surface-900/82">
            <CardHeader className="space-y-5 border-b border-border/70 pb-6 px-6 sm:px-8 pt-6">
              <div className="flex items-center justify-between">
                <Button asChild variant="ghost" size="sm" className="rounded-xl px-3">
                  <Link to="/">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Link>
                </Button>
                <Badge className="rounded-full border border-shakti-300/30 bg-shakti-100/80 text-shakti-700 dark:border-shakti-400/20 dark:bg-shakti-500/10 dark:text-shakti-200">
                  Authorized Use Only
                </Badge>
              </div>
              <div className="space-y-4">
                <BrandMark compact />
                <div>
                  <CardTitle className="text-3xl">Sign in to your account</CardTitle>
                  <CardDescription className="mt-2 text-base leading-7">
                    Enter your department-issued credentials to access SHAKTI SAHAYATA.
                  </CardDescription>
                </div>
              </div>
              <Tabs value="login">
                <TabsList className="grid w-full grid-cols-2 rounded-2xl bg-muted/80 p-1">
                  <TabsTrigger value="login" className="rounded-xl">Login</TabsTrigger>
                  <TabsTrigger value="signup" asChild className="rounded-xl">
                    <Link to="/signup">Sign Up</Link>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
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

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="login-buckle-id" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Buckle ID
                  </label>
                  <Input
                    id="login-buckle-id"
                    type="text"
                    value={buckleId}
                    onChange={(e) => setBuckleId(e.target.value)}
                    placeholder="BK-9999"
                    className="h-12 rounded-xl border-shakti-100 bg-white/80 dark:border-white/10 dark:bg-surface-900/90"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="login-email" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Email Address
                  </label>
                  <Input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@police.gov.in"
                    className="h-12 rounded-xl border-shakti-100 bg-white/80 dark:border-white/10 dark:bg-surface-900/90"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="login-password" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Password
                  </label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your secure password"
                      className="h-12 rounded-xl border-shakti-100 bg-white/80 pr-12 dark:border-white/10 dark:bg-surface-900/90"
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <Button type="submit" disabled={loading} className="h-12 w-full rounded-2xl text-base">
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>

              <div className="rounded-2xl border border-shakti-300/25 bg-shakti-50 px-4 py-3 text-sm text-slate-700 dark:border-shakti-400/20 dark:bg-shakti-500/10 dark:text-slate-200">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-shakti-600 dark:text-shakti-300" />
                  <span>Your session is validated against authorized officer records and hardened for internal department testing.</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
