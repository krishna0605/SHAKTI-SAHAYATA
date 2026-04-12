import { create } from 'zustand'

export type CaseIngestionTaskStatus =
  | 'queued'
  | 'parsing'
  | 'uploading'
  | 'classifying'
  | 'ingesting'
  | 'enriching'
  | 'completed'
  | 'failed'

export interface CaseIngestionTask {
  id: string
  runId: string
  caseId: string
  slotKey: string
  fileName: string
  status: CaseIngestionTaskStatus
  message: string
  createdAt: string
  updatedAt: string
  insertedRecords?: number
  error?: string | null
}

export interface CaseIngestionRun {
  id: string
  caseId: string
  status: 'running' | 'completed' | 'completed_with_errors' | 'failed'
  totalTasks: number
  createdAt: string
  updatedAt: string
}

interface CaseIngestionState {
  runs: Record<string, CaseIngestionRun>
  tasks: Record<string, CaseIngestionTask>
  startRun: (run: CaseIngestionRun, tasks: CaseIngestionTask[]) => void
  updateTask: (taskId: string, patch: Partial<CaseIngestionTask>) => void
  completeRun: (runId: string, status: CaseIngestionRun['status']) => void
  clearCaseRuns: (caseId: string) => void
  recoverInterruptedRuns: () => void
}

const STORAGE_KEY = 'shakti_case_ingestion_runs'

const readPersistedState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { runs: {}, tasks: {} }
    const parsed = JSON.parse(raw)
    return {
      runs: parsed?.runs && typeof parsed.runs === 'object' ? parsed.runs : {},
      tasks: parsed?.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {},
    }
  } catch {
    return { runs: {}, tasks: {} }
  }
}

const persistState = (state: Pick<CaseIngestionState, 'runs' | 'tasks'>) => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        runs: state.runs,
        tasks: state.tasks,
      })
    )
  } catch {
    // ignore persistence issues
  }
}

const initialState = readPersistedState()

export const useCaseIngestionStore = create<CaseIngestionState>((set) => ({
  runs: initialState.runs,
  tasks: initialState.tasks,

  startRun: (run, tasks) => {
    set((state) => {
      const nextTasks = { ...state.tasks }
      tasks.forEach((task) => {
        nextTasks[task.id] = task
      })
      const nextState = {
        runs: {
          ...state.runs,
          [run.id]: run,
        },
        tasks: nextTasks,
      }
      persistState(nextState)
      return nextState
    })
  },

  updateTask: (taskId, patch) => {
    set((state) => {
      const existing = state.tasks[taskId]
      if (!existing) return state
      const nextState = {
        runs: state.runs,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...existing,
            ...patch,
            updatedAt: patch.updatedAt || new Date().toISOString(),
          },
        },
      }
      persistState(nextState)
      return nextState
    })
  },

  completeRun: (runId, status) => {
    set((state) => {
      const existing = state.runs[runId]
      if (!existing) return state
      const nextState = {
        runs: {
          ...state.runs,
          [runId]: {
            ...existing,
            status,
            updatedAt: new Date().toISOString(),
          },
        },
        tasks: state.tasks,
      }
      persistState(nextState)
      return nextState
    })
  },

  clearCaseRuns: (caseId) => {
    set((state) => {
      const nextRuns = { ...state.runs }
      const nextTasks = { ...state.tasks }

      Object.values(state.runs).forEach((run) => {
        if (run.caseId === caseId) {
          delete nextRuns[run.id]
        }
      })

      Object.values(state.tasks).forEach((task) => {
        if (task.caseId === caseId) {
          delete nextTasks[task.id]
        }
      })

      const nextState = {
        runs: nextRuns,
        tasks: nextTasks,
      }
      persistState(nextState)
      return nextState
    })
  },

  recoverInterruptedRuns: () => {
    const now = new Date().toISOString()
    set((state) => {
      let changed = false
      const nextRuns = { ...state.runs }
      const nextTasks = { ...state.tasks }

      Object.values(nextRuns).forEach((run) => {
        if (run.status !== 'running') return
        changed = true
        nextRuns[run.id] = {
          ...run,
          status: 'completed_with_errors',
          updatedAt: now,
        }
      })

      Object.values(nextTasks).forEach((task) => {
        if (task.status === 'completed' || task.status === 'failed') return
        changed = true
        nextTasks[task.id] = {
          ...task,
          status: 'failed',
          message: task.message || 'Ingestion was interrupted before completion.',
          error: task.error || 'Interrupted',
          updatedAt: now,
        }
      })

      if (!changed) return state

      const nextState = {
        runs: nextRuns,
        tasks: nextTasks,
      }
      persistState(nextState)
      return nextState
    })
  },
}))

if (typeof window !== 'undefined') {
  window.setTimeout(() => {
    useCaseIngestionStore.getState().recoverInterruptedRuns()
  }, 0)
}
