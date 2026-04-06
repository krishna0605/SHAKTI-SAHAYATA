import type { ReactNode } from 'react'
import { BriefcaseBusiness, FolderKanban, Upload } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { GlowingEffect } from '@/components/ui/aceternity/glowing-effect'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface StatCardsProps {
  totalCases: number
  activeCases: number
  totalFiles: number
}

interface MetricCardProps {
  label: string
  value: number
  icon: ReactNode
  accentClassName: string
  tooltip: string
}

function MetricCard({ label, value, icon, accentClassName, tooltip }: MetricCardProps) {
  return (
    <Card className="glass-card-hover group relative overflow-hidden rounded-[1.5rem]">
      <GlowingEffect className="bg-shakti-500/5 dark:bg-yellow-300/5" />
      <CardContent className="relative p-6 z-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{label}</div>
            <div className="mt-3 text-4xl font-semibold tracking-tight text-foreground">{value}</div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${accentClassName}`}>
                {icon}
              </div>
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  )
}

export default function StatCards({ totalCases, activeCases, totalFiles }: StatCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <MetricCard
        label="Total Cases"
        value={totalCases}
        icon={<BriefcaseBusiness className="h-5 w-5" />}
        accentClassName="bg-shakti-500/10 text-shakti-700 dark:text-yellow-300"
        tooltip="All cases currently available in the workspace."
      />
      <MetricCard
        label="Active Cases"
        value={activeCases}
        icon={<FolderKanban className="h-5 w-5" />}
        accentClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
        tooltip="Cases that are still open or actively under investigation."
      />
      <MetricCard
        label="Files Uploaded"
        value={totalFiles}
        icon={<Upload className="h-5 w-5" />}
        accentClassName="bg-yellow-400/12 text-yellow-700 dark:text-yellow-300"
        tooltip="Telecom and evidence files attached across all cases."
      />
    </div>
  )
}
