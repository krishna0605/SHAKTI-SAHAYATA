import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  FileSearch,
  Globe2,
  Moon,
  RadioTower,
  Shield,
  Sparkles,
  Sun,
  UploadCloud,
  Waypoints,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { BrandMark } from '@/components/shared/BrandMark'
import { Reveal } from '@/components/shared/Reveal'
import { Spotlight } from '@/components/ui/aceternity/spotlight'
import { TextGenerateEffect } from '@/components/ui/aceternity/text-generate-effect'
import { FlipWords } from '@/components/ui/aceternity/flip-words'
import { HoverEffect } from '@/components/ui/aceternity/card-hover-effect'
import { TracingBeam } from '@/components/ui/aceternity/tracing-beam'
import { LampContainer } from '@/components/ui/aceternity/lamp-effect'
import { ColourfulText } from '@/components/ui/aceternity/colourful-text'
import { motion } from 'framer-motion'

const capabilities = [
  {
    title: 'Telecom Intelligence',
    description: 'Operator-normalized CDR, SDR, ILD, IPDR, and tower workflows built for real investigation depth.',
    icon: RadioTower,
  },
  {
    title: 'Case Command Center',
    description: 'One operational surface for case creation, uploads, evidence context, timelines, and officer workflows.',
    icon: FileSearch,
  },
  {
    title: 'AI-Guided Analysis',
    description: 'Guard-railed case intelligence for summaries, cross-record synthesis, and investigation support.',
    icon: Bot,
  },
  {
    title: 'Secure On-Premise Control',
    description: 'Designed for department-owned infrastructure, session controls, auditability, and local AI execution.',
    icon: Shield,
  },
]

const journey = [
  { title: 'Officer verification', description: 'Access begins with Buckle ID-linked identity and secure session bootstrap.' },
  { title: 'Case creation and upload', description: 'Open a case, assign metadata, and ingest structured telecom and evidence files.' },
  { title: 'Analytics and timeline building', description: 'Review modules, summaries, patterns, graphs, roaming, and event progressions.' },
  { title: 'Guided operational response', description: 'Use SHAKTI SAHAYATA for grounded case assistance instead of generic chat behavior.' },
]

const securitySignals = [
  'Host-local AI runtime',
  'Repeatable seed setup',
  'Protected officer sessions',
  'Case-grounded AI responses',
]

export default function LandingPage() {
  const { initTheme, isDarkMode, toggleTheme } = useAuthStore()

  useEffect(() => {
    initTheme()
  }, [initTheme])

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="interactive-ring rounded-2xl">
            <BrandMark compact />
          </Link>

          <div className="hidden items-center gap-1 lg:flex">
            <Button asChild variant="ghost" className="rounded-xl px-4 text-sm">
              <a href="#capabilities">Capabilities</a>
            </Button>
            <Button asChild variant="ghost" className="rounded-xl px-4 text-sm">
              <a href="#workflow">Workflow</a>
            </Button>
            <Button asChild variant="ghost" className="rounded-xl px-4 text-sm">
              <a href="#readiness">Readiness</a>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-2xl"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <div className="hidden items-center gap-2 md:flex">
              <Button asChild variant="ghost" className="text-sm">
                <Link to="/login">Officer Login</Link>
              </Button>
              <Button asChild className="h-10 rounded-xl px-5">
                <Link to="/signup">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>

            <Button asChild variant="ghost" className="text-sm">
              <Link to="/login" className="md:hidden">Login</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="section-aura relative px-4 pb-20 pt-12 sm:px-6 lg:px-8 lg:pb-24 lg:pt-16 overflow-hidden">
          <Spotlight className="-top-40 -left-10 md:-left-32 md:-top-20 h-screen" fill="rgba(37,99,235,0.2)" />
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center relative z-10">
            <Reveal className="space-y-8">
              <div className="space-y-5">
                <Badge className="rounded-full border border-shakti-300/30 bg-shakti-100/80 px-4 py-1 text-[11px] uppercase tracking-[0.22em] text-shakti-700 dark:border-shakti-400/20 dark:bg-shakti-500/10 dark:text-shakti-200">
                  Gujarat Police Digital Investigation Stack
                </Badge>
                <div className="space-y-4">
                  <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl">
                    <TextGenerateEffect words="A sharper command surface for" duration={0.6} />
                    <FlipWords words={["telecom investigations.", "digital forensics.", "data synthesis.", "case intelligence."]} className="text-shakti-600 dark:text-shakti-400" />
                  </h1>
                  <p className="max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
                    <ColourfulText text="SHAKTI SAHAYATA" className="font-semibold" /> brings case operations, telecom analytics, AI-guided summaries, and
                    secure internal workflows into one refined police-grade interface.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-4 sm:flex-row">
                <Button asChild size="lg" className="h-12 rounded-2xl px-7 text-base">
                  <Link to="/signup">
                    Launch Secure Workspace
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-12 rounded-2xl border-shakti-300/50 bg-white px-7 text-base dark:bg-white/5">
                  <Link to="/login">Sign In As Officer</Link>
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {securitySignals.map((signal, index) => (
                  <Reveal key={signal} delayMs={index * 70}>
                    <div className="glass-card-hover flex items-center gap-3 px-4 py-3">
                      <BadgeCheck className="h-5 w-5 text-shakti-600 dark:text-shakti-300" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{signal}</span>
                    </div>
                  </Reveal>
                ))}
              </div>

              <div className="grid gap-4 rounded-[1.75rem] border border-slate-200/80 bg-white p-5 shadow-sm sm:grid-cols-3 dark:border-slate-800 dark:bg-[#111c38]">
                {[
                  ['Case-first AI', 'No generic chat fallback'],
                  ['Telecom stack', 'CDR, SDR, Tower, IPDR, ILD'],
                  ['Internal readiness', 'Repeatable testing + health checks'],
                ].map(([label, value]) => (
                  <div key={label} className="space-y-1">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">{label}</div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</div>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal delayMs={120}>
              <div className="relative">
                <div className="absolute inset-0 -z-10 rounded-[2rem] bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.22),transparent_55%)] blur-3xl" />
                <Card className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white text-slate-900 shadow-[0_24px_60px_rgba(15,23,42,0.08)] transition-colors dark:border-white/10 dark:bg-surface-950 dark:text-slate-100 dark:shadow-[0_28px_80px_rgba(6,11,26,0.45)]">
                  <CardHeader className="border-b border-slate-200/80 bg-white pb-5 dark:border-white/10 dark:bg-surface-950">
                    <div className="flex items-start justify-between gap-4">
                      <BrandMark tone={isDarkMode ? 'inverse' : 'default'} />
                      <Badge className="rounded-full border border-shakti-200 bg-shakti-100 text-shakti-700 dark:border-blue-400/25 dark:bg-blue-400/10 dark:text-blue-200">
                        Internal Beta
                      </Badge>
                    </div>
                    <CardTitle className="pt-4 text-2xl text-slate-900 dark:text-white">Mission-ready investigation cockpit</CardTitle>
                    <CardDescription className="max-w-lg text-slate-600 dark:text-slate-300">
                      Built for case-centric telecom work, evidence visibility, and disciplined AI support instead of generic chat behavior.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5 p-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {[
                        { label: 'AI posture', value: 'Case-bound + guarded', icon: Sparkles },
                        { label: 'Runtime', value: 'Local Ollama on officer hardware', icon: Globe2 },
                        { label: 'Case flow', value: 'Create • Upload • Analyze • Ask', icon: UploadCloud },
                        { label: 'Module path', value: 'CDR • SDR • Tower • Timeline', icon: Waypoints },
                      ].map(({ label, value, icon: Icon }) => (
                        <div key={label} className="rounded-2xl border border-slate-200/80 bg-slate-50/90 p-4 hover-lift dark:border-white/10 dark:bg-white/5">
                          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-shakti-100 text-shakti-700 dark:bg-blue-400/10 dark:text-blue-200">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{label}</div>
                          <div className="mt-2 text-sm font-medium text-slate-900 dark:text-white">{value}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="capabilities" className="px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Reveal className="mb-12 max-w-3xl">
              <Badge className="mb-4 rounded-full border border-shakti-200 bg-white/70 px-4 py-1 text-[11px] uppercase tracking-[0.22em] text-shakti-700 dark:border-white/10 dark:bg-white/5 dark:text-shakti-200">
                Capability Grid
              </Badge>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">One visual language for every investigation surface.</h2>
              <p className="mt-4 text-lg leading-8 text-slate-600 dark:text-slate-300">
                This refresh brings stronger hierarchy, richer hover states, consistent cards, and motion that makes navigation feel deliberate instead of flat.
              </p>
            </Reveal>

            <HoverEffect 
              items={capabilities.map(cap => ({
                title: cap.title,
                description: cap.description,
                icon: <cap.icon className="h-6 w-6" />
              }))} 
            />
          </div>
        </section>

        <section id="workflow" className="px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <Reveal className="space-y-5">
              <Badge className="rounded-full border border-shakti-300/30 bg-shakti-100/80 px-4 py-1 text-[11px] uppercase tracking-[0.22em] text-shakti-700 dark:border-shakti-400/20 dark:bg-shakti-500/10 dark:text-shakti-200">
                Operational Journey
              </Badge>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Designed to feel more like a command center than a form application.</h2>
              <p className="text-lg leading-8 text-slate-600 dark:text-slate-300">
                Each step now carries more visual state, more confidence, and clearer transitions between login, case work, and AI-supported analysis.
              </p>
            </Reveal>

            <div className="space-y-4">
              <TracingBeam>
                <div className="space-y-12 pl-6">
                  {journey.map((step, index) => (
                    <Reveal key={step.title} delayMs={index * 80}>
                      <Card className="glass-card-hover rounded-[1.5rem]">
                        <CardContent className="flex gap-4 p-5 sm:p-6">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-shakti-300/30 bg-shakti-100/80 text-lg font-semibold text-shakti-700 dark:border-shakti-400/20 dark:bg-shakti-500/10 dark:text-shakti-200">
                            {String(index + 1).padStart(2, '0')}
                          </div>
                          <div>
                            <div className="text-lg font-semibold">{step.title}</div>
                            <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{step.description}</p>
                          </div>
                        </CardContent>
                      </Card>
                    </Reveal>
                  ))}
                </div>
              </TracingBeam>
            </div>
          </div>
        </section>

        <section id="readiness" className="px-4 pb-24 sm:px-6 lg:px-8 text-center pt-10">
          <LampContainer>
            <motion.h1
              initial={{ opacity: 0.5, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.3,
                duration: 0.8,
                ease: "easeInOut",
              }}
              className="mt-8 bg-gradient-to-br from-slate-900 to-slate-600 py-4 bg-clip-text text-center text-4xl font-medium tracking-tight text-transparent dark:from-slate-200 dark:to-slate-500 md:text-5xl"
            >
              Bring investigation data, case context, <br /> and AI guidance into one secure workspace.
            </motion.h1>
          </LampContainer>
          <div className="mx-auto max-w-3xl -mt-32 relative z-10">
            <Reveal>
              <Card className="overflow-hidden rounded-[2rem] border-white/10 bg-[linear-gradient(135deg,#102257_0%,#1c3f9e_55%,#0b1229_100%)] text-white shadow-[0_32px_80px_rgba(10,19,51,0.38)]">
                <CardContent className="grid gap-8 p-8 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div>
                    <div className="text-xs uppercase tracking-[0.28em] text-blue-200">Ready for internal use</div>
                    <h3 className="mt-3 text-3xl font-semibold">Bring investigation data, case context, and AI guidance into one secure workspace.</h3>
                    <p className="mt-4 max-w-2xl text-base leading-8 text-slate-200">
                      The refreshed experience now gives SHAKTI a proper police operations identity: clearer navigation, stronger state feedback, and a more premium command-center feel.
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                    <Button asChild size="lg" className="h-12 rounded-2xl bg-white text-shakti-800 hover:bg-blue-50">
                      <Link to="/signup">Create Officer Account</Link>
                    </Button>
                    <Button asChild variant="secondary" size="lg" className="h-12 rounded-2xl border-white/15 bg-white/10 text-white hover:bg-white/15">
                      <Link to="/login">Enter Workspace</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-background/80 px-4 py-8 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-8">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
            <div className="space-y-4">
              <BrandMark compact />
              <p className="max-w-md text-sm leading-7 text-slate-500 dark:text-slate-400">
                Police-grade telecom investigation platform for internal use, guarded AI workflows, and case-centric evidence analysis.
              </p>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Platform</div>
              <div className="mt-4 flex flex-col gap-2 text-sm">
                <a href="#capabilities" className="text-slate-600 transition-colors hover:text-shakti-700 dark:text-slate-300 dark:hover:text-shakti-300">Capabilities</a>
                <a href="#workflow" className="text-slate-600 transition-colors hover:text-shakti-700 dark:text-slate-300 dark:hover:text-shakti-300">Workflow</a>
                <a href="#readiness" className="text-slate-600 transition-colors hover:text-shakti-700 dark:text-slate-300 dark:hover:text-shakti-300">Readiness</a>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Access</div>
              <div className="mt-4 flex flex-col gap-2 text-sm">
                <Link to="/login" className="text-slate-600 transition-colors hover:text-shakti-700 dark:text-slate-300 dark:hover:text-shakti-300">Officer Login</Link>
                <Link to="/signup" className="text-slate-600 transition-colors hover:text-shakti-700 dark:text-slate-300 dark:hover:text-shakti-300">Create Account</Link>
              </div>
            </div>
          </div>

          <Separator className="bg-border/70" />

          <div className="flex flex-col gap-3 text-sm text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 SHAKTI SAHAYATA • Government Investigation Interface</p>
            <p>Case-bound analysis • Internal beta workflow • Gujarat Police aligned UI</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
