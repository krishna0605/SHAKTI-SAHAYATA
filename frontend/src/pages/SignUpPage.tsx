import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, BadgeCheck, Eye, EyeOff, ShieldCheck } from 'lucide-react'
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
  return error instanceof Error ? error.message : 'Registration failed. Please try again.'
}

export default function SignUpPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()

  const [buckleId, setBuckleId] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const validate = (): string | null => {
    if (!buckleId.trim()) return 'Buckle ID is required.'
    if (fullName.trim().length < 2) return 'Please enter your full name.'
    if (!email.includes('@')) return 'Please enter a valid email address.'
    if (password.length < 8) return 'Password must be at least 8 characters.'
    if (!/[A-Z]/.test(password)) return 'Password must contain at least 1 uppercase letter.'
    if (!/[0-9]/.test(password)) return 'Password must contain at least 1 number.'
    if (password !== confirmPassword) return 'Passwords do not match.'
    return null
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    try {
      const data = await api.signup(
        buckleId.trim(),
        fullName.trim(),
        email.trim().toLowerCase(),
        password
      )
      setAuth(data.accessToken, data.user, data.session)
      navigate('/dashboard')
    } catch (error: unknown) {
      setError(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const passwordChecks = [
    { label: '8+ characters', valid: password.length >= 8 },
    { label: 'Uppercase letter', valid: /[A-Z]/.test(password) },
    { label: 'Numeric character', valid: /[0-9]/.test(password) },
  ]

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl items-center z-10">
        <div className="grid w-full gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
          <Card className="glass-card order-2 mx-auto w-full max-w-xl rounded-[2rem] border-white/60 bg-white/80 p-0 shadow-[0_28px_80px_rgba(10,19,51,0.18)] dark:order-1 dark:border-white/10 dark:bg-surface-900/82 lg:mx-0">
            <CardHeader className="space-y-5 border-b border-border/70 pb-6 px-6 sm:px-8 pt-6">
              <div className="flex items-center justify-between">
                <Button asChild variant="ghost" size="sm" className="rounded-xl px-3">
                  <Link to="/">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Link>
                </Button>
                <Badge className="rounded-full border border-shakti-300/30 bg-shakti-100/80 text-shakti-700 dark:border-shakti-400/20 dark:bg-shakti-500/10 dark:text-shakti-200">
                  Department Access
                </Badge>
              </div>
              <div className="space-y-4">
                <BrandMark compact />
                <div>
                  <CardTitle className="text-3xl">Create officer account</CardTitle>
                  <CardDescription className="mt-2 text-base leading-7">
                    Register an internal account for the SHAKTI investigative workspace.
                  </CardDescription>
                </div>
              </div>
              <Tabs value="signup">
                <TabsList className="grid w-full grid-cols-2 rounded-2xl bg-muted/80 p-1">
                  <TabsTrigger value="login" asChild className="rounded-xl">
                    <Link to="/login">Login</Link>
                  </TabsTrigger>
                  <TabsTrigger value="signup" className="rounded-xl">Sign Up</TabsTrigger>
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

              <form onSubmit={handleSubmit} className="grid gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="signup-buckle-id" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Buckle ID
                    </label>
                    <Input
                      id="signup-buckle-id"
                      type="text"
                      value={buckleId}
                      onChange={(e) => setBuckleId(e.target.value)}
                      placeholder="BK-9999"
                      className="h-12 rounded-xl border-shakti-100 bg-white/80 dark:border-white/10 dark:bg-surface-900/90"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="signup-full-name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Full Name
                    </label>
                    <Input
                      id="signup-full-name"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Inspector Rajesh Sharma"
                      className="h-12 rounded-xl border-shakti-100 bg-white/80 dark:border-white/10 dark:bg-surface-900/90"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="signup-email" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Email Address
                  </label>
                  <Input
                    id="signup-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="officer@police.gov.in"
                    className="h-12 rounded-xl border-shakti-100 bg-white/80 dark:border-white/10 dark:bg-surface-900/90"
                    required
                  />
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="signup-password" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Password
                    </label>
                    <div className="relative">
                      <Input
                        id="signup-password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Create password"
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

                  <div className="space-y-2">
                    <label htmlFor="signup-confirm-password" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Confirm Password
                    </label>
                    <Input
                      id="signup-confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      className="h-12 rounded-xl border-shakti-100 bg-white/80 dark:border-white/10 dark:bg-surface-900/90"
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-2 rounded-2xl border border-shakti-300/20 bg-shakti-50 p-4 dark:border-shakti-400/20 dark:bg-shakti-500/10">
                  {passwordChecks.map((check) => (
                    <div key={check.label} className="flex items-center gap-3 text-sm">
                      <BadgeCheck className={`h-4 w-4 ${check.valid ? 'text-emerald-500' : 'text-slate-400'}`} />
                      <span className={check.valid ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}>
                        {check.label}
                      </span>
                    </div>
                  ))}
                </div>

                <Button type="submit" disabled={loading} className="h-12 rounded-2xl text-base">
                  {loading ? 'Creating account...' : 'Create Account'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="order-1 hidden lg:block dark:order-2">
            <div className="section-aura max-w-xl space-y-6">
              <Badge className="rounded-full border border-shakti-300/30 bg-shakti-100/80 px-4 py-1 text-[11px] uppercase tracking-[0.22em] text-shakti-700 dark:border-shakti-400/20 dark:bg-shakti-500/10 dark:text-shakti-200">
                Controlled Onboarding
              </Badge>
              <BrandMark />
              <h1 className="text-5xl font-semibold tracking-tight text-balance">
                <TextGenerateEffect words="Provision officers into a more polished, police-grade workspace." duration={0.6} />
              </h1>
              <p className="text-lg leading-8 text-slate-600 dark:text-slate-300">
                The new UI keeps onboarding secure and deliberate while aligning the product with the operational tone of Gujarat Police.
              </p>
              <div className="space-y-4">
                {[
                  'Buckle ID-linked identity',
                  'Repeatable internal testing flow',
                  'Case-first command surface',
                ].map((item) => (
                  <div key={item} className="glass-card-hover flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <ShieldCheck className="h-4 w-4 text-shakti-600 dark:text-shakti-300" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
