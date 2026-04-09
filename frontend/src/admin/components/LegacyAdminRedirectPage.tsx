import { useEffect, useMemo } from 'react'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { buildAdminAppUrl, mapLegacyAdminPath, stripLegacyAdminPrefix } from '../lib/paths'
import { Button } from '@/components/ui/button'

export default function LegacyAdminRedirectPage() {
  const location = useLocation()

  const targetUrl = useMemo(() => {
    const legacyPath = stripLegacyAdminPrefix(location.pathname)
    const pathname = mapLegacyAdminPath(location.pathname)
    const shouldCarrySearch = pathname === legacyPath
    return buildAdminAppUrl(pathname, shouldCarrySearch ? location.search : '', location.hash)
  }, [location.hash, location.pathname, location.search])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.location.replace(targetUrl)
  }, [targetUrl])

  return (
    <div className="min-h-screen bg-background px-4 flex items-center justify-center">
      <div className="glass-card w-full max-w-xl rounded-[2rem] px-8 py-10 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-slate-900 text-white dark:bg-white dark:text-slate-900">
          <ShieldCheck className="h-8 w-8" />
        </div>
        <div className="mt-6 text-2xl font-semibold">Admin console moved to its own origin</div>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          Redirecting you to the dedicated admin frontend so the console can run independently from the officer application.
        </p>
        <Button asChild className="mt-6 rounded-2xl">
          <a href={targetUrl}>
            Open admin console
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
        <div className="mt-3 text-xs text-muted-foreground break-all">{targetUrl}</div>
      </div>
    </div>
  )
}
