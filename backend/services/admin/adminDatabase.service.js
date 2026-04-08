import pool from '../../config/database.js';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const LARGE_TABLE_THRESHOLD = 100000;
const ALLOWED_FILTER_OPERATORS = new Set(['eq', 'ilike', 'gte', 'lte', 'isnull']);
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const TEXT_LIKE_TYPES = new Set([
  'character varying',
  'character',
  'text',
  'uuid',
  'inet',
  'citext',
]);

const RANGE_FILTER_TYPES = new Set([
  'smallint',
  'integer',
  'bigint',
  'numeric',
  'real',
  'double precision',
  'date',
  'timestamp without time zone',
  'timestamp with time zone',
  'time without time zone',
  'time with time zone',
]);

const RESTRICTED_TABLE_POLICIES = new Map([
  ['users', { allowedRoles: new Set(['it_admin']), reason: 'Contains officer identity and authentication fields.' }],
  ['refresh_tokens', { allowedRoles: new Set(['it_admin']), reason: 'Contains refresh-token metadata and session secrets.' }],
  ['sessions', { allowedRoles: new Set(['it_admin']), reason: 'Contains officer session telemetry and login traces.' }],
  ['admin_accounts', { allowedRoles: new Set(['it_admin']), reason: 'Contains admin identity and authentication fields.' }],
  ['admin_refresh_tokens', { allowedRoles: new Set(['it_admin']), reason: 'Contains admin refresh-token metadata and session secrets.' }],
  ['admin_sessions', { allowedRoles: new Set(['it_admin']), reason: 'Contains admin session telemetry and login traces.' }],
  ['admin_action_logs', { allowedRoles: new Set(['it_admin']), reason: 'Contains privileged admin action records.' }],
]);

const EXACT_MASK_POLICIES = new Map([
  ['password_hash', 'full'],
  ['token_hash', 'full'],
  ['refresh_token', 'full'],
  ['access_token', 'full'],
  ['reset_token', 'full'],
  ['reset_token_hash', 'full'],
  ['secret', 'full'],
  ['api_secret', 'full'],
  ['client_secret', 'full'],
  ['signing_secret', 'full'],
  ['private_key', 'full'],
  ['totp_secret', 'full'],
  ['totp_seed', 'full'],
  ['otp_secret', 'full'],
  ['mfa_secret', 'full'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['mobile', 'phone'],
  ['ip_address', 'ip'],
]);

const TABLE_MASK_OVERRIDES = new Map([
  ['users', new Map([
    ['email', 'email'],
    ['password_hash', 'full'],
  ])],
  ['admin_accounts', new Map([
    ['email', 'email'],
    ['password_hash', 'full'],
  ])],
  ['refresh_tokens', new Map([
    ['token_hash', 'full'],
    ['ip_address', 'ip'],
  ])],
  ['admin_refresh_tokens', new Map([
    ['token_hash', 'full'],
    ['ip_address', 'ip'],
  ])],
  ['sessions', new Map([['ip_address', 'ip']])],
  ['admin_sessions', new Map([['ip_address', 'ip']])],
  ['admin_action_logs', new Map([['ip_address', 'ip']])],
]);

const FULL_REDACTION_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /hash/i,
  /reset/i,
  /totp/i,
  /otp/i,
  /mfa/i,
  /seed/i,
  /key$/i,
];

const PARTIAL_PII_PATTERNS = [
  /email/i,
  /phone/i,
  /mobile/i,
  /address/i,
  /^ip$/i,
  /^ip_/i,
  /_ip$/i,
];

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const assertSafeIdentifier = (value, typeLabel) => {
  const normalized = String(value || '').trim();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw createHttpError(`Invalid ${typeLabel}`, 400);
  }
  return normalized;
};

const formatBytes = (value) => {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const scaled = size / (1024 ** power);
  return `${scaled.toFixed(scaled >= 10 || power === 0 ? 0 : 1)} ${units[power]}`;
};

const maskEmail = (value) => {
  const text = String(value || '');
  const [localPart, domain] = text.split('@');
  if (!localPart || !domain) return '[REDACTED]';
  const visible = localPart.slice(0, Math.min(localPart.length, 2));
  return `${visible}${'*'.repeat(Math.max(localPart.length - visible.length, 1))}@${domain}`;
};

const maskPhone = (value) => {
  const text = String(value || '');
  if (text.length <= 4) return '[REDACTED]';
  return `${'*'.repeat(Math.max(text.length - 4, 1))}${text.slice(-4)}`;
};

const maskIp = (value) => {
  const text = String(value || '');
  if (!text) return '[REDACTED]';
  if (text.includes(':')) return '[REDACTED_IPV6]';
  const parts = text.split('.');
  if (parts.length !== 4) return '[REDACTED]';
  return `${parts[0]}.${parts[1]}.*.*`;
};

const resolveMaskStrategy = (tableName, columnName) => {
  const normalizedColumn = String(columnName || '').trim().toLowerCase();
  const tableOverrides = TABLE_MASK_OVERRIDES.get(String(tableName || '').trim());
  const override = tableOverrides?.get(normalizedColumn);
  if (override) return override;

  const exact = EXACT_MASK_POLICIES.get(normalizedColumn);
  if (exact) return exact;

  if (FULL_REDACTION_PATTERNS.some((pattern) => pattern.test(normalizedColumn))) return 'full';
  if (/email/i.test(normalizedColumn)) return 'email';
  if (/phone|mobile/i.test(normalizedColumn)) return 'phone';
  if (/^ip$|^ip_|_ip$/i.test(normalizedColumn)) return 'ip';
  if (PARTIAL_PII_PATTERNS.some((pattern) => pattern.test(normalizedColumn))) return 'partial';
  return 'none';
};

const maskCellValue = (column, value) => {
  if (value === null || value === undefined) return value;

  switch (column.maskStrategy) {
    case 'full':
      return '[REDACTED]';
    case 'email':
      return maskEmail(value);
    case 'phone':
      return maskPhone(value);
    case 'ip':
      return maskIp(value);
    case 'partial':
      return '[MASKED]';
    default:
      return value;
  }
};

const groupTableName = (tableName) => {
  if (/^admin_/.test(tableName)) return 'Admin Console';
  if (['users', 'officers', 'sessions', 'refresh_tokens'].includes(tableName)) return 'Identity & Access';
  if (['cases', 'case_assignments', 'archived_cases', 'evidence_exports'].includes(tableName)) return 'Investigations';
  if (['uploaded_files', 'file_classifications', 'ingestion_jobs', 'rejected_rows'].includes(tableName)) return 'Files & Ingestion';
  if (/_records$/.test(tableName)) return 'Telecom Records';
  if (['chat_history'].includes(tableName)) return 'AI & Chat';
  return 'Operations';
};

const parseIndexColumns = (indexDefinition = '') => {
  const match = String(indexDefinition).match(/\((.+?)\)(?:\s|$)/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((part) => part.trim().replace(/^"+|"+$/g, ''))
    .filter(Boolean)
    .map((column) => column.split(/\s+/)[0]);
};

const getTableBrowsePolicy = (tableName, adminRole = 'it_admin') => {
  const policy = RESTRICTED_TABLE_POLICIES.get(tableName);
  if (!policy) {
    return {
      restricted: false,
      canBrowseRows: true,
      browseRestrictionReason: null,
    };
  }

  const canBrowseRows = policy.allowedRoles.has(adminRole);
  return {
    restricted: true,
    canBrowseRows,
    browseRestrictionReason: canBrowseRows
      ? policy.reason
      : `${policy.reason} Row browsing is limited to it_admin accounts.`,
  };
};

const loadDatabaseCatalog = async (adminRole = 'it_admin') => {
  const [tablesResult, columnsResult, indexesResult, relationshipsResult] = await Promise.all([
    pool.query(`
      SELECT
        ns.nspname AS table_schema,
        cls.relname AS table_name,
        CASE cls.relkind
          WHEN 'v' THEN 'VIEW'
          WHEN 'm' THEN 'MATERIALIZED VIEW'
          ELSE 'TABLE'
        END AS table_type,
        GREATEST(COALESCE(cls.reltuples, 0)::bigint, 0) AS estimated_row_count,
        CASE
          WHEN cls.relkind IN ('r', 'p', 'm') THEN pg_total_relation_size(cls.oid)::bigint
          ELSE 0::bigint
        END AS total_bytes,
        stat.last_analyze,
        stat.last_autoanalyze
      FROM pg_class cls
      JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      LEFT JOIN pg_stat_user_tables stat ON stat.relid = cls.oid
      WHERE ns.nspname = 'public'
        AND cls.relkind IN ('r', 'p', 'v', 'm')
      ORDER BY cls.relname ASC
    `),
    pool.query(`
      WITH primary_keys AS (
        SELECT
          kcu.table_schema,
          kcu.table_name,
          kcu.column_name,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
      )
      SELECT
        c.table_schema,
        c.table_name,
        c.column_name,
        c.ordinal_position,
        c.is_nullable = 'YES' AS is_nullable,
        c.data_type,
        c.udt_name,
        c.column_default,
        CASE WHEN pk.constraint_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_primary_key
      FROM information_schema.columns c
      LEFT JOIN primary_keys pk
        ON pk.table_schema = c.table_schema
       AND pk.table_name = c.table_name
       AND pk.column_name = c.column_name
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name ASC, c.ordinal_position ASC
    `),
    pool.query(`
      SELECT
        schemaname AS table_schema,
        tablename AS table_name,
        indexname AS index_name,
        indexdef AS index_definition
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename ASC, indexname ASC
    `),
    pool.query(`
      SELECT
        tc.constraint_name,
        tc.table_schema AS source_schema,
        tc.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_schema AS target_schema,
        ccu.table_name AS target_table,
        ccu.column_name AS target_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name ASC, tc.constraint_name ASC
    `),
  ]);

  const tableMap = new Map();

  for (const row of tablesResult.rows) {
    const browsePolicy = getTableBrowsePolicy(row.table_name, adminRole);

    tableMap.set(row.table_name, {
      name: row.table_name,
      schema: row.table_schema,
      type: row.table_type,
      group: groupTableName(row.table_name),
      restricted: browsePolicy.restricted,
      canBrowseRows: browsePolicy.canBrowseRows,
      browseRestrictionReason: browsePolicy.browseRestrictionReason,
      estimatedRowCount: Number(row.estimated_row_count || 0),
      totalBytes: Number(row.total_bytes || 0),
      totalBytesLabel: formatBytes(row.total_bytes),
      lastAnalyzedAt: row.last_autoanalyze || row.last_analyze || null,
      largeTableMode: Number(row.estimated_row_count || 0) >= LARGE_TABLE_THRESHOLD,
      columns: [],
      indexes: [],
      indexedColumns: new Set(),
      keyColumns: new Set(),
      outgoingRelationships: [],
      incomingRelationships: [],
    });
  }

  for (const row of columnsResult.rows) {
    const table = tableMap.get(row.table_name);
    if (!table) continue;

    const column = {
      name: row.column_name,
      ordinalPosition: Number(row.ordinal_position),
      dataType: row.data_type,
      databaseType: row.udt_name,
      isNullable: Boolean(row.is_nullable),
      defaultValue: row.column_default,
      isPrimaryKey: Boolean(row.is_primary_key),
      maskStrategy: resolveMaskStrategy(row.table_name, row.column_name),
    };

    table.columns.push(column);
    if (column.isPrimaryKey) table.keyColumns.add(column.name);
  }

  for (const row of indexesResult.rows) {
    const table = tableMap.get(row.table_name);
    if (!table) continue;

    const columns = parseIndexColumns(row.index_definition);
    columns.forEach((column) => table.indexedColumns.add(column));

    table.indexes.push({
      name: row.index_name,
      definition: row.index_definition,
      columns,
      isUnique: /^CREATE UNIQUE INDEX/i.test(String(row.index_definition || '')),
    });
  }

  for (const row of relationshipsResult.rows) {
    const relationship = {
      constraintName: row.constraint_name,
      sourceTable: row.source_table,
      sourceColumn: row.source_column,
      targetTable: row.target_table,
      targetColumn: row.target_column,
    };

    const sourceTable = tableMap.get(row.source_table);
    const targetTable = tableMap.get(row.target_table);

    if (sourceTable) {
      sourceTable.outgoingRelationships.push(relationship);
      sourceTable.keyColumns.add(row.source_column);
    }

    if (targetTable) {
      targetTable.incomingRelationships.push(relationship);
      targetTable.keyColumns.add(row.target_column);
    }
  }

  const tables = Array.from(tableMap.values())
    .map((table) => ({
      ...table,
      columnCount: table.columns.length,
      indexCount: table.indexes.length,
      relationshipCount: table.outgoingRelationships.length + table.incomingRelationships.length,
      indexedColumns: Array.from(table.indexedColumns).sort(),
      keyColumns: Array.from(table.keyColumns).sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const normalizedTableMap = new Map(tables.map((table) => [table.name, table]));
  const relationships = tables.flatMap((table) => table.outgoingRelationships);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      tableCount: tables.length,
      relationshipCount: relationships.length,
      restrictedTableCount: tables.filter((table) => table.restricted).length,
    },
    tables,
    relationships,
    tableMap: normalizedTableMap,
  };
};

const requireCatalogTable = async (tableName, adminRole = 'it_admin') => {
  const normalized = assertSafeIdentifier(tableName, 'table name');
  const catalog = await loadDatabaseCatalog(adminRole);
  const table = catalog.tableMap.get(normalized);

  if (!table) {
    throw createHttpError('Unknown or restricted table', 404);
  }

  return { catalog, table, normalized };
};

const buildFilterClause = ({ filterColumn, filterOp, filterValue, table }) => {
  if (!filterColumn || !filterOp) return { whereSql: '', params: [] };

  const safeColumn = assertSafeIdentifier(filterColumn, 'filter column');
  const columnMeta = table.columns.find((column) => column.name === safeColumn);
  if (!columnMeta) {
    throw createHttpError('Invalid filter column', 400);
  }

  const normalizedOp = String(filterOp).trim().toLowerCase();
  if (!ALLOWED_FILTER_OPERATORS.has(normalizedOp)) {
    throw createHttpError('Invalid filter operator', 400);
  }

  if (table.largeTableMode && !table.keyColumns.includes(safeColumn) && !table.indexedColumns.includes(safeColumn)) {
    throw createHttpError('Large-table filters are limited to indexed or relationship columns', 400);
  }

  if (normalizedOp === 'ilike' && table.largeTableMode) {
    throw createHttpError('Large-table text search is disabled to prevent full scans', 400);
  }

  if (normalizedOp === 'ilike' && !TEXT_LIKE_TYPES.has(columnMeta.dataType)) {
    throw createHttpError('Text search is only allowed on textual columns', 400);
  }

  if ((normalizedOp === 'gte' || normalizedOp === 'lte') && !RANGE_FILTER_TYPES.has(columnMeta.dataType)) {
    throw createHttpError('Range filters are only allowed on numeric or time-based columns', 400);
  }

  const quotedColumn = quoteIdentifier(safeColumn);

  if (normalizedOp === 'isnull') {
    const isNull = String(filterValue || 'true').trim().toLowerCase() !== 'false';
    return {
      whereSql: `WHERE ${quotedColumn} IS ${isNull ? '' : 'NOT '}NULL`,
      params: [],
    };
  }

  if (filterValue === undefined || filterValue === null || String(filterValue).trim() === '') {
    return { whereSql: '', params: [] };
  }

  switch (normalizedOp) {
    case 'eq':
      return { whereSql: `WHERE ${quotedColumn} = $1`, params: [String(filterValue)] };
    case 'ilike':
      return { whereSql: `WHERE ${quotedColumn}::text ILIKE $1`, params: [`%${String(filterValue)}%`] };
    case 'gte':
      return { whereSql: `WHERE ${quotedColumn} >= $1`, params: [String(filterValue)] };
    case 'lte':
      return { whereSql: `WHERE ${quotedColumn} <= $1`, params: [String(filterValue)] };
    default:
      return { whereSql: '', params: [] };
  }
};

const normalizeRowBrowseError = (error) => {
  if (error?.statusCode) return error;

  if (['22P02', '22007', '22008'].includes(error?.code)) {
    return createHttpError('Invalid filter value for the selected column', 400);
  }

  if (error?.code === '57014') {
    return createHttpError('The browse query timed out before it completed', 504);
  }

  return error;
};

const sortGroupSummary = (groupsMap) =>
  Array.from(groupsMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name));

export const fetchAdminDatabaseSchema = async (adminRole = 'it_admin') => {
  const catalog = await loadDatabaseCatalog(adminRole);

  return {
    generatedAt: catalog.generatedAt,
    summary: catalog.summary,
    groups: sortGroupSummary(
      catalog.tables.reduce((acc, table) => {
        acc.set(table.group, (acc.get(table.group) || 0) + 1);
        return acc;
      }, new Map())
    ),
    tables: catalog.tables.map((table) => ({
      name: table.name,
      schema: table.schema,
      type: table.type,
      group: table.group,
      restricted: table.restricted,
      estimatedRowCount: table.estimatedRowCount,
      totalBytes: table.totalBytes,
      totalBytesLabel: table.totalBytesLabel,
      lastAnalyzedAt: table.lastAnalyzedAt,
      columnCount: table.columnCount,
      indexCount: table.indexCount,
      relationshipCount: table.relationshipCount,
      canBrowseRows: table.canBrowseRows,
      browseRestrictionReason: table.browseRestrictionReason,
      largeTableMode: table.largeTableMode,
    })),
    relationships: catalog.relationships,
  };
};

export const fetchAdminDatabaseTable = async (tableName, adminRole = 'it_admin') => {
  const { table } = await requireCatalogTable(tableName, adminRole);

  return {
    table: {
      name: table.name,
      schema: table.schema,
      type: table.type,
      group: table.group,
      restricted: table.restricted,
      estimatedRowCount: table.estimatedRowCount,
      totalBytes: table.totalBytes,
      totalBytesLabel: table.totalBytesLabel,
      lastAnalyzedAt: table.lastAnalyzedAt,
      canBrowseRows: table.canBrowseRows,
      browseRestrictionReason: table.browseRestrictionReason,
      largeTableMode: table.largeTableMode,
    },
    columns: table.columns,
    indexes: table.indexes,
    outgoingRelationships: table.outgoingRelationships,
    incomingRelationships: table.incomingRelationships,
  };
};

export const fetchAdminDatabaseRows = async (tableName, query = {}, adminRole = 'it_admin') => {
  const { table, normalized } = await requireCatalogTable(tableName, adminRole);
  const page = parsePositiveInt(query.page, 1);
  const pageSize = Math.min(parsePositiveInt(query.limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

  if (!table.canBrowseRows) {
    throw createHttpError(table.browseRestrictionReason || 'This table is not available for row browsing', 403);
  }

  const defaultSortBy =
    table.columns.find((column) => column.isPrimaryKey)?.name
    || table.keyColumns[0]
    || table.indexedColumns[0]
    || table.columns[0]?.name;
  const sortBy = query.sortBy
    ? assertSafeIdentifier(query.sortBy, 'sort column')
    : defaultSortBy;
  const sortDir = String(query.sortDir || 'desc').trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  if (!sortBy || !table.columns.some((column) => column.name === sortBy)) {
    throw createHttpError('Invalid sort column', 400);
  }

  if (table.largeTableMode && !table.keyColumns.includes(sortBy) && !table.indexedColumns.includes(sortBy)) {
    throw createHttpError('Large-table sorting is limited to indexed or relationship columns', 400);
  }

  const { whereSql, params: filterParams } = buildFilterClause({
    filterColumn: query.filterColumn,
    filterOp: query.filterOp,
    filterValue: query.filterValue,
    table,
  });

  const offset = (page - 1) * pageSize;
  const sortColumnSql = quoteIdentifier(sortBy);
  const tableSql = `${quoteIdentifier('public')}.${quoteIdentifier(normalized)}`;

  try {
    const rowsResult = await pool.query(
      `
        SELECT *
        FROM ${tableSql}
        ${whereSql}
        ORDER BY ${sortColumnSql} ${sortDir} NULLS LAST
        LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}
      `,
      [...filterParams, pageSize + 1, offset]
    );

    const hasMore = rowsResult.rows.length > pageSize;
    const items = rowsResult.rows.slice(0, pageSize).map((row) => {
      const masked = {};
      for (const column of table.columns) {
        masked[column.name] = maskCellValue(column, row[column.name]);
      }
      return masked;
    });

    return {
      table: {
        name: table.name,
        schema: table.schema,
        restricted: table.restricted,
        estimatedRowCount: table.estimatedRowCount,
        totalBytesLabel: table.totalBytesLabel,
        canBrowseRows: table.canBrowseRows,
        browseRestrictionReason: table.browseRestrictionReason,
        largeTableMode: table.largeTableMode,
      },
      columns: table.columns,
      items,
      pagination: {
        page,
        pageSize,
        hasMore,
        estimatedTotal: table.estimatedRowCount,
      },
      filter: {
        column: query.filterColumn || null,
        operator: query.filterOp || null,
        value: query.filterValue || null,
      },
      sort: {
        by: sortBy,
        dir: sortDir.toLowerCase(),
      },
    };
  } catch (error) {
    throw normalizeRowBrowseError(error);
  }
};
