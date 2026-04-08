import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn(async (sql, params = []) => {
  const text = String(sql);

  if (text.includes('FROM pg_class cls')) {
    return {
      rows: [
        {
          table_schema: 'public',
          table_name: 'users',
          table_type: 'TABLE',
          estimated_row_count: 12,
          total_bytes: 16384,
          last_analyze: '2026-04-08T09:00:00.000Z',
          last_autoanalyze: '2026-04-08T09:05:00.000Z',
        },
        {
          table_schema: 'public',
          table_name: 'refresh_tokens',
          table_type: 'TABLE',
          estimated_row_count: 8,
          total_bytes: 8192,
          last_analyze: '2026-04-08T09:10:00.000Z',
          last_autoanalyze: '2026-04-08T09:12:00.000Z',
        },
        {
          table_schema: 'public',
          table_name: 'cases',
          table_type: 'TABLE',
          estimated_row_count: 250000,
          total_bytes: 5242880,
          last_analyze: '2026-04-08T08:30:00.000Z',
          last_autoanalyze: '2026-04-08T08:35:00.000Z',
        },
      ],
      rowCount: 2,
    };
  }

  if (text.includes('FROM information_schema.columns c')) {
    return {
      rows: [
        {
          table_schema: 'public',
          table_name: 'users',
          column_name: 'id',
          ordinal_position: 1,
          is_nullable: false,
          data_type: 'integer',
          udt_name: 'int4',
          column_default: null,
          is_primary_key: true,
        },
        {
          table_schema: 'public',
          table_name: 'users',
          column_name: 'email',
          ordinal_position: 2,
          is_nullable: false,
          data_type: 'character varying',
          udt_name: 'varchar',
          column_default: null,
          is_primary_key: false,
        },
        {
          table_schema: 'public',
          table_name: 'users',
          column_name: 'password_hash',
          ordinal_position: 3,
          is_nullable: false,
          data_type: 'character varying',
          udt_name: 'varchar',
          column_default: null,
          is_primary_key: false,
        },
        {
          table_schema: 'public',
          table_name: 'users',
          column_name: 'totp_secret',
          ordinal_position: 4,
          is_nullable: true,
          data_type: 'character varying',
          udt_name: 'varchar',
          column_default: null,
          is_primary_key: false,
        },
        {
          table_schema: 'public',
          table_name: 'refresh_tokens',
          column_name: 'id',
          ordinal_position: 1,
          is_nullable: false,
          data_type: 'uuid',
          udt_name: 'uuid',
          column_default: null,
          is_primary_key: true,
        },
        {
          table_schema: 'public',
          table_name: 'refresh_tokens',
          column_name: 'token_hash',
          ordinal_position: 2,
          is_nullable: false,
          data_type: 'character varying',
          udt_name: 'varchar',
          column_default: null,
          is_primary_key: false,
        },
        {
          table_schema: 'public',
          table_name: 'refresh_tokens',
          column_name: 'ip_address',
          ordinal_position: 3,
          is_nullable: true,
          data_type: 'inet',
          udt_name: 'inet',
          column_default: null,
          is_primary_key: false,
        },
        {
          table_schema: 'public',
          table_name: 'cases',
          column_name: 'id',
          ordinal_position: 1,
          is_nullable: false,
          data_type: 'integer',
          udt_name: 'int4',
          column_default: null,
          is_primary_key: true,
        },
        {
          table_schema: 'public',
          table_name: 'cases',
          column_name: 'case_number',
          ordinal_position: 2,
          is_nullable: false,
          data_type: 'character varying',
          udt_name: 'varchar',
          column_default: null,
          is_primary_key: false,
        },
        {
          table_schema: 'public',
          table_name: 'cases',
          column_name: 'description',
          ordinal_position: 3,
          is_nullable: true,
          data_type: 'text',
          udt_name: 'text',
          column_default: null,
          is_primary_key: false,
        },
      ],
      rowCount: 7,
    };
  }

  if (text.includes('FROM pg_indexes')) {
    return {
      rows: [
        {
          table_schema: 'public',
          table_name: 'users',
          index_name: 'users_pkey',
          index_definition: 'CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)',
        },
        {
          table_schema: 'public',
          table_name: 'users',
          index_name: 'idx_users_email',
          index_definition: 'CREATE INDEX idx_users_email ON public.users USING btree (email)',
        },
        {
          table_schema: 'public',
          table_name: 'refresh_tokens',
          index_name: 'refresh_tokens_pkey',
          index_definition: 'CREATE UNIQUE INDEX refresh_tokens_pkey ON public.refresh_tokens USING btree (id)',
        },
        {
          table_schema: 'public',
          table_name: 'refresh_tokens',
          index_name: 'idx_refresh_tokens_token_hash',
          index_definition: 'CREATE INDEX idx_refresh_tokens_token_hash ON public.refresh_tokens USING btree (token_hash)',
        },
        {
          table_schema: 'public',
          table_name: 'cases',
          index_name: 'cases_pkey',
          index_definition: 'CREATE UNIQUE INDEX cases_pkey ON public.cases USING btree (id)',
        },
        {
          table_schema: 'public',
          table_name: 'cases',
          index_name: 'idx_cases_case_number',
          index_definition: 'CREATE INDEX idx_cases_case_number ON public.cases USING btree (case_number)',
        },
      ],
      rowCount: 6,
    };
  }

  if (text.includes("constraint_type = 'FOREIGN KEY'")) {
    return {
      rows: [
        {
          constraint_name: 'refresh_tokens_user_id_fkey',
          source_schema: 'public',
          source_table: 'refresh_tokens',
          source_column: 'id',
          target_schema: 'public',
          target_table: 'users',
          target_column: 'id',
        },
      ],
      rowCount: 1,
    };
  }

  if (text.includes('FROM "public"."users"')) {
    return {
      rows: [
        { id: 1, email: 'inspector@police.gov.in', password_hash: 'hash-1', totp_secret: 'totp-1' },
        { id: 2, email: 'auditor@police.gov.in', password_hash: 'hash-2', totp_secret: 'totp-2' },
      ],
      rowCount: 2,
    };
  }

  if (text.includes('FROM "public"."refresh_tokens"')) {
    return {
      rows: [
        { id: 'uuid-1', token_hash: 'secret-token-hash', ip_address: '10.0.0.21' },
        { id: 'uuid-2', token_hash: 'another-token-hash', ip_address: '10.0.0.22' },
      ],
      rowCount: 2,
    };
  }

  if (text.includes('FROM "public"."cases"') && params.includes('bad-int')) {
    const error = new Error('invalid input syntax');
    error.code = '22P02';
    throw error;
  }

  return { rows: [], rowCount: 0 };
});

vi.mock('../config/database.js', () => ({
  default: {
    query: queryMock,
    on: vi.fn(),
  },
}));

const {
  fetchAdminDatabaseRows,
  fetchAdminDatabaseSchema,
  fetchAdminDatabaseTable,
} = await import('../services/admin/adminDatabase.service.js');

describe('admin database service', () => {
  beforeEach(() => {
    queryMock.mockClear();
  });

  it('builds schema metadata with role-aware browse access', async () => {
    const schema = await fetchAdminDatabaseSchema('it_auditor');

    expect(schema.summary.tableCount).toBe(3);
    expect(schema.tables.find((table) => table.name === 'users')?.canBrowseRows).toBe(false);
    expect(schema.tables.find((table) => table.name === 'cases')?.largeTableMode).toBe(true);
  });

  it('returns table metadata with restricted browse state for auditors', async () => {
    const payload = await fetchAdminDatabaseTable('users', 'it_auditor');

    expect(payload.table.restricted).toBe(true);
    expect(payload.table.canBrowseRows).toBe(false);
    expect(payload.table.browseRestrictionReason).toContain('it_admin');
  });

  it('masks sensitive row values before returning them', async () => {
    const payload = await fetchAdminDatabaseRows('users', { sortBy: 'id', sortDir: 'asc' }, 'it_admin');

    expect(payload.items[0]).toEqual({
      id: 1,
      email: 'in*******@police.gov.in',
      password_hash: '[REDACTED]',
      totp_secret: '[REDACTED]',
    });
  });

  it('masks token hashes and IP addresses in sensitive auth tables', async () => {
    const payload = await fetchAdminDatabaseRows('refresh_tokens', { sortBy: 'id', sortDir: 'asc' }, 'it_admin');

    expect(payload.items[0]).toEqual({
      id: 'uuid-1',
      token_hash: '[REDACTED]',
      ip_address: '10.0.*.*',
    });
  });

  it('rejects invalid table identifiers safely', async () => {
    await expect(fetchAdminDatabaseRows('users;DROP TABLE users', {}, 'it_admin')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid table name',
    });
  });

  it('rejects invalid sort identifiers safely', async () => {
    await expect(fetchAdminDatabaseRows('cases', { sortBy: 'id;DROP' }, 'it_admin')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid sort column',
    });
  });

  it('rejects invalid filter operators safely', async () => {
    await expect(
      fetchAdminDatabaseRows(
        'users',
        { sortBy: 'id', filterColumn: 'email', filterOp: 'contains', filterValue: 'police' },
        'it_admin'
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid filter operator',
    });
  });

  it('normalizes invalid typed filter values into safe 400 responses', async () => {
    await expect(
      fetchAdminDatabaseRows(
        'cases',
        { sortBy: 'id', filterColumn: 'id', filterOp: 'gte', filterValue: 'bad-int' },
        'it_admin'
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid filter value for the selected column',
    });
  });

  it('blocks restricted row browsing for auditors', async () => {
    await expect(fetchAdminDatabaseRows('users', {}, 'it_auditor')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('blocks large-table text search to avoid full scans', async () => {
    await expect(
      fetchAdminDatabaseRows(
        'cases',
        { sortBy: 'id', filterColumn: 'case_number', filterOp: 'ilike', filterValue: 'CASE-' },
        'it_admin'
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Large-table text search is disabled to prevent full scans',
    });
  });
});
