import { SparklesCore } from '@/components/ui/aceternity/sparkles'
import { Skeleton } from '@/components/ui/skeleton'

export default function RouteLoadingShell({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-background px-6 text-foreground flex items-center justify-center">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-[2rem] border border-border/70 bg-card/90 p-8 shadow-[0_28px_80px_rgba(10,19,51,0.14)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 [mask-image:linear-gradient(to_bottom,white,transparent)]">
          <SparklesCore
            background="transparent"
            minSize={0.4}
            maxSize={1}
            particleDensity={35}
            className="h-full w-full"
            particleColor="#3f67f2"
          />
        </div>

        <div className="relative z-10 space-y-6">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-shakti-500/10 text-shakti-700 dark:text-shakti-300">
              <div className="h-8 w-8 rounded-2xl bg-gradient-to-br from-shakti-500 to-blue-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase tracking-[0.24em] text-blue-700 dark:text-blue-300">
                SHAKTI SAHAYATA
              </div>
              <div className="mt-2 text-2xl font-black">{label}</div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Preparing the requested module with upgraded loading states and preserved case context.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-24 rounded-[1.5rem]" />
            <Skeleton className="h-24 rounded-[1.5rem]" />
            <Skeleton className="h-24 rounded-[1.5rem]" />
          </div>

          <div className="space-y-3 rounded-[1.5rem] border border-border/70 bg-background/50 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-[1.5rem]" />
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-600 dark:bg-blue-400" />
          </div>
        </div>
      </div>
    </div>
  )
}
