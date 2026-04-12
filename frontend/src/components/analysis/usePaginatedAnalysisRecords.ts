import { useEffect, useMemo, useRef, useState } from 'react'
import { markPerformanceEvent, trackPerformanceAsync } from '@/lib/performance'

interface PaginationState {
  page: number
  pageSize: number
  total: number
}

interface UsePaginatedAnalysisRecordsParams<T> {
  enabled: boolean
  moduleKey: string
  page: number
  pageSize: number
  fetchPage: () => Promise<{ data: T[]; pagination: PaginationState }>
  deps?: unknown[]
}

export const usePaginatedAnalysisRecords = <T>({
  enabled,
  moduleKey,
  page,
  pageSize,
  fetchPage,
  deps = [],
}: UsePaginatedAnalysisRecordsParams<T>) => {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState<PaginationState>({
    page,
    pageSize,
    total: 0,
  })
  const firstPageMarkedRef = useRef(false)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await trackPerformanceAsync(
          `${moduleKey}.records.fetch`,
          fetchPage,
          { page, pageSize },
        )

        if (cancelled) return

        setData(Array.isArray(response.data) ? response.data : [])
        setPagination({
          page: Number(response.pagination?.page || page) || page,
          pageSize: Number(response.pagination?.pageSize || pageSize) || pageSize,
          total: Number(response.pagination?.total || 0) || 0,
        })

        if (!firstPageMarkedRef.current && page === 1) {
          firstPageMarkedRef.current = true
          markPerformanceEvent(`${moduleKey}.records.first-page-rendered`, {
            total: Number(response.pagination?.total || 0) || 0,
            pageSize,
          })
        }
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Failed to load records')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [enabled, moduleKey, page, pageSize, fetchPage, ...deps])

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((pagination.total || 0) / Math.max(1, pagination.pageSize || pageSize))),
    [pageSize, pagination.pageSize, pagination.total],
  )

  const showingStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const showingEnd = Math.min(pagination.page * pagination.pageSize, pagination.total)

  return {
    data,
    loading,
    error,
    pagination,
    totalPages,
    showingStart,
    showingEnd,
  }
}
