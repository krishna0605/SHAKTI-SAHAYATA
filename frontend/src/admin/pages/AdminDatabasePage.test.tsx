import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminDatabasePage from './AdminDatabasePage'

const getDatabaseSchemaMock = vi.fn()
const getDatabaseTableMock = vi.fn()
const getDatabaseRowsMock = vi.fn()

vi.mock('../lib/api', () => ({
  adminConsoleAPI: {
    getDatabaseSchema: () => getDatabaseSchemaMock(),
    getDatabaseTable: (...args: unknown[]) => getDatabaseTableMock(...args),
    getDatabaseRows: (...args: unknown[]) => getDatabaseRowsMock(...args),
  },
}))

vi.mock('../store/adminAuthStore', () => ({
  useAdminAuthStore: () => ({
    admin: { role: 'it_admin', fullName: 'IT Admin' },
  }),
}))

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AdminDatabasePage />
    </QueryClientProvider>
  )
}

describe('AdminDatabasePage', () => {
  beforeEach(() => {
    getDatabaseSchemaMock.mockReset()
    getDatabaseTableMock.mockReset()
    getDatabaseRowsMock.mockReset()
  })

  it('shows a restricted browse state when the selected table cannot be opened', async () => {
    getDatabaseSchemaMock.mockResolvedValue({
      generatedAt: '2026-04-08T10:00:00.000Z',
      summary: { tableCount: 1, relationshipCount: 0, restrictedTableCount: 1 },
      groups: [{ name: 'Identity & Access', count: 1 }],
      tables: [
        {
          name: 'users',
          schema: 'public',
          type: 'TABLE',
          group: 'Identity & Access',
          restricted: true,
          estimatedRowCount: 12,
          totalBytes: 16384,
          totalBytesLabel: '16 KB',
          lastAnalyzedAt: '2026-04-08T09:05:00.000Z',
          columnCount: 3,
          indexCount: 1,
          relationshipCount: 0,
          canBrowseRows: false,
          browseRestrictionReason: 'Row browsing is limited to it_admin accounts.',
          largeTableMode: false,
        },
      ],
      relationships: [],
    })

    getDatabaseTableMock.mockResolvedValue({
      table: {
        name: 'users',
        schema: 'public',
        type: 'TABLE',
        group: 'Identity & Access',
        restricted: true,
        estimatedRowCount: 12,
        totalBytes: 16384,
        totalBytesLabel: '16 KB',
        lastAnalyzedAt: '2026-04-08T09:05:00.000Z',
        canBrowseRows: false,
        browseRestrictionReason: 'Row browsing is limited to it_admin accounts.',
        largeTableMode: false,
      },
      columns: [
        { name: 'id', ordinalPosition: 1, dataType: 'integer', databaseType: 'int4', isNullable: false, defaultValue: null, isPrimaryKey: true, maskStrategy: 'none' },
      ],
      indexes: [{ name: 'users_pkey', definition: 'CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)', columns: ['id'], isUnique: true }],
      outgoingRelationships: [],
      incomingRelationships: [],
    })

    renderPage()

    expect(await screen.findByText(/database explorer and safe schema browser/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(getDatabaseTableMock).toHaveBeenCalledWith('users')
    })
    expect(getDatabaseRowsMock).not.toHaveBeenCalled()
  })

  it('renders masked browse data for an allowed table', async () => {
    getDatabaseSchemaMock.mockResolvedValue({
      generatedAt: '2026-04-08T10:00:00.000Z',
      summary: { tableCount: 1, relationshipCount: 1, restrictedTableCount: 0 },
      groups: [{ name: 'Investigations', count: 1 }],
      tables: [
        {
          name: 'cases',
          schema: 'public',
          type: 'TABLE',
          group: 'Investigations',
          restricted: false,
          estimatedRowCount: 42,
          totalBytes: 65536,
          totalBytesLabel: '64 KB',
          lastAnalyzedAt: '2026-04-08T09:05:00.000Z',
          columnCount: 2,
          indexCount: 1,
          relationshipCount: 1,
          canBrowseRows: true,
          browseRestrictionReason: null,
          largeTableMode: false,
        },
      ],
      relationships: [
        {
          constraintName: 'cases_owner_id_fkey',
          sourceTable: 'cases',
          sourceColumn: 'owner_id',
          targetTable: 'users',
          targetColumn: 'id',
        },
      ],
    })

    getDatabaseTableMock.mockResolvedValue({
      table: {
        name: 'cases',
        schema: 'public',
        type: 'TABLE',
        group: 'Investigations',
        restricted: false,
        estimatedRowCount: 42,
        totalBytes: 65536,
        totalBytesLabel: '64 KB',
        lastAnalyzedAt: '2026-04-08T09:05:00.000Z',
        canBrowseRows: true,
        browseRestrictionReason: null,
        largeTableMode: false,
      },
      columns: [
        { name: 'id', ordinalPosition: 1, dataType: 'integer', databaseType: 'int4', isNullable: false, defaultValue: null, isPrimaryKey: true, maskStrategy: 'none' },
        { name: 'email', ordinalPosition: 2, dataType: 'character varying', databaseType: 'varchar', isNullable: true, defaultValue: null, isPrimaryKey: false, maskStrategy: 'email' },
      ],
      indexes: [{ name: 'cases_pkey', definition: 'CREATE UNIQUE INDEX cases_pkey ON public.cases USING btree (id)', columns: ['id'], isUnique: true }],
      outgoingRelationships: [
        {
          constraintName: 'cases_owner_id_fkey',
          sourceTable: 'cases',
          sourceColumn: 'owner_id',
          targetTable: 'users',
          targetColumn: 'id',
        },
      ],
      incomingRelationships: [],
    })

    getDatabaseRowsMock.mockResolvedValue({
      table: {
        name: 'cases',
        schema: 'public',
        restricted: false,
        estimatedRowCount: 42,
        totalBytesLabel: '64 KB',
        canBrowseRows: true,
        browseRestrictionReason: null,
        largeTableMode: false,
      },
      columns: [
        { name: 'id', ordinalPosition: 1, dataType: 'integer', databaseType: 'int4', isNullable: false, defaultValue: null, isPrimaryKey: true, maskStrategy: 'none' },
        { name: 'email', ordinalPosition: 2, dataType: 'character varying', databaseType: 'varchar', isNullable: true, defaultValue: null, isPrimaryKey: false, maskStrategy: 'email' },
      ],
      items: [{ id: 201, email: 'in*******@police.gov.in' }],
      pagination: { page: 1, pageSize: 25, hasMore: false, estimatedTotal: 42 },
      filter: { column: null, operator: null, value: null },
      sort: { by: 'id', dir: 'desc' },
    })

    renderPage()

    await waitFor(() => {
      expect(getDatabaseRowsMock).toHaveBeenCalled()
    })

    expect(getDatabaseRowsMock).toHaveBeenCalledWith(
      'cases',
      expect.objectContaining({
        page: 1,
        limit: 25,
        sortBy: 'id',
        sortDir: 'desc',
      })
    )
  })
})
