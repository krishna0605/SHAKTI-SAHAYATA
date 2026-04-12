export type CaseQaCatalogEntry = {
  key: string
  displayLabel: string
  modules: string[]
  views: string[]
  uiLabels: string[]
  aliases: string[]
  factKeys: string[]
  answerType: string
  renderer: string
  evidenceColumns: Array<{ key: string; label: string; format?: string }>
  followUpExamples: string[]
  queryMode?: string
  emptyState?: string
}

export function getCaseQaCatalog(): CaseQaCatalogEntry[]
export function getCaseQaCatalogEntry(key: string): CaseQaCatalogEntry | null
export function getCaseQaCatalogEntriesByModule(moduleKey: string): CaseQaCatalogEntry[]
export function getMetricLabel(metricKey: string): string | null
export function buildMetricLabelMap(): Record<string, string>
export function getModuleLabel(moduleKey: string): string
export function classifyGroundability(message: string, options?: Record<string, unknown>): {
  groundable: boolean
  bucket: string | null
  confidence: number
}
export function isGroundableCaseQuestionText(message: string, options?: Record<string, unknown>): boolean
export function findCaseQaCatalogEntries(args: {
  message: string
  module?: string | null
  view?: string | null
}): CaseQaCatalogEntry[]
