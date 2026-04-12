import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import GroundedAnswerCard, { type ChatAnswerPayload } from './GroundedAnswerCard'

const buildBasePayload = (): ChatAnswerPayload => ({
  version: 'grounded-answer-v1',
  kind: 'record_preview',
  title: 'International Calls',
  subtitle: 'CDR • advanced',
  shortAnswer: '**Found results**\n\n1. First row\n2. Second row',
  scope: {
    caseId: '41',
    caseLabel: 'Test Case',
    module: 'cdr',
    moduleLabel: 'CDR',
    view: 'advanced',
    scopeMode: 'workspace',
    broadenedFromWorkspace: false,
  },
  sources: [
    {
      sourceType: 'live_records',
      tables: ['cdr_records'],
      cacheStatus: 'miss',
    },
  ],
  evidence: [
    {
      type: 'records',
      columns: [
        { key: 'number', label: 'Number' },
        { key: 'count', label: 'Count' },
      ],
      previewRows: [
        { number: '1111111111', count: '4' },
      ],
      rows: [
        { number: '1111111111', count: '4' },
        { number: '2222222222', count: '2' },
      ],
      totalCount: 25,
    },
  ],
  actions: [
    { id: 'show-evidence', label: 'Show evidence', kind: 'toggle_evidence' },
  ],
  followUps: [],
  emptyState: null,
  clarificationOptions: [],
  debugMeta: {
    tables: ['cdr_records'],
  },
})

describe('GroundedAnswerCard', () => {
  it('renders rich shortAnswer formatting inside grounded cards', () => {
    render(<GroundedAnswerCard payload={buildBasePayload()} dark={false} />)

    expect(screen.getByText('Found results')).toBeInTheDocument()
    expect(screen.getByText('First row')).toBeInTheDocument()
    expect(screen.getByText('Second row')).toBeInTheDocument()
  })

  it('expands evidence rows locally when "Show 50" is clicked', () => {
    render(<GroundedAnswerCard payload={buildBasePayload()} dark={false} />)

    fireEvent.click(screen.getAllByRole('button', { name: /show evidence/i })[0])
    expect(screen.getByText('1111111111')).toBeInTheDocument()
    expect(screen.queryByText('2222222222')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show 50/i }))
    expect(screen.getByText('2222222222')).toBeInTheDocument()
  })

  it('forwards clarification option clicks to the action handler', () => {
    const onAction = vi.fn()
    const payload: ChatAnswerPayload = {
      ...buildBasePayload(),
      kind: 'clarification',
      title: 'Clarify Scope',
      shortAnswer: 'Choose a grounded module.',
      clarificationOptions: [
        {
          id: 'ipdr',
          label: 'IPDR module',
          description: 'Answer from the IPDR module',
          prompt: 'same for IPDR',
        },
      ],
    }

    render(<GroundedAnswerCard payload={payload} dark={false} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: /ipdr module/i }))

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'same for IPDR' }))
  })
})
