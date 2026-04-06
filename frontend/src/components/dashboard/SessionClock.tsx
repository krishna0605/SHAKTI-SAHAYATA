import { useEffect, useRef, useState } from 'react'
import { TimerReset } from 'lucide-react'
import { authAPI } from '../lib/apis'
import { useAuthStore } from '../../stores/authStore'

export default function SessionClock() {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(0)
  const session = useAuthStore((state) => state.session)

  useEffect(() => {
    if (session?.startedAt) {
      startRef.current = new Date(session.startedAt).getTime()
      setElapsed(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)))
    } else {
      startRef.current = Date.now()
      setElapsed(0)
    }

    const fetchSession = async () => {
      try {
        const data = await authAPI.getSession()
        if (data.duration_seconds) {
          startRef.current = Date.now() - data.duration_seconds * 1000
          setElapsed(data.duration_seconds)
        }
      } catch {
        // fallback to local timer when session lookup is unavailable
      }
    }

    void fetchSession()

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [session?.startedAt])

  const hours = String(Math.floor(elapsed / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')
  const seconds = String(elapsed % 60).padStart(2, '0')

  return (
    <div className="session-clock">
      <div className="session-clock-meta">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-shakti-200/70 bg-shakti-50 text-shakti-700 dark:border-shakti-500/20 dark:bg-shakti-500/10 dark:text-shakti-300">
          <TimerReset className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <div className="session-clock-label">Secure Session</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Officer workspace is active</div>
        </div>
      </div>
      <div className="session-clock-time">{hours}:{minutes}:{seconds}</div>
      <div className="session-clock-label">Session uptime</div>
    </div>
  )
}
