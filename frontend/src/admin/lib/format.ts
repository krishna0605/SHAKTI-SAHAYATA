export const formatTimestamp = (value?: string | null) => {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

export const formatNumber = (value?: number | null) => new Intl.NumberFormat().format(Number(value || 0))

export const formatBytes = (value?: number | null) => {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  let current = size
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024
    index += 1
  }

  return `${current.toFixed(current >= 100 || index === 0 ? 0 : 1)} ${units[index]}`
}

export const formatDurationSeconds = (value?: number | null) => {
  const seconds = Math.max(Number(value || 0), 0)
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60

  if (minutes === 0) return `${remainder}s`
  if (minutes < 60) return `${minutes}m ${remainder}s`

  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export const normalizeStatusTone = (value?: string | null): 'neutral' | 'success' | 'warning' | 'danger' | 'info' => {
  const status = String(value || '').trim().toLowerCase()
  if (['ready', 'active', 'completed', 'healthy', 'pass', 'connected', 'verified', 'ok', 'open'].includes(status)) return 'success'
  if (['warning', 'degraded', 'queued', 'pending', 'processing', 'stale', 'locked', 'review'].includes(status)) return 'warning'
  if (['failed', 'critical', 'error', 'quarantined', 'rejected', 'mismatched', 'unavailable'].includes(status)) return 'danger'
  if (['info', 'running', 'observed'].includes(status)) return 'info'
  return 'neutral'
}

export const titleCase = (value?: string | null) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
