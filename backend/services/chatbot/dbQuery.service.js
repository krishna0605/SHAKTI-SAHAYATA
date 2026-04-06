import pool from '../../config/database.js';
import { CHATBOT_DB_MAX_ROWS, CHATBOT_DB_QUERY_TIMEOUT_MS } from './config.js';
import { getAllowedTableNames } from './schemaDictionary.service.js';

const SQL_PREFIX = '/sql';

const BLOCKED_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'create',
  'alter',
  'drop',
  'truncate',
  'grant',
  'revoke',
  'comment',
  'vacuum',
  'analyze',
  'reindex',
  'refresh',
  'merge',
  'call',
  'do',
  'copy',
  'lock',
  'cluster',
  'set',
  'reset'
];
const BLOCKED_KEYWORDS_RE = new RegExp(`\\b(${BLOCKED_KEYWORDS.join('|')})\\b`, 'i');
const BLOCKED_CLAUSES_RE = /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i;
const BLOCKED_FUNCTIONS_RE = /\b(pg_read_file|pg_ls_dir|pg_stat_file|pg_sleep|dblink|lo_import|lo_export|current_setting)\s*\(/i;
const BLOCKED_META_RE = /\b(pg_catalog|information_schema|pg_authid|pg_shadow|pg_user|pg_roles|pg_stat_activity|pg_database)\b/i;
const BLOCKED_SENSITIVE_IDENTIFIERS = [
  'password',
  'passwd',
  'secret',
  'api[_-]?key',
  'token',
  'access[_-]?token',
  'refresh[_-]?token',
  'private[_-]?key',
  'salt',
  'otp',
  'mfa[_-]?secret',
  'ssn',
  'aadhaar'
];
const BLOCKED_SENSITIVE_RE = new RegExp(`\\b(${BLOCKED_SENSITIVE_IDENTIFIERS.join('|')})\\b`, 'i');

const stripTrailingSemicolons = (sql) => String(sql || '').replaceAll(/;+$/g, '').trim();

const stripSqlStringsAndComments = (sql = '') =>
  String(sql)
    // Remove line comments.
    .replaceAll(/--.*$/gm, '')
    // Remove block comments.
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    // Replace single-quoted strings (handles escaped '' inside strings).
    .replaceAll(/'(?:[^']|'')*'/g, "''")
    // Replace dollar-quoted strings (best-effort; common in Postgres).
    .replaceAll(/\$[\w]*\$[\s\S]*?\$[\w]*\$/g, '$$');

const containsGujaratiOutsideLiterals = (sql = '') => /[\u0A80-\u0AFF]/.test(stripSqlStringsAndComments(sql));

const ENABLE_QUERY_CACHE = String(process.env.CHATBOT_QUERY_CACHE || '').trim().toLowerCase() !== 'false';
const QUERY_CACHE_TTL_MS = Math.max(1000, Math.min(5 * 60 * 1000, Number(process.env.CHATBOT_QUERY_CACHE_TTL_MS || 15000)));
const QUERY_CACHE_MAX = Math.max(5, Math.min(200, Number(process.env.CHATBOT_QUERY_CACHE_MAX || 50)));

const ENFORCE_TABLE_ALLOWLIST = String(process.env.CHATBOT_SQL_ENFORCE_SCHEMA || '').trim().toLowerCase() === 'true';

// Minimal "from/join table" extractor. Good enough for allowlisting core tables in this app.
const extractReferencedTables = (sql = '') => {
  const text = String(sql || '');
  const out = new Set();
  const re = /\b(from|join)\s+([\w".]+)\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const raw = String(m[2] || '').trim();
    if (!raw) continue;
    const cleaned = raw.replace(/["']/g, '').split('.').pop();
    if (cleaned) out.add(cleaned);
  }
  return Array.from(out);
};

export const isSqlCommand = (message = '') =>
  typeof message === 'string' && message.trim().toLowerCase().startsWith(`${SQL_PREFIX} `);

export const extractSqlFromMessage = (message = '') => message.trim().slice(SQL_PREFIX.length).trim();

const validateSqlPolicy = (sql) => {
  if (sql.includes(';')) return 'Multiple SQL statements are not allowed.';
  if (!/^(select|with)\b/i.test(sql)) return 'Only SELECT/CTE read-only queries are allowed.';
  if (containsGujaratiOutsideLiterals(sql)) {
    return 'SQL must use English keywords/table/column names. Gujarati is allowed only inside quoted strings (e.g. WHERE case_name = \'...\').';
  }
  if (BLOCKED_KEYWORDS_RE.test(sql)) return 'Only read-only SELECT queries are allowed. Mutating/admin statements are blocked.';
  if (BLOCKED_CLAUSES_RE.test(sql)) return 'Locking clauses are not allowed.';
  if (BLOCKED_FUNCTIONS_RE.test(sql)) return 'Query uses blocked functions.';
  if (/^\s*select\b[\s\S]*\binto\b/i.test(sql)) return 'SELECT INTO is not allowed.';
  if (BLOCKED_META_RE.test(sql)) return 'System catalogs and sensitive metadata tables are blocked.';
  if (BLOCKED_SENSITIVE_RE.test(sql)) return 'Query references sensitive identifiers and is blocked by policy.';
  return null;
};

export const validateReadOnlySql = (rawSql = '') => {
  const sql = stripTrailingSemicolons(rawSql);

  if (!sql) return { ok: false, error: 'SQL query is required after /sql.' };
  const policyError = validateSqlPolicy(sql);
  if (policyError) return { ok: false, error: policyError };

  if (ENFORCE_TABLE_ALLOWLIST) {
    const allowed = new Set(getAllowedTableNames());
    const referenced = extractReferencedTables(sql);
    for (const table of referenced) {
      if (!allowed.has(table)) {
        return { ok: false, error: `Query references unknown/blocked table: ${table}` };
      }
    }
  }

  return { ok: true, sql };
};

const queryCache = new Map();
let cacheHits = 0;
let cacheMisses = 0;
let cacheSets = 0;
const cacheGet = (key) => {
  if (!ENABLE_QUERY_CACHE) return null;
  const hit = queryCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > QUERY_CACHE_TTL_MS) {
    queryCache.delete(key);
    return null;
  }
  cacheHits += 1;
  return hit.value;
};

const cacheSet = (key, value) => {
  if (!ENABLE_QUERY_CACHE) return;
  cacheSets += 1;
  queryCache.set(key, { at: Date.now(), value });
  if (queryCache.size <= QUERY_CACHE_MAX) return;

  // Drop oldest entries (tiny LRU-ish).
  const entries = Array.from(queryCache.entries()).sort((a, b) => a[1].at - b[1].at);
  while (queryCache.size > QUERY_CACHE_MAX && entries.length > 0) {
    const [k] = entries.shift();
    queryCache.delete(k);
  }
};

export const executeReadOnlyQuery = async (sql) => {
  const validation = validateReadOnlySql(sql);
  if (!validation.ok) {
    const error = new Error(validation.error);
    error.code = 'SQL_BLOCKED';
    throw error;
  }

  const cacheKey = validation.sql;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  if (ENABLE_QUERY_CACHE) cacheMisses += 1;

  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, CHATBOT_DB_QUERY_TIMEOUT_MS)}`);
    const result = await client.query(validation.sql);
    await client.query('COMMIT');

    const allRows = Array.isArray(result.rows) ? result.rows : [];
    const rows = allRows.slice(0, CHATBOT_DB_MAX_ROWS);
    const payload = {
      totalRows: allRows.length,
      truncated: allRows.length > rows.length,
      columns: (result.fields || []).map((field) => field.name),
      rows
    };

    cacheSet(cacheKey, payload);
    return payload;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    client.release();
  }
};

export const getDbQueryCacheStats = () => ({
  enabled: ENABLE_QUERY_CACHE,
  ttlMs: QUERY_CACHE_TTL_MS,
  maxEntries: QUERY_CACHE_MAX,
  size: queryCache.size,
  hits: cacheHits,
  misses: cacheMisses,
  sets: cacheSets,
  enforceTableAllowlist: ENFORCE_TABLE_ALLOWLIST
});

export const formatDbResultAsMarkdown = (sql, result) => {
  if (!Array.isArray(result?.rows) || result.rows.length === 0) {
    return ['### SHAKTI SAHAYATA AI', '', 'No rows returned.', '', '```sql', sql, '```'].join('\n');
  }

  const columns = Array.isArray(result.columns) && result.columns.length > 0
    ? result.columns
    : Object.keys(result.rows[0] || {});

  const escapeCell = (value) => {
    if (value === null || value === undefined) return 'null';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return text.replaceAll(/\|/g, String.raw`\|`).replaceAll(/\n/g, ' ');
  };

  const header = `| ${columns.join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const tableRows = result.rows.map((row) => `| ${columns.map((col) => escapeCell(row[col])).join(' | ')} |`);

  const notes = [`Rows returned: ${result.totalRows}`];
  if (result.truncated) notes.push(`Preview limited to: ${result.rows.length}`);

  return [
    '### SHAKTI SAHAYATA AI',
    '',
    '**SQL (Read-only) Result**',
    '',
    '```sql',
    sql,
    '```',
    '',
    header,
    divider,
    ...tableRows,
    '',
    notes.join(' | ')
  ].join('\n');
};

export const extractFirstSqlCodeBlock = (markdown = '') => {
  const text = String(markdown || '');
  const match = /```sql\s*([\s\S]*?)\s*```/i.exec(text);
  if (!match) return null;
  const sql = String(match[1] || '').trim();
  return sql || null;
};
