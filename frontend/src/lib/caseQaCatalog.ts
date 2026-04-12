import {
    getCaseQaCatalog as getSharedCaseQaCatalog,
    getCaseQaCatalogEntry as getSharedCaseQaCatalogEntry,
    getCaseQaCatalogEntriesByModule,
    getMetricLabel as getSharedMetricLabel,
} from '../../../shared/chatbot/caseQaCatalog.js'

export type CaseQaModuleKey = 'cdr' | 'ipdr' | 'sdr' | 'tower' | 'ild'

export type CaseQaViewKey =
    | 'overview'
    | 'advanced'
    | 'records'
    | 'search'
    | 'results'
    | 'map'
    | 'charts'
    | 'location'
    | 'roaming'
    | 'network-graph'
    | 'party-graph'
    | 'detail'

export type CaseQaAnswerType =
    | 'scalar'
    | 'summary'
    | 'table'
    | 'list'
    | 'timeseries'
    | 'record_preview'
    | 'timeline'
    | 'comparison'
    | 'entity_profile'
    | 'abstain'

export type CaseQaRenderer =
    | 'scalar_line'
    | 'summary_bullets'
    | 'table_block'
    | 'list_block'
    | 'timeseries_chart'

export type EvidenceColumnFormat = 'number' | 'duration' | 'bytes' | 'date' | 'text'

export interface CaseQaEvidenceColumn {
    key: string
    label: string
    format?: EvidenceColumnFormat
}

export interface CaseQaCatalogEntry {
    key: string
    displayLabel: string
    modules: CaseQaModuleKey[]
    views: CaseQaViewKey[]
    uiLabels: string[]
    aliases: string[]
    factKeys: string[]
    answerType: CaseQaAnswerType
    renderer: CaseQaRenderer
    evidenceColumns: CaseQaEvidenceColumn[]
    followUpExamples: string[]
    queryMode?: string
    emptyState?: string
}

export const MODULE_LABELS: Record<CaseQaModuleKey, string> = {
    cdr: 'CDR',
    ipdr: 'IPDR',
    sdr: 'SDR',
    tower: 'Tower Dump',
    ild: 'ILD',
}

export const getCaseQaCatalog = (): CaseQaCatalogEntry[] =>
    getSharedCaseQaCatalog() as CaseQaCatalogEntry[]

export const getCaseQaCatalogEntry = (key: string): CaseQaCatalogEntry | null =>
    (getSharedCaseQaCatalogEntry(key) as CaseQaCatalogEntry | null) ?? null

export const getMetricLabel = (metricKey: string): string | null =>
    getSharedMetricLabel(metricKey)

export const getMetricUiLabel = (metricKey: string, fallback: string): string =>
    getMetricLabel(metricKey) || fallback

export const getMetricEntriesForModule = (moduleKey: CaseQaModuleKey): CaseQaCatalogEntry[] =>
    getCaseQaCatalogEntriesByModule(moduleKey) as CaseQaCatalogEntry[]

export const buildMetricLabelMap = (): Record<string, string> =>
    Object.fromEntries(getCaseQaCatalog().map((entry) => [entry.key, entry.displayLabel]))

export const getModuleLabel = (moduleKey: CaseQaModuleKey | string): string =>
    MODULE_LABELS[moduleKey as CaseQaModuleKey] ?? String(moduleKey || '').toUpperCase()
