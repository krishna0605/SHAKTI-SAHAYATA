import { create } from 'zustand'

const STORAGE_KEY = 'shakti_active_case'

export interface ActiveCaseContext {
  id: string
  caseName: string
  caseNumber?: string | null
  firNumber?: string | null
  caseType?: string | null
  operator?: string | null
  status?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  hasFiles?: boolean
  availability?: {
    files?: boolean
    cdr?: boolean
    ipdr?: boolean
    sdr?: boolean
    tower?: boolean
    ild?: boolean
    timeline?: boolean
  } | null
  locked?: boolean
}

interface CaseContextState {
  activeCase: ActiveCaseContext | null
  setActiveCase: (value: ActiveCaseContext) => void
  clearActiveCase: () => void
}

const readStoredCase = (): ActiveCaseContext | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.id || !parsed?.caseName) return null
    return parsed
  } catch {
    return null
  }
}

export const useCaseContextStore = create<CaseContextState>((set) => ({
  activeCase: readStoredCase(),
  setActiveCase: (value) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    set({ activeCase: value })
  },
  clearActiveCase: () => {
    localStorage.removeItem(STORAGE_KEY)
    set({ activeCase: null })
  }
}))
