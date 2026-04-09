import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { resolveBackendBaseUrl } from '../../lib/apiClient'
import { adminApiClient, getAdminAccessToken } from '../lib/adminApiClient'
import { useAdminAuthStore } from '../store/adminAuthStore'

type AdminLiveStatus = 'connecting' | 'connected' | 'reconnecting'

type AdminLiveUpdatesContextValue = {
  status: AdminLiveStatus
  streamEnabled: boolean
  isConnected: boolean
}

const AdminLiveUpdatesContext = createContext<AdminLiveUpdatesContextValue>({
  status: 'connecting',
  streamEnabled: true,
  isConnected: false,
})

const STREAM_URL = `${resolveBackendBaseUrl()}/api/admin/stream`

const invalidateMap = {
  'dashboard.summary.changed': [
    ['admin-observatory'],
    ['admin-dashboard-cases'],
    ['admin-dashboard-files'],
    ['admin-dashboard-activity'],
    ['admin-dashboard-analysis'],
  ],
  'alerts.changed': [['admin-alerts'], ['ops-alerts'], ['admin-observatory']],
  'ingestion.queue.changed': [['ops-ingestion'], ['admin-dashboard-files'], ['admin-observatory']],
  'normalization.queue.changed': [['ops-normalization'], ['admin-dashboard-analysis'], ['admin-observatory']],
  'sessions.changed': [['ops-users'], ['ops-sessions'], ['admin-observatory']],
  'storage.changed': [['ops-storage-workspace'], ['ops-storage-asset']],
  'logs.changed': [['ops-logs'], ['admin-dashboard-activity'], ['ops-audit'], ['ops-audit-trail']],
} as const

function parseSseChunk(chunk: string) {
  let eventName = 'message'
  const dataLines: string[] = []

  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }

  if (!dataLines.length) return null

  try {
    return {
      event: eventName,
      data: JSON.parse(dataLines.join('\n')) as Record<string, unknown>,
    }
  } catch {
    return {
      event: eventName,
      data: {},
    }
  }
}

export function AdminLiveUpdatesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { authStatus } = useAdminAuthStore()
  const [status, setStatus] = useState<AdminLiveStatus>('connecting')

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      setStatus('connecting')
      return
    }

    let cancelled = false
    let retryHandle: ReturnType<typeof setTimeout> | null = null
    let abortController: AbortController | null = null

    const invalidateForEvent = async (eventName: string) => {
      const queryKeys = invalidateMap[eventName as keyof typeof invalidateMap] || []
      await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
    }

    const connect = async (attempt = 0) => {
      if (cancelled) return
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting')

      const token = getAdminAccessToken()
      if (!token) {
        retryHandle = setTimeout(() => {
          void connect(attempt + 1)
        }, 3000)
        return
      }

      abortController = new AbortController()

      try {
        let response = await fetch(STREAM_URL, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          signal: abortController.signal,
        })

        if (response.status === 401) {
          const refreshed = await adminApiClient.refreshAccessToken(false)
          if (!refreshed) {
            throw new Error('Admin event stream authentication failed.')
          }

          response = await fetch(STREAM_URL, {
            method: 'GET',
            credentials: 'include',
            headers: {
              Authorization: `Bearer ${getAdminAccessToken()}`,
              Accept: 'text/event-stream',
            },
            signal: abortController.signal,
          })
        }

        if (!response.ok || !response.body) {
          throw new Error(`Event stream failed with status ${response.status}`)
        }

        setStatus('connected')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (!cancelled) {
          const { value, done } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() || ''

          for (const frame of frames) {
            const parsed = parseSseChunk(frame.trim())
            if (!parsed || parsed.event.startsWith('stream.')) continue
            await invalidateForEvent(parsed.event)
          }
        }

        if (!cancelled) {
          throw new Error('Admin event stream closed unexpectedly.')
        }
      } catch {
        if (cancelled) return
        setStatus('reconnecting')
        retryHandle = setTimeout(() => {
          void connect(attempt + 1)
        }, Math.min(10000, 3000 + attempt * 1000))
      }
    }

    void connect()

    return () => {
      cancelled = true
      if (retryHandle) clearTimeout(retryHandle)
      abortController?.abort()
    }
  }, [authStatus, queryClient])

  const value = useMemo<AdminLiveUpdatesContextValue>(
    () => ({
      status,
      streamEnabled: true,
      isConnected: status === 'connected',
    }),
    [status],
  )

  return <AdminLiveUpdatesContext.Provider value={value}>{children}</AdminLiveUpdatesContext.Provider>
}

export function useAdminLiveUpdates() {
  return useContext(AdminLiveUpdatesContext)
}
