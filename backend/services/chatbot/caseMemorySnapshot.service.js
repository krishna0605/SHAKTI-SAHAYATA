import { createHash } from 'crypto';
import pool from '../../config/database.js';

const SNAPSHOT_VERSION = 'case-memory-v2';
const DEFAULT_SNAPSHOT_TTL_MS = Math.max(30_000, Number(process.env.CHATBOT_CASE_MEMORY_TTL_MS || 5 * 60 * 1000));

const stableStringify = (value) => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const normalizeObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export const normalizeFileIds = (fileIds = []) => {
  if (!Array.isArray(fileIds)) return [];
  return [...new Set(fileIds
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b);
};

export const buildFileScopeKey = (fileIds = []) => {
  const normalized = normalizeFileIds(fileIds);
  return normalized.length > 0 ? normalized.join(',') : '__all__';
};

export const buildFilterHash = (filters = null) => {
  const normalized = normalizeObject(filters);
  const keys = Object.keys(normalized);
  if (keys.length === 0) return 'none';
  return createHash('sha256').update(stableStringify(normalized)).digest('hex');
};

const mapSnapshotRow = (row = null) => {
  if (!row) return null;
  return {
    id: Number(row.id),
    caseId: String(row.case_id),
    module: row.module,
    view: row.view,
    snapshotKind: row.snapshot_kind,
    fileIds: Array.isArray(row.file_ids) ? row.file_ids.map((value) => Number(value)) : [],
    fileScopeKey: row.file_scope_key,
    filterHash: row.filter_hash,
    filters: normalizeObject(row.filters),
    facts: normalizeObject(row.facts),
    insights: normalizeObject(row.insights),
    artifacts: normalizeObject(row.artifacts),
    sources: normalizeObject(row.sources),
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    version: row.version || SNAPSHOT_VERSION
  };
};

export const readCaseMemorySnapshot = async ({
  caseId,
  module,
  view = 'overview',
  snapshotKind = 'module_summary',
  fileIds = [],
  filters = null
}) => {
  const normalizedCaseId = Number(caseId);
  if (!Number.isFinite(normalizedCaseId) || normalizedCaseId <= 0) return null;

  const fileScopeKey = buildFileScopeKey(fileIds);
  const filterHash = buildFilterHash(filters);
  const result = await pool.query(
    `
      SELECT *
      FROM case_memory_snapshots
      WHERE case_id = $1
        AND module = $2
        AND view = $3
        AND snapshot_kind = $4
        AND file_scope_key = $5
        AND filter_hash = $6
      LIMIT 1
    `,
    [normalizedCaseId, module, view, snapshotKind, fileScopeKey, filterHash]
  );
  return mapSnapshotRow(result.rows[0] || null);
};

export const writeCaseMemorySnapshot = async ({
  caseId,
  module,
  view = 'overview',
  snapshotKind = 'module_summary',
  fileIds = [],
  filters = null,
  facts = {},
  insights = {},
  artifacts = {},
  sources = {},
  version = SNAPSHOT_VERSION
}) => {
  const normalizedCaseId = Number(caseId);
  if (!Number.isFinite(normalizedCaseId) || normalizedCaseId <= 0) return null;

  const normalizedFileIds = normalizeFileIds(fileIds);
  const normalizedFilters = normalizeObject(filters);
  const fileScopeKey = buildFileScopeKey(normalizedFileIds);
  const filterHash = buildFilterHash(normalizedFilters);

  const result = await pool.query(
    `
      INSERT INTO case_memory_snapshots (
        case_id,
        module,
        view,
        snapshot_kind,
        file_ids,
        file_scope_key,
        filter_hash,
        filters,
        facts,
        insights,
        artifacts,
        sources,
        generated_at,
        updated_at,
        version
      )
      VALUES (
        $1, $2, $3, $4, $5::int[], $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, NOW(), NOW(), $13
      )
      ON CONFLICT (case_id, module, view, snapshot_kind, file_scope_key, filter_hash)
      DO UPDATE SET
        file_ids = EXCLUDED.file_ids,
        filters = EXCLUDED.filters,
        facts = EXCLUDED.facts,
        insights = EXCLUDED.insights,
        artifacts = EXCLUDED.artifacts,
        sources = EXCLUDED.sources,
        generated_at = NOW(),
        updated_at = NOW(),
        version = EXCLUDED.version
      RETURNING *
    `,
    [
      normalizedCaseId,
      module,
      view,
      snapshotKind,
      normalizedFileIds,
      fileScopeKey,
      filterHash,
      JSON.stringify(normalizedFilters),
      JSON.stringify(normalizeObject(facts)),
      JSON.stringify(normalizeObject(insights)),
      JSON.stringify(normalizeObject(artifacts)),
      JSON.stringify(normalizeObject(sources)),
      version
    ]
  );

  return mapSnapshotRow(result.rows[0] || null);
};

export const getOrBuildCaseMemorySnapshot = async ({
  caseId,
  module,
  view = 'overview',
  snapshotKind = 'module_summary',
  fileIds = [],
  filters = null,
  ttlMs = DEFAULT_SNAPSHOT_TTL_MS,
  builder
}) => {
  if (typeof builder !== 'function') {
    throw new Error('builder is required for getOrBuildCaseMemorySnapshot');
  }

  const existing = await readCaseMemorySnapshot({ caseId, module, view, snapshotKind, fileIds, filters });
  if (existing?.generatedAt) {
    const ageMs = Date.now() - new Date(existing.generatedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= ttlMs) {
      return {
        snapshot: existing,
        cache: 'hit'
      };
    }
  }

  const built = await builder();
  const persisted = await writeCaseMemorySnapshot({
    caseId,
    module,
    view,
    snapshotKind,
    fileIds,
    filters,
    facts: built?.facts || {},
    insights: built?.insights || {},
    artifacts: built?.artifacts || {},
    sources: built?.sources || {},
    version: built?.version || SNAPSHOT_VERSION
  });

  return {
    snapshot: persisted,
    cache: existing ? 'refresh' : 'miss'
  };
};

export const invalidateCaseMemorySnapshots = async ({ caseId, module = null } = {}) => {
  const normalizedCaseId = Number(caseId);
  if (!Number.isFinite(normalizedCaseId) || normalizedCaseId <= 0) return;

  if (module) {
    await pool.query('DELETE FROM case_memory_snapshots WHERE case_id = $1 AND module = $2', [normalizedCaseId, module]);
    return;
  }

  await pool.query('DELETE FROM case_memory_snapshots WHERE case_id = $1', [normalizedCaseId]);
};

export const buildCaseMemoryMeta = ({
  caseId,
  module,
  view,
  snapshotKind,
  fileIds = [],
  filters = null,
  cache = 'miss'
}) => ({
  version: SNAPSHOT_VERSION,
  caseId: String(caseId),
  module,
  view,
  snapshotKind,
  fileIds: normalizeFileIds(fileIds),
  fileScopeKey: buildFileScopeKey(fileIds),
  filterHash: buildFilterHash(filters),
  cache
});
