type PerformanceDetail = Record<string, unknown>

const isPerformanceAvailable = () =>
  typeof window !== 'undefined' && typeof window.performance !== 'undefined'

const safeConsoleDebug = (message: string, detail?: PerformanceDetail) => {
  try {
    if (detail) {
      console.debug(message, detail)
      return
    }
    console.debug(message)
  } catch {
    // Ignore instrumentation failures.
  }
}

export const markPerformanceEvent = (name: string, detail: PerformanceDetail = {}) => {
  safeConsoleDebug(`[perf] ${name}`, detail)
}

export const startPerformanceSpan = (name: string, detail: PerformanceDetail = {}) => {
  const markerId = `${name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const startMark = `${markerId}:start`
  const endMark = `${markerId}:end`
  const startedAt = isPerformanceAvailable() ? window.performance.now() : Date.now()

  if (isPerformanceAvailable()) {
    window.performance.mark(startMark)
  }
  safeConsoleDebug(`[perf] ${name}:start`, detail)

  return (extra: PerformanceDetail = {}) => {
    const durationMs = isPerformanceAvailable()
      ? window.performance.now() - startedAt
      : Date.now() - startedAt

    if (isPerformanceAvailable()) {
      window.performance.mark(endMark)
      try {
        window.performance.measure(name, startMark, endMark)
      } catch {
        // Ignore duplicate mark/measure issues.
      }
      window.performance.clearMarks(startMark)
      window.performance.clearMarks(endMark)
      window.performance.clearMeasures(name)
    }

    safeConsoleDebug(`[perf] ${name}:end`, {
      ...detail,
      ...extra,
      durationMs: Number(durationMs.toFixed(1)),
    })
  }
}

export const trackPerformanceAsync = async <T>(
  name: string,
  work: () => Promise<T>,
  detail: PerformanceDetail = {},
) => {
  const finish = startPerformanceSpan(name, detail)
  try {
    const result = await work()
    finish({ status: 'ok' })
    return result
  } catch (error) {
    finish({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
