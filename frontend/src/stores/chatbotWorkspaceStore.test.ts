import { afterEach, describe, expect, it } from 'vitest'
import { normalizeChatbotWorkspaceContext, useChatbotWorkspaceStore } from './chatbotWorkspaceStore'

describe('chatbotWorkspaceStore', () => {
  afterEach(() => {
    useChatbotWorkspaceStore.getState().clearWorkspaceContext()
  })

  it('normalizes valid workspace payloads', () => {
    expect(
      normalizeChatbotWorkspaceContext({
        caseId: '41',
        caseTag: 'T-2026-6174',
        module: 'cdr',
        view: 'overview',
        selectedFileIds: ['29', '29', '30'],
        selectedFileKeys: ['id:29', 'id:30', 'id:29'],
        selectedFileNames: ['vodafone.csv', 'airtel.csv', 'vodafone.csv'],
        filters: { search: '9414', durationMin: 10 },
        searchState: { query: '9414', resultCount: 2 },
        selectedEntities: ['9414397023', '9414397023'],
      })
    ).toMatchObject({
      caseId: '41',
      module: 'cdr',
      view: 'overview',
      selectedFileIds: [29, 30],
      selectedFileKeys: ['id:29', 'id:30'],
      selectedFileNames: ['vodafone.csv', 'airtel.csv'],
      selectedEntities: ['9414397023'],
    })
  })

  it('rejects incomplete workspace payloads', () => {
    expect(
      normalizeChatbotWorkspaceContext({
        caseId: '41',
        module: 'cdr',
      })
    ).toBeNull()
  })

  it('stores and clears the active workspace context', () => {
    useChatbotWorkspaceStore.getState().setWorkspaceContext({
      caseId: '41',
      module: 'ild',
      view: 'records',
      filters: { search: '12345' },
      selectionTimestamp: '2026-04-10T10:00:00.000Z',
    })

    expect(useChatbotWorkspaceStore.getState().workspaceContext).toMatchObject({
      caseId: '41',
      module: 'ild',
      view: 'records',
      filters: { search: '12345' },
    })

    useChatbotWorkspaceStore.getState().clearWorkspaceContext()

    expect(useChatbotWorkspaceStore.getState().workspaceContext).toBeNull()
  })
})
