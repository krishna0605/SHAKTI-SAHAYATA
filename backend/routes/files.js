import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { upload, handleUploadError } from '../middleware/upload.js';
import { classifyFile, extractHeadersFromFile } from '../services/fileClassifier.js';
import { emitAdminConsoleEvent } from '../services/admin/adminEventStream.service.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || './uploads');

router.use(authenticateToken);

const normalizeExpectedType = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/^tower$/, 'tower_dump');

const resolveExpectedType = (req) =>
  normalizeExpectedType(req.body?.expectedType || req.body?.fileType || req.params?.type || '');

const buildFileResponse = (file, classification) => ({
  ...file,
  detected_type: classification?.detectedType || null,
  confidence: classification?.confidence ?? null,
  classification_result: classification?.result || null
});

const normalizeFileType = (value = '') => {
  const normalized = normalizeExpectedType(value);
  if (normalized === 'tower_dump') return 'tower';
  return normalized;
};

const ensureCaseAccess = async ({ caseId, userId, role }) => {
  if (!caseId || !userId) return false;
  if (['super_admin', 'station_admin'].includes(role)) return true;

  const result = await pool.query(
    `
      SELECT c.id
      FROM cases c
      WHERE c.id = $1
        AND (
          c.created_by_user_id = $2
          OR EXISTS (
            SELECT 1
            FROM case_assignments ca
            WHERE ca.case_id = c.id
              AND ca.user_id = $2
              AND ca.is_active = TRUE
          )
        )
      LIMIT 1
    `,
    [caseId, userId]
  );

  return result.rows.length > 0;
};

const removeUploadedFile = (filePath) => {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
};

const insertAuditLog = async ({ user, fileId, action = 'FILE_UPLOAD', details }) => {
  await pool.query(
    `
      INSERT INTO audit_logs (user_id, officer_buckle_id, officer_name, action, resource_type, resource_id, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      user.userId,
      user.buckleId,
      user.fullName,
      action,
      'file',
      String(fileId),
      JSON.stringify(details)
    ]
  );
};

const emitFileLifecycleEvents = (eventPayload = {}) => {
  emitAdminConsoleEvent('dashboard.summary.changed', eventPayload);
  emitAdminConsoleEvent('ingestion.queue.changed', eventPayload);
  emitAdminConsoleEvent('storage.changed', eventPayload);
  emitAdminConsoleEvent('logs.changed', eventPayload);
};

const listFilesForCase = async (caseId) => {
  const result = await pool.query(
    `
      SELECT uf.*, fc.detected_type, fc.confidence, fc.classification_result
      FROM uploaded_files uf
      LEFT JOIN file_classifications fc ON fc.file_id = uf.id
      WHERE uf.case_id = $1
      ORDER BY uf.uploaded_at DESC, uf.id DESC
    `,
    [caseId]
  );

  return result.rows;
};

const getFileById = async (fileId) => {
  const result = await pool.query(
    `
      SELECT
        uf.*,
        fc.expected_type,
        fc.detected_type,
        fc.confidence,
        fc.classification_result
      FROM uploaded_files uf
      LEFT JOIN file_classifications fc ON fc.file_id = uf.id
      WHERE uf.id = $1
      LIMIT 1
    `,
    [fileId]
  );

  return result.rows[0] || null;
};

router.post('/upload/:type?', upload.single('file'), handleUploadError, async (req, res) => {
  const expectedType = resolveExpectedType(req);
  const caseId = Number(req.body?.caseId || 0);

  try {
    if (!caseId || Number.isNaN(caseId)) {
      removeUploadedFile(req.file?.path);
      return res.status(400).json({ error: 'caseId is required' });
    }

    if (!expectedType) {
      removeUploadedFile(req.file?.path);
      return res.status(400).json({ error: 'expectedType or fileType is required' });
    }

    const canAccess = await ensureCaseAccess({
      caseId,
      userId: req.user.userId,
      role: req.user.role
    });

    if (!canAccess) {
      removeUploadedFile(req.file?.path);
      return res.status(403).json({ error: 'No access to this case' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const headers = extractHeadersFromFile(req.file.path, expectedType);
    const classification = classifyFile(headers, expectedType);

    if (classification.result !== 'ACCEPTED') {
      removeUploadedFile(req.file?.path);
      return res.status(400).json({
        error: classification.message,
        headers,
        classification
      });
    }

    const fileResult = await pool.query(
      `
        INSERT INTO uploaded_files (
          case_id,
          file_name,
          original_name,
          file_type,
          file_size,
          mime_type,
          parse_status,
          uploaded_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        caseId,
        req.file.filename,
        req.file.originalname,
        classification.detectedType || expectedType,
        req.file.size,
        req.file.mimetype,
        'pending',
        req.user.userId
      ]
    );

    const fileRecord = fileResult.rows[0];

    await pool.query(
      `
        INSERT INTO file_classifications (
          file_id,
          expected_type,
          detected_type,
          confidence,
          all_scores,
          matched_columns,
          total_columns,
          classification_result,
          error_message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        fileRecord.id,
        expectedType,
        classification.detectedType || null,
        classification.confidence || null,
        JSON.stringify(classification.scores || {}),
        classification.matchedColumns || null,
        classification.totalColumns || null,
        classification.result,
        classification.message || null
      ]
    );

    await insertAuditLog({
      user: req.user,
      fileId: fileRecord.id,
      details: {
        caseId,
        fileName: req.file.originalname,
        expectedType,
        detectedType: classification.detectedType,
        result: classification.result,
        confidence: classification.confidence,
        headers
      }
    });

    const payload = buildFileResponse(fileRecord, classification);
    emitFileLifecycleEvents({
      fileId: fileRecord.id,
      caseId,
      action: 'uploaded',
      classificationResult: classification.result,
    });
    res.status(classification.result === 'ACCEPTED' ? 201 : 400).json({
      ...payload,
      file: payload,
      headers,
      classification
    });
  } catch (err) {
    console.error('[FILES] Upload error:', err.message);
    removeUploadedFile(req.file?.path);
    res.status(500).json({ error: 'File upload failed' });
  }
});

router.get('/', async (req, res) => {
  const caseId = Number(req.query.caseId || 0);

  try {
    if (!caseId || Number.isNaN(caseId)) {
      return res.status(400).json({ error: 'caseId is required' });
    }

    const canAccess = await ensureCaseAccess({
      caseId,
      userId: req.user.userId,
      role: req.user.role
    });

    if (!canAccess) {
      return res.status(403).json({ error: 'No access to this case' });
    }

    const rows = await listFilesForCase(caseId);
    res.json(rows);
  } catch (err) {
    console.error('[FILES] List error:', err.message);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

router.delete('/:fileId', async (req, res) => {
  const fileId = Number(req.params.fileId || 0);

  try {
    if (!fileId || Number.isNaN(fileId)) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const fileRecord = await getFileById(fileId);
    if (!fileRecord) {
      return res.status(404).json({ error: 'File not found' });
    }

    const canAccess = await ensureCaseAccess({
      caseId: fileRecord.case_id,
      userId: req.user.userId,
      role: req.user.role
    });

    if (!canAccess) {
      return res.status(403).json({ error: 'No access to this case' });
    }

    const caseLockResult = await pool.query(
      'SELECT is_evidence_locked, lock_reason FROM cases WHERE id = $1 LIMIT 1',
      [fileRecord.case_id]
    );

    if (caseLockResult.rows[0]?.is_evidence_locked) {
      return res.status(423).json({
        error: 'Case is evidence-locked for legal proceedings',
        reason: caseLockResult.rows[0].lock_reason,
        message: 'Contact Super Admin to unlock'
      });
    }

    const db = await pool.connect();
    let deletedRecords = 0;

    try {
      await db.query('BEGIN');

      const telecomTables = [
        'cdr_records',
        'ipdr_records',
        'sdr_records',
        'tower_dump_records',
        'ild_records',
      ];

      for (const tableName of telecomTables) {
        const deletion = await db.query(`DELETE FROM ${tableName} WHERE file_id = $1 RETURNING id`, [fileId]);
        deletedRecords += deletion.rowCount || 0;
      }

      await db.query('DELETE FROM file_classifications WHERE file_id = $1', [fileId]);

      const deletedFile = await db.query(
        'DELETE FROM uploaded_files WHERE id = $1 RETURNING id',
        [fileId]
      );

      if ((deletedFile.rowCount || 0) === 0) {
        throw new Error('Uploaded file could not be deleted');
      }

      await db.query(
        `
          INSERT INTO audit_logs (user_id, officer_buckle_id, officer_name, action, resource_type, resource_id, details)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          req.user.userId,
          req.user.buckleId,
          req.user.fullName,
          'FILE_DELETE',
          'file',
          String(fileId),
          JSON.stringify({
            caseId: fileRecord.case_id,
            fileName: fileRecord.original_name,
            storedFileName: fileRecord.file_name,
            deletedRecords,
            deletedType: normalizeFileType(
              fileRecord.detected_type || fileRecord.expected_type || fileRecord.file_type
            ),
          }),
        ]
      );

      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }

    removeUploadedFile(path.join(uploadDir, fileRecord.file_name));

    emitFileLifecycleEvents({
      fileId,
      caseId: fileRecord.case_id,
      action: 'deleted',
    });

    return res.json({
      fileId,
      deleted: true,
      deletedRecords,
      deletedType: normalizeFileType(
        fileRecord.detected_type || fileRecord.expected_type || fileRecord.file_type
      ),
    });
  } catch (err) {
    console.error('[FILES] Delete error:', err.message);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});

router.get('/download-url', async (req, res) => {
  const relativePath = String(req.query.path || '').trim();
  if (!relativePath) return res.status(400).json({ error: 'path is required' });

  const safePath = path.basename(relativePath);
  res.json({ url: `/uploads/${safePath}` });
});

router.get('/:caseId', async (req, res) => {
  const caseId = Number(req.params.caseId || 0);

  try {
    if (!caseId || Number.isNaN(caseId)) {
      return res.status(400).json({ error: 'caseId is required' });
    }

    const canAccess = await ensureCaseAccess({
      caseId,
      userId: req.user.userId,
      role: req.user.role
    });

    if (!canAccess) {
      return res.status(403).json({ error: 'No access to this case' });
    }

    const rows = await listFilesForCase(caseId);
    res.json({ files: rows });
  } catch (err) {
    console.error('[FILES] List error:', err.message);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

export default router;
