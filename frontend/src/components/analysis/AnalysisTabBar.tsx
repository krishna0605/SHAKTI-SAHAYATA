import type { LucideIcon } from 'lucide-react'
import { BarChart3, BrainCircuit, LayoutDashboard, MapPinned, Network, Share2, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type IconName = 'overview' | 'records' | 'analysis' | 'advanced' | 'map' | 'charts' | 'graph' | 'party_graph'

interface AnalysisTabItem<T extends string> {
  id: T
  label: string
  icon?: LucideIcon | IconName
}

interface AnalysisTabBarProps<T extends string> {
  tabs: AnalysisTabItem<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

const iconMap: Record<IconName, LucideIcon> = {
  overview: LayoutDashboard,
  records: Table2,
  analysis: BrainCircuit,
  advanced: BrainCircuit,
  map: MapPinned,
  charts: BarChart3,
  graph: Network,
  party_graph: Share2,
}

function isIconName(icon: LucideIcon | IconName): icon is IconName {
  return typeof icon === 'string'
}

function resolveIcon(icon?: LucideIcon | IconName) {
  if (!icon) return null
  return isIconName(icon) ? iconMap[icon] : icon
}

export function AnalysisTabBar<T extends string>({ tabs, value, onChange, className }: AnalysisTabBarProps<T>) {
  return (
    <div className={cn('border-b border-slate-200/80 bg-transparent px-4 sm:px-6 dark:border-slate-800', className)}>
      <div className="custom-scrollbar flex min-w-max gap-2 overflow-x-auto py-3">
        {tabs.map((tab) => {
          const Icon = resolveIcon(tab.icon)
          const active = value === tab.id

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              aria-pressed={active}
              className={cn(
                'inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-all duration-200',
                active
                  ? 'border-shakti-300 bg-shakti-50 text-shakti-700 shadow-sm dark:border-shakti-400/20 dark:bg-shakti-500/10 dark:text-shakti-200'
                  : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-[#111a31] dark:hover:text-white'
              )}
            >
              {Icon ? <Icon className="h-4 w-4" /> : null}
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
