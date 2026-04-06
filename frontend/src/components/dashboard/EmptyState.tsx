import { FolderPlus, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Meteors } from '@/components/ui/aceternity/meteors'

interface EmptyStateProps {
  onCreateCase: () => void
}

export default function EmptyState({ onCreateCase }: EmptyStateProps) {
  return (
    <Card className="glass-card relative overflow-hidden rounded-[2rem]">
      <Meteors number={15} />
      <CardContent className="relative z-10 flex flex-col items-center justify-center px-8 py-16 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-yellow-400/20 to-shakti-500/20 text-shakti-700 dark:text-yellow-300">
          <FolderPlus className="h-10 w-10" />
        </div>
        <Badge className="mt-5 rounded-full border border-yellow-400/25 bg-yellow-400/10 text-yellow-700 dark:text-yellow-300">
          Investigation Workspace
        </Badge>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">No cases yet</h2>
        <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300">
          Start a fresh investigation by creating a case, attaching telecom datasets, and building the operational context SHAKTI uses across analytics and AI guidance.
        </p>
        <Button onClick={onCreateCase} size="lg" className="mt-8 h-12 rounded-2xl px-7 text-base">
          Create New Case
        </Button>
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <ShieldCheck className="h-4 w-4 text-yellow-600 dark:text-yellow-300" />
          Internal testing flow stays local and case-centric.
        </div>
      </CardContent>
    </Card>
  )
}
