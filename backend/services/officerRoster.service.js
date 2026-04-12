import crypto from 'node:crypto';
import XLSX from 'xlsx';
import pool from '../config/database.js';

const HEADER_ALIASES = new Map([
  ['buckleid', 'buckle_id'],
  ['buckle_id', 'buckle_id'],
  ['buckle_no', 'buckle_id'],
  ['bucklenumber', 'buckle_id'],
  ['buckleno', 'buckle_id'],
  ['fullname', 'full_name'],
  ['full_name', 'full_name'],
  ['name', 'full_name'],
  ['email', 'email'],
  ['emailid', 'email'],
  ['email_id', 'email'],
  ['mail', 'email'],
  ['phonenumber', 'phone_number'],
  ['phone_number', 'phone_number'],
  ['phone', 'phone_number'],
  ['phoneno', 'phone_number'],
  ['phone_no', 'phone_number'],
  ['mobile', 'phone_number'],
  ['mobilenumber', 'phone_number'],
  ['department', 'department'],
  ['station', 'station'],
  ['position', 'position'],
  ['rank', 'rank'],
  ['isactive', 'is_active'],
  ['is_active', 'is_active'],
  ['active', 'is_active'],
]);

export const REQUIRED_ROSTER_COLUMNS = ['buckle_id', 'full_name', 'email', 'phone_number'];

export const normalizeRosterHeader = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const resolveRosterColumn = (value) => {
  const normalized = normalizeRosterHeader(value).replace(/_/g, '');
  return HEADER_ALIASES.get(normalized) || HEADER_ALIASES.get(normalizeRosterHeader(value)) || null;
};

export const normalizeBuckleId = (value) => String(value || '').trim().toUpperCase();
export const normalizeRosterEmail = (value) => String(value || '').trim().toLowerCase();
export const normalizeRosterPhoneNumber = (value) => {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const normalizeRosterBoolean = (value, fallback = true) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'active'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'inactive'].includes(normalized)) return false;
  return fallback;
};

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const isValidPhone = (value) => String(value || '').trim().length >= 10;

const mapWorkbookRows = (buffer, fileName) => {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Roster file does not contain any worksheet.');
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!rawRows.length) {
    throw new Error('Roster file is empty or has no data rows.');
  }

  const rawHeaders = Object.keys(rawRows[0]);
  const headerMap = {};
  for (const rawHeader of rawHeaders) {
    const resolved = resolveRosterColumn(rawHeader);
    if (resolved) {
      headerMap[rawHeader] = resolved;
    }
  }

  const mappedColumns = new Set(Object.values(headerMap));
  const missingRequired = REQUIRED_ROSTER_COLUMNS.filter((column) => !mappedColumns.has(column));
  if (missingRequired.length) {
    throw new Error(`Missing required columns: ${missingRequired.join(', ')}`);
  }

  const rows = rawRows.map((rawRow, index) => {
    const mappedRow = {
      rowNumber: index + 2,
      buckle_id: '',
      full_name: '',
      email: '',
      phone_number: '',
      department: '',
      station: '',
      position: '',
      rank: '',
      is_active: true,
    };

    for (const [rawHeader, resolvedHeader] of Object.entries(headerMap)) {
      const rawValue = rawRow[rawHeader];
      if (resolvedHeader === 'is_active') {
        mappedRow.is_active = normalizeRosterBoolean(rawValue, true);
        continue;
      }

      const textValue = String(rawValue ?? '').trim();
      mappedRow[resolvedHeader] = textValue;
    }

    mappedRow.buckle_id = normalizeBuckleId(mappedRow.buckle_id);
    mappedRow.email = normalizeRosterEmail(mappedRow.email);
    mappedRow.phone_number = normalizeRosterPhoneNumber(mappedRow.phone_number);
    mappedRow.full_name = String(mappedRow.full_name || '').trim();
    mappedRow.department = String(mappedRow.department || '').trim();
    mappedRow.station = String(mappedRow.station || '').trim();
    mappedRow.position = String(mappedRow.position || '').trim();
    mappedRow.rank = String(mappedRow.rank || '').trim();

    return mappedRow;
  });

  return {
    fileName,
    headerMap,
    rawHeaders,
    rows,
  };
};

export const parseOfficerRosterBuffer = ({ buffer, fileName }) => mapWorkbookRows(buffer, fileName);

export const validateOfficerRosterCredentials = async ({ buckleId, email, phoneNumber = null }) => {
  const normalizedBuckleId = normalizeBuckleId(buckleId);
  const normalizedEmail = normalizeRosterEmail(email);
  const normalizedPhone = phoneNumber === null || phoneNumber === undefined
    ? null
    : normalizeRosterPhoneNumber(phoneNumber);

  const result = await pool.query(
    `
      SELECT
        id,
        buckle_id,
        full_name,
        email,
        phone_number,
        position,
        department,
        station,
        rank,
        is_active
      FROM officers
      WHERE buckle_id = $1
      LIMIT 1
    `,
    [normalizedBuckleId]
  );

  const officer = result.rows[0];
  if (!officer || !officer.is_active) {
    return {
      ok: false,
      status: 403,
      code: 'BUCKLE_ID_INVALID',
      error: 'Buckle ID is wrong',
    };
  }

  if (normalizeRosterEmail(officer.email) !== normalizedEmail) {
    return {
      ok: false,
      status: 401,
      code: 'OFFICER_CREDENTIAL_MISMATCH',
      error: 'Your credentials are wrong',
    };
  }

  if (normalizedPhone !== null && normalizeRosterPhoneNumber(officer.phone_number) !== normalizedPhone) {
    return {
      ok: false,
      status: 401,
      code: 'OFFICER_CREDENTIAL_MISMATCH',
      error: 'Your credentials are wrong',
    };
  }

  return {
    ok: true,
    officer,
  };
};

export const importOfficerRoster = async ({
  buffer,
  fileName,
  adminAccountId = null,
  importedByUserId = null,
  fullSync = false,
}) => {
  const { rows, rawHeaders, headerMap } = parseOfficerRosterBuffer({ buffer, fileName });
  const client = await pool.connect();

  const seenBuckleIds = new Set();
  const importedBuckleIds = new Set();
  const validationErrors = [];
  const changes = [];

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let invalid = 0;
  let duplicateBuckleCount = 0;
  let missingBuckleCount = 0;
  let deactivated = 0;

  try {
    await client.query('BEGIN');

    for (const row of rows) {
      if (!row.buckle_id) {
        missingBuckleCount += 1;
        skipped += 1;
        validationErrors.push({
          rowNumber: row.rowNumber,
          code: 'MISSING_BUCKLE_ID',
          message: 'Row is missing buckle_id.',
        });
        continue;
      }

      if (seenBuckleIds.has(row.buckle_id)) {
        duplicateBuckleCount += 1;
        skipped += 1;
        validationErrors.push({
          rowNumber: row.rowNumber,
          buckleId: row.buckle_id,
          code: 'DUPLICATE_BUCKLE_ID',
          message: 'Duplicate buckle_id found in the same roster file.',
        });
        continue;
      }

      seenBuckleIds.add(row.buckle_id);

      const rowErrors = [];
      if (!row.full_name) rowErrors.push('full_name is required');
      if (!row.email || !isValidEmail(row.email)) rowErrors.push('valid email is required');
      if (!row.phone_number || !isValidPhone(row.phone_number)) rowErrors.push('valid phone_number is required');

      if (rowErrors.length) {
        invalid += 1;
        skipped += 1;
        validationErrors.push({
          rowNumber: row.rowNumber,
          buckleId: row.buckle_id,
          code: 'INVALID_ROW',
          message: rowErrors.join('; '),
        });
        continue;
      }

      const result = await client.query(
        `
          INSERT INTO officers (
            buckle_id,
            full_name,
            phone_number,
            position,
            department,
            station,
            email,
            rank,
            is_active,
            imported_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
          ON CONFLICT (buckle_id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            phone_number = EXCLUDED.phone_number,
            position = EXCLUDED.position,
            department = EXCLUDED.department,
            station = EXCLUDED.station,
            email = EXCLUDED.email,
            rank = EXCLUDED.rank,
            is_active = EXCLUDED.is_active,
            updated_at = NOW()
          RETURNING id, buckle_id, (xmax = 0) AS inserted
        `,
        [
          row.buckle_id,
          row.full_name,
          row.phone_number,
          row.position || null,
          row.department || null,
          row.station || null,
          row.email,
          row.rank || null,
          row.is_active,
        ]
      );

      importedBuckleIds.add(row.buckle_id);
      const wasInserted = Boolean(result.rows[0]?.inserted);
      if (wasInserted) {
        inserted += 1;
      } else {
        updated += 1;
      }

      if (changes.length < 100) {
        changes.push({
          buckleId: row.buckle_id,
          action: wasInserted ? 'inserted' : 'updated',
          email: row.email,
          phoneNumber: row.phone_number,
          department: row.department || null,
          station: row.station || null,
        });
      }
    }

    if (fullSync && importedBuckleIds.size > 0) {
      const deactivateResult = await client.query(
        `
          UPDATE officers
          SET is_active = FALSE, updated_at = NOW()
          WHERE is_active = TRUE
            AND NOT (buckle_id = ANY($1::varchar[]))
        `,
        [Array.from(importedBuckleIds)]
      );
      deactivated = deactivateResult.rowCount || 0;
    }

    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const importResult = await client.query(
      `
        INSERT INTO officer_imports (
          imported_by,
          imported_by_admin_account_id,
          file_checksum,
          original_filename,
          total_rows,
          new_count,
          updated_count,
          deactivated_count,
          skipped_count,
          invalid_count,
          duplicate_buckle_count,
          missing_buckle_count,
          error_count,
          changes_json,
          validation_errors,
          import_mode,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, 'applied')
        RETURNING id, created_at
      `,
      [
        importedByUserId,
        adminAccountId,
        checksum,
        fileName,
        rows.length,
        inserted,
        updated,
        deactivated,
        skipped,
        invalid,
        duplicateBuckleCount,
        missingBuckleCount,
        validationErrors.length,
        JSON.stringify({
          rawHeaders,
          headerMap,
          sampleChanges: changes,
        }),
        JSON.stringify(validationErrors),
        fullSync ? 'full_sync' : 'merge',
      ]
    );

    await client.query('COMMIT');

    return {
      importId: importResult.rows[0]?.id ?? null,
      createdAt: importResult.rows[0]?.created_at ?? null,
      fileName,
      totalRows: rows.length,
      inserted,
      updated,
      deactivated,
      skipped,
      invalid,
      duplicateBuckleCount,
      missingBuckleCount,
      fullSync,
      errors: validationErrors.slice(0, 50),
      message: `Processed ${rows.length} roster rows: ${inserted} inserted, ${updated} updated, ${deactivated} deactivated, ${skipped} skipped.`,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const listOfficerRosterImports = async ({ limit = 20 } = {}) => {
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const result = await pool.query(
    `
      SELECT
        oi.id,
        oi.original_filename,
        oi.total_rows,
        oi.new_count,
        oi.updated_count,
        oi.deactivated_count,
        oi.skipped_count,
        oi.invalid_count,
        oi.duplicate_buckle_count,
        oi.missing_buckle_count,
        oi.error_count,
        oi.import_mode,
        oi.status,
        oi.validation_errors,
        oi.created_at,
        aa.id AS imported_by_admin_account_id,
        aa.email AS imported_by_admin_email,
        aa.full_name AS imported_by_admin_name
      FROM officer_imports oi
      LEFT JOIN admin_accounts aa ON aa.id = oi.imported_by_admin_account_id
      ORDER BY oi.created_at DESC, oi.id DESC
      LIMIT $1
    `,
    [normalizedLimit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    originalFilename: row.original_filename,
    totalRows: row.total_rows,
    inserted: row.new_count,
    updated: row.updated_count,
    deactivated: row.deactivated_count,
    skipped: row.skipped_count || 0,
    invalid: row.invalid_count || 0,
    duplicateBuckleCount: row.duplicate_buckle_count || 0,
    missingBuckleCount: row.missing_buckle_count || 0,
    errorCount: row.error_count || 0,
    importMode: row.import_mode || 'merge',
    status: row.status,
    importedByAdminAccountId: row.imported_by_admin_account_id || null,
    importedByAdminEmail: row.imported_by_admin_email || null,
    importedByAdminName: row.imported_by_admin_name || null,
    createdAt: row.created_at,
    errors: Array.isArray(row.validation_errors) ? row.validation_errors : [],
  }));
};
