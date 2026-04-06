import { cn } from '@/lib/utils'
import shaktiTridentLogo from '@/assets/shakti-trident.svg'

interface BrandMarkProps {
  compact?: boolean
  className?: string
  iconClassName?: string
  tone?: 'default' | 'inverse'
}

export function BrandMark({ compact = false, className, iconClassName, tone = 'default' }: BrandMarkProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <img
        src={shaktiTridentLogo}
        alt="SHAKTI trident logo"
        className={cn(
          'w-auto object-contain drop-shadow-[0_12px_26px_rgba(10,19,51,0.18)]',
          compact ? 'h-11' : 'h-14',
          iconClassName
        )}
      />

      <div className="leading-tight">
        <div
          className={cn(
            'font-semibold tracking-[0.22em] uppercase',
            tone === 'inverse' ? 'text-blue-200' : 'text-shakti-700 dark:text-shakti-300',
            compact ? 'text-[11px]' : 'text-xs'
          )}
        >
          Gujarat Police
        </div>
        <div className={cn('font-semibold', tone === 'inverse' ? 'text-white' : 'text-foreground', compact ? 'text-base' : 'text-xl')}>
          SHAKTI SAHAYATA
        </div>
      </div>
    </div>
  )
}
