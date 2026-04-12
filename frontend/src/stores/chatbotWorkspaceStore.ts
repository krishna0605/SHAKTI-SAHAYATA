import { create } from 'zustand'

export interface ChatbotWorkspaceContext {
  caseId: string | null
  caseTag?: string | null
  module: string | null
  view: string | null
  subview?: string | null
  selectedFileIds: number[]
  selectedFileKeys?: string[]
  selectedFileNames?: string[]
  filters?: Record<string, string | number | boolean | null> | null
  searchState?: Record<string, unknown> | null
  selectedEntities?: string[]
  mapState?: Record<string, unknown> | null
  graphState?: Record<string, unknown> | null
  selectionTimestamp: string
}

export interface ChatbotWorkspaceContextInput {
  caseId?: string | number | null
  caseTag?: string | null
  module?: string | null
  view?: string | null
  subview?: string | null
  selectedFileIds?: Array<string | number>
  selectedFileKeys?: string[]
  selectedFileNames?: string[]
  filters?: Record<string, unknown> | null
  searchState?: Record<string, unknown> | null
  selectedEntities?: string[]
  mapState?: Record<string, unknown> | null
  graphState?: Record<string, unknown> | null
  selectionTimestamp?: string
}

interface ChatbotWorkspaceState {
  workspaceContext: ChatbotWorkspaceContext | null
  setWorkspaceContext: (value: ChatbotWorkspaceContextInput | null) => void
  clearWorkspaceContext: () => void
}

const normalizeNumberArray = (values: unknown): number[] => {
  if (!Array.isArray(values)) return []
  return [...new Set(values
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value) && value > 0))]
}

const normalizeTextArray = (values: unknown): string[] => {
  if (!Array.isArray(values)) return []
  return [...new Set(values
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
}

const normalizeObject = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const normalizeFilters = (value: unknown): Record<string, string | number | boolean | null> | null => {
  const objectValue = normalizeObject(value)
  if (!objectValue) return null

  const entries = Object.entries(objectValue)
    .filter(([, rawValue]) => rawValue === null || ['string', 'number', 'boolean'].includes(typeof rawValue))
    .map(([key, rawValue]) => [key, rawValue as string | number | boolean | null])

  return entries.length > 0 ? Object.fromEntries(entries) : null
}

export const normalizeChatbotWorkspaceContext = (value: ChatbotWorkspaceContextInput | null): ChatbotWorkspaceContext | null => {
  const input = normalizeObject(value)
  if (!input) return null

  const caseId = String(input.caseId || '').trim()
  const module = String(input.module || '').trim()
  const view = String(input.view || '').trim()

  if (!caseId || !module || !view) return null

  return {
    caseId,
    caseTag: String(input.caseTag || '').trim() || null,
    module,
    view,
    subview: String(input.subview || '').trim() || null,
    selectedFileIds: normalizeNumberArray(input.selectedFileIds),
    selectedFileKeys: normalizeTextArray(input.selectedFileKeys),
    selectedFileNames: normalizeTextArray(input.selectedFileNames),
    filters: normalizeFilters(input.filters),
    searchState: normalizeObject(input.searchState),
    selectedEntities: normalizeTextArray(input.selectedEntities),
    mapState: normalizeObject(input.mapState),
    graphState: normalizeObject(input.graphState),
    selectionTimestamp: String(input.selectionTimestamp || new Date().toISOString()),
  }
}

export const useChatbotWorkspaceStore = create<ChatbotWorkspaceState>((set) => ({
  workspaceContext: null,
  setWorkspaceContext: (value) => {
    set({ workspaceContext: normalizeChatbotWorkspaceContext(value) })
  },
  clearWorkspaceContext: () => {
    set({ workspaceContext: null })
  },
}))
