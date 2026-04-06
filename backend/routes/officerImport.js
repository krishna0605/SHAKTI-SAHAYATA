/**
 * Officer Import Route — Phase 1 Buckle ID Excel Import
 * POST /api/officers/import
 *
 * Accepts an .xlsx file with officer data, validates columns,
 * upserts into the officers table, and logs to officer_imports.
 */
import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Auto-create tables if they don't exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS officers (
        id SERIAL PRIMARY KEY,
        buckle_id VARCHAR(100) UNIQUE NOT NULL,
        full_name VARCHAR(255),
        phone_number VARCHAR(50),
        position VARCHAR(255),
        department VARCHAR(255),
        station VARCHAR(255),
        email VARCHAR(255),
        rank VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS officer_imports (
        id SERIAL PRIMARY KEY,
        imported_by INTEGER,
        file_name VARCHAR(500),
        total_rows INTEGER DEFAULT 0,
        inserted_count INTEGER DEFAULT 0,
        updated_count INTEGER DEFAULT 0,
        skipped_count INTEGER DEFAULT 0,
        errors JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[Officers] Tables ready');
  } catch (err) {
    console.warn('[Officers] Table auto-create skipped:', err.message);
  }
})();

// Required columns in the Excel file (case-insensitive match)
const REQUIRED_COLUMNS = ['buckle_id', 'full_name'];
const OPTIONAL_COLUMNS = ['phone_number', 'position', 'department', 'station', 'email', 'rank'];

/** Normalize header to snake_case for matching */
const normalizeHeader = (h) =>
  h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

/**
 * POST /api/officers/import
 * Body: multipart/form-data with field "file" (.xlsx)
 * Auth: admin only
 */
router.post(
  '/import',
  authenticateToken,
  requireRole('admin', 'super_admin'),
  upload.single('file'),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const ext = req.file.originalname.split('.').pop()?.toLowerCase();
      if (!['xlsx', 'xls', 'csv'].includes(ext)) {
        return res.status(400).json({ error: 'Invalid file type. Accepted: .xlsx, .xls, .csv' });
      }

      // Parse Excel
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!rawRows.length) {
        return res.status(400).json({ error: 'Excel file is empty or has no data rows' });
      }

      // Map raw headers to normalized column names
      const rawHeaders = Object.keys(rawRows[0]);
      const headerMap = {}; // rawHeader -> normalizedName
      for (const rh of rawHeaders) {
        const norm = normalizeHeader(rh);
        if (REQUIRED_COLUMNS.includes(norm) || OPTIONAL_COLUMNS.includes(norm)) {
          headerMap[rh] = norm;
        }
      }

      // Validate required columns
      const mappedColumns = new Set(Object.values(headerMap));
      const missingRequired = REQUIRED_COLUMNS.filter((col) => !mappedColumns.has(col));
      if (missingRequired.length) {
        return res.status(400).json({
          error: `Missing required columns: ${missingRequired.join(', ')}`,
          detectedColumns: rawHeaders,
          expectedRequired: REQUIRED_COLUMNS,
        });
      }

      // Process rows
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      const errors = [];

      await client.query('BEGIN');

      for (let i = 0; i < rawRows.length; i++) {
        const raw = rawRows[i];
        const row = {};
        for (const [rh, norm] of Object.entries(headerMap)) {
          row[norm] = String(raw[rh] ?? '').trim();
        }

        // Skip empty buckle_id
        if (!row.buckle_id) {
          skipped++;
          continue;
        }

        try {
          // Upsert: INSERT ... ON CONFLICT (buckle_id) DO UPDATE
          const result = await client.query(
            `INSERT INTO officers (buckle_id, full_name, phone_number, position, department, station, email, rank)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (buckle_id) DO UPDATE SET
               full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), officers.full_name),
               phone_number = COALESCE(NULLIF(EXCLUDED.phone_number, ''), officers.phone_number),
               position = COALESCE(NULLIF(EXCLUDED.position, ''), officers.position),
               department = COALESCE(NULLIF(EXCLUDED.department, ''), officers.department),
               station = COALESCE(NULLIF(EXCLUDED.station, ''), officers.station),
               email = COALESCE(NULLIF(EXCLUDED.email, ''), officers.email),
               rank = COALESCE(NULLIF(EXCLUDED.rank, ''), officers.rank),
               updated_at = NOW()
             RETURNING (xmax = 0) AS is_insert`,
            [
              row.buckle_id,
              row.full_name || null,
              row.phone_number || null,
              row.position || null,
              row.department || null,
              row.station || null,
              row.email || null,
              row.rank || null,
            ]
          );

          if (result.rows[0]?.is_insert) {
            inserted++;
          } else {
            updated++;
          }
        } catch (rowErr) {
          errors.push({ row: i + 2, buckle_id: row.buckle_id, error: rowErr.message });
          skipped++;
        }
      }

      // Log the import
      await client.query(
        `INSERT INTO officer_imports (imported_by, file_name, total_rows, inserted_count, updated_count, skipped_count, errors)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user.id || req.user.sub,
          req.file.originalname,
          rawRows.length,
          inserted,
          updated,
          skipped,
          errors.length ? JSON.stringify(errors) : null,
        ]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        file: req.file.originalname,
        totalRows: rawRows.length,
        inserted,
        updated,
        skipped,
        errors: errors.length ? errors.slice(0, 10) : [],
        message: `Processed ${rawRows.length} rows: ${inserted} inserted, ${updated} updated, ${skipped} skipped`,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/officers — List all officers
 * Auth: all authenticated users
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, buckle_id, full_name, phone_number, position, department, station, email, rank, created_at FROM officers ORDER BY full_name'
    );
    res.json({ officers: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/officers/imports — List import logs
 * Auth: admin only
 */
router.get(
  '/imports',
  authenticateToken,
  requireRole('admin', 'super_admin'),
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT oi.*, u.full_name as imported_by_name
         FROM officer_imports oi
         LEFT JOIN users u ON oi.imported_by = u.id
         ORDER BY oi.created_at DESC
         LIMIT 50`
      );
      res.json({ imports: rows });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
