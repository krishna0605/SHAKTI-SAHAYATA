import React, { useMemo, useState } from 'react'
import { renderRichMessage } from './chatRichText'

export type GroundedAnswerAction = {
  id: string
  label: string
  kind: 'toggle_evidence' | 'prompt' | 'copy' | 'navigate' | 'open_records'
  prompt?: string
  href?: string
}

export type ClarificationOption = {
  id: string
  label: string
  description?: string | null
  prompt?: string | null
}

export type EvidenceColumn = {
  key: string
  label: string
}

export type EvidenceBlock = {
  type: 'list' | 'table' | 'records' | 'timeline' | 'timeseries' | 'chart'
  items?: string[]
  columns?: EvidenceColumn[]
  previewRows?: Array<Record<string, string>>
  rows?: Array<Record<string, string>>
  totalCount?: number
  chartType?: 'bar' | 'line'
  chartData?: Array<Record<string, unknown>>
  chartXKey?: string
  chartYKey?: string
  chartTitle?: string
}

export type GroundingSource = {
  sourceType: 'memory' | 'snapshot' | 'live_aggregate' | 'live_records'
  tables: string[]
  cacheStatus?: string | null
  generatedAt?: string | null
  fileIds?: number[]
}

export type ScopeDescriptor = {
  caseId: string
  caseLabel?: string | null
  scopeOrigin?: string | null
  scopeMode?: string | null
  module?: string | null
  moduleLabel?: string | null
  view?: string | null
  selectedFileIds?: number[]
  selectedFileNames?: string[]
  filtersApplied?: Record<string, string | number | boolean | null> | null
  searchQuery?: string | null
  selectedEntities?: string[]
  broadenedFromWorkspace?: boolean
}

export type ChatAnswerPayload = {
  version: string
  kind: string
  title: string
  subtitle?: string | null
  shortAnswer?: string | null
  scope?: ScopeDescriptor | null
  sources?: GroundingSource[]
  evidence?: EvidenceBlock[]
  actions?: GroundedAnswerAction[]
  followUps?: string[]
  emptyState?: string | null
  clarificationOptions?: ClarificationOption[]
  debugMeta?: Record<string, unknown>
}

type GroundedAnswerCardProps = {
  payload: ChatAnswerPayload
  dark: boolean
  onAction?: (action: GroundedAnswerAction | ClarificationOption) => void
}

const chipClass = (dark: boolean) =>
  dark
    ? 'border border-white/10 bg-slate-950/60 text-slate-300'
    : 'border border-slate-200 bg-slate-50 text-slate-600'

const buttonClass = (dark: boolean) =>
  dark
    ? 'border border-white/10 bg-slate-900/80 text-slate-100 hover:bg-slate-800'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'

const labelize = (value: string) =>
  value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())

const renderSourceType = (sourceType: GroundingSource['sourceType']) => {
  if (sourceType === 'live_aggregate') return 'Live Aggregate'
  if (sourceType === 'live_records') return 'Scoped Records'
  if (sourceType === 'snapshot') return 'Snapshot'
  return 'Memory'
}

type EvidenceRowProps = {
  row: Record<string, string>
  columns: EvidenceColumn[]
  dark: boolean
  rowIndex: number
  title: string
}

const EvidenceRow: React.FC<EvidenceRowProps> = ({ row, columns, dark, rowIndex, title }) => {
  const [expanded, setExpanded] = useState(false)
  const columnKeys = new Set(columns.map((c) => c.key))
  const extraFields = Object.entries(row).filter(([key]) => !columnKeys.has(key) && key !== '_id')
  const hasExtras = extraFields.length > 0

  return (
    <>
      <tr
        className={hasExtras ? 'cursor-pointer' : ''}
        onClick={hasExtras ? () => setExpanded((prev) => !prev) : undefined}
      >
        {columns.map((column) => (
          <td key={`${title}-${rowIndex}-${column.key}`}>
            {row[column.key] ?? '-'}
            {hasExtras && column === columns[0] ? (
              <span className={`inline-block ml-1 text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                {expanded ? '▼' : '▶'}
              </span>
            ) : null}
          </td>
        ))}
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={columns.length} className={`px-3 py-2 ${dark ? 'bg-slate-950/50' : 'bg-slate-50'}`}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {extraFields.map(([key, value]) => (
                <React.Fragment key={`extra-${rowIndex}-${key}`}>
                  <span className={`font-medium ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{labelize(key)}</span>
                  <span>{value}</span>
                </React.Fragment>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}
export const GroundedAnswerCard: React.FC<GroundedAnswerCardProps> = ({ payload, dark, onAction }) => {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [showAllEvidence, setShowAllEvidence] = useState(false)

  const visibleEvidence = useMemo(() => Array.isArray(payload.evidence) ? payload.evidence : [], [payload.evidence])
  const scope = payload.scope || null
  const source = Array.isArray(payload.sources) && payload.sources.length > 0 ? payload.sources[0] : null
  const debugTables = Array.isArray(payload.debugMeta?.tables)
    ? payload.debugMeta.tables.map((table) => String(table))
    : []

  const handleAction = (action: GroundedAnswerAction | ClarificationOption) => {
    if ('kind' in action && action.kind === 'toggle_evidence') {
      setEvidenceOpen((prev) => !prev)
      return
    }
    onAction?.(action)
  }

  return (
    <div className={`mt-1 rounded-2xl border px-4 py-3 ${dark ? 'border-white/10 bg-slate-900/70' : 'border-slate-200 bg-slate-50/80'}`}>
      <div className="flex flex-wrap gap-2 text-[11px]">
        {scope?.caseLabel ? <span className={`rounded-full px-2 py-1 ${chipClass(dark)}`}>Case: {scope.caseLabel}</span> : null}
        {scope?.moduleLabel || scope?.view ? (
          <span className={`rounded-full px-2 py-1 ${chipClass(dark)}`} title={scope?.scopeMode ? `Mode: ${labelize(scope.scopeMode)}` : undefined}>
            Scope: {[scope?.moduleLabel, scope?.view].filter(Boolean).join(' • ')}
          </span>
        ) : null}
        {source ? <span className={`rounded-full px-2 py-1 ${chipClass(dark)}`}>Source: {renderSourceType(source.sourceType)}</span> : null}
        {source?.cacheStatus ? <span className={`rounded-full px-2 py-1 ${chipClass(dark)}`}>Cache: {source.cacheStatus}</span> : null}
      </div>

      {scope?.broadenedFromWorkspace ? (
        <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${dark ? 'bg-blue-950/40 border border-blue-500/20 text-blue-300' : 'bg-blue-50 border border-blue-200 text-blue-700'}`}>
          ⬆ Auto-broadened from current view to entire case.
        </div>
      ) : null}

      <div className="mt-3">
        <div className="text-base font-semibold">{payload.title}</div>
        {payload.subtitle ? <div className={`mt-1 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{payload.subtitle}</div> : null}
      </div>

      <div className="mt-3 space-y-2">
        {payload.shortAnswer ? renderRichMessage(payload.shortAnswer) : null}
        {!payload.shortAnswer && visibleEvidence.length === 0 && payload.emptyState ? <p className="chat-p">{payload.emptyState}</p> : null}
      </div>

      {payload.kind === 'clarification' && Array.isArray(payload.clarificationOptions) && payload.clarificationOptions.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className={`text-[11px] font-semibold uppercase tracking-[0.08em] mb-2 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Choose a scope</div>
          {payload.clarificationOptions.map((option, optIdx) => (
            <button
              key={option.id}
              type="button"
              onClick={() => handleAction(option)}
              className={`w-full rounded-xl px-3 py-3 text-left transition flex items-center gap-3 ${buttonClass(dark)} ${optIdx === 0 ? (dark ? 'ring-1 ring-blue-500/30' : 'ring-1 ring-blue-300') : ''}`}
            >
              <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-bold ${dark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                {optIdx === 0 ? '★' : (optIdx + 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{option.label}</div>
                {option.description ? <div className={`mt-0.5 text-xs truncate ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{option.description}</div> : null}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {visibleEvidence.length > 0 ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setEvidenceOpen((prev) => !prev)}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition ${buttonClass(dark)}`}
          >
            {evidenceOpen ? 'Hide evidence' : 'Show evidence'}
          </button>

          {evidenceOpen ? (
            <div className={`mt-3 rounded-xl border p-3 ${dark ? 'border-white/10 bg-black/10' : 'border-slate-200 bg-white'}`}>
              {visibleEvidence.map((block, blockIndex) => {
                const effectiveRows = showAllEvidence
                  ? (block.rows || block.previewRows || [])
                  : (block.previewRows || block.rows || [])
                return (
                  <div key={`${payload.title}-evidence-${blockIndex}`} className={blockIndex > 0 ? 'mt-4' : ''}>
                    {block.type === 'list' ? (
                      <ol className="chat-ol">
                        {(block.items || []).map((item, itemIndex) => (
                          <li key={`${item}-${itemIndex}`}>{item.replace(/^\d+\.\s*/, '')}</li>
                        ))}
                      </ol>
                    ) : null}

                    {(block.type === 'table' || block.type === 'records' || block.type === 'timeline' || block.type === 'timeseries') && Array.isArray(block.columns) && block.columns.length > 0 ? (
                      <div className="overflow-x-auto">
                        {(block.type === 'timeline' || block.type === 'timeseries') ? (
                          <div className={`mb-2 text-[11px] uppercase tracking-wider font-semibold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                            {block.type === 'timeline' ? 'Timeline' : 'Time Series'}
                          </div>
                        ) : null}
                        <table className="chat-table">
                          <thead>
                            <tr>
                              {block.columns.map((column) => <th key={column.key}>{column.label}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {effectiveRows.map((row, rowIndex) => (
                              <EvidenceRow key={`${payload.title}-row-${rowIndex}`} row={row} columns={block.columns!} dark={dark} rowIndex={rowIndex} title={payload.title} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    {typeof block.totalCount === 'number' ? (
                      <div className={`mt-2 flex items-center justify-between`}>
                        <span className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                          Showing {Math.min(block.totalCount, effectiveRows.length || (block.items || []).length)} of {block.totalCount}
                        </span>
                        {block.totalCount > (effectiveRows.length || (block.items || []).length) ? (
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => setShowAllEvidence(true)}
                              className={`rounded-md px-2 py-1 text-[10px] font-medium ${buttonClass(dark)}`}
                            >
                              Show 50
                            </button>
                            {scope?.module ? (
                              <button
                                type="button"
                                onClick={() => onAction?.({ id: 'open-records', label: 'Open Records', kind: 'open_records', href: `/${scope.module}/records` })}
                                className={`rounded-md px-2 py-1 text-[10px] font-medium ${buttonClass(dark)}`}
                              >
                                Open Records
                              </button>
                            ) : null}
                            {debugTables.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => onAction?.({ id: 'run-sql', label: 'SQL', kind: 'prompt', prompt: `/sql SELECT * FROM ${debugTables[0]} LIMIT 50` })}
                                className={`rounded-md px-2 py-1 text-[10px] font-medium ${buttonClass(dark)}`}
                              >
                                SQL
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {block.type === 'chart' && Array.isArray(block.chartData) && block.chartData.length > 0 ? (
                      <div className={`mt-2 rounded-lg p-3 ${dark ? 'bg-slate-950/50' : 'bg-slate-50'}`}>
                        {block.chartTitle ? <div className={`text-[11px] font-semibold mb-2 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{block.chartTitle}</div> : null}
                        <div className="flex items-end gap-1 h-24">
                          {(() => {
                            const data = block.chartData || []
                            const yKey = block.chartYKey || 'count'
                            const xKey = block.chartXKey || 'label'
                            const maxVal = Math.max(...data.map((d) => Number(d[yKey] || 0)), 1)
                            return data.slice(0, 20).map((d, i) => {
                              const val = Number(d[yKey] || 0)
                              const pct = Math.max(4, (val / maxVal) * 100)
                              return (
                                <div key={`bar-${i}`} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                                  <div
                                    className={`w-full rounded-t-sm transition-all ${dark ? 'bg-blue-500/60' : 'bg-blue-400/70'}`}
                                    style={{ height: `${pct}%` }}
                                    title={`${d[xKey]}: ${val}`}
                                  />
                                  <span className={`text-[8px] truncate w-full text-center ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                                    {String(d[xKey] || '').slice(0, 6)}
                                  </span>
                                </div>
                              )
                            })
                          })()}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {(Array.isArray(payload.actions) && payload.actions.length > 0) || (Array.isArray(payload.followUps) && payload.followUps.length > 0) ? (
        <div className="mt-4 space-y-3">
          {Array.isArray(payload.actions) && payload.actions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {payload.actions.map((action) => {
                const isNav = action.kind === 'navigate' || action.kind === 'open_records'
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => handleAction(action)}
                    className={`rounded-lg px-3 py-2 text-xs font-medium transition flex items-center gap-1.5 ${buttonClass(dark)}`}
                  >
                    {isNav ? <span className="material-symbols-outlined text-[13px]">open_in_new</span> : null}
                    {action.kind === 'toggle_evidence' ? (evidenceOpen ? 'Hide evidence' : action.label) : action.label}
                  </button>
                )
              })}
            </div>
          ) : null}

          {Array.isArray(payload.followUps) && payload.followUps.length > 0 ? (
            <div>
              <div className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Try next</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {payload.followUps.map((followUp) => (
                  <button
                    key={followUp}
                    type="button"
                    onClick={() => onAction?.({ id: followUp, label: followUp, kind: 'prompt', prompt: followUp })}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${dark ? 'border border-blue-400/20 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20' : 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                  >
                    {followUp}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default GroundedAnswerCard
