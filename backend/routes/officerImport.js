import { Router } from 'express';
import multer from 'multer';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import { importOfficerRoster, listOfficerRosterImports } from '../services/officerRoster.service.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

router.post(
  '/import',
  authenticateToken,
  requireRole('admin', 'super_admin'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Roster file is required.' });
      }

      const extension = String(req.file.originalname.split('.').pop() || '').trim().toLowerCase();
      if (!['xlsx', 'xls', 'csv'].includes(extension)) {
        return res.status(400).json({ error: 'Invalid file type. Accepted: .xlsx, .xls, .csv' });
      }

      const result = await importOfficerRoster({
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        importedByUserId: req.user?.userId || req.user?.id || null,
        fullSync: parseBoolean(req.body?.fullSync, false),
      });

      return res.status(201).json(result);
    } catch (error) {
      console.error('[OFFICERS] Legacy import route failed:', error);
      const message = error?.message || 'Officer import failed.';
      const status = /Missing required columns|Roster file is empty|worksheet|Invalid file type/i.test(message) ? 400 : 500;
      return res.status(status).json({ error: message });
    }
  }
);

router.get('/', authenticateToken, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, buckle_id, full_name, phone_number, position, department, station, email, rank, is_active, created_at
        FROM officers
        ORDER BY full_name, buckle_id
      `
    );
    return res.json({ officers: rows, total: rows.length });
  } catch (error) {
    console.error('[OFFICERS] Failed to list officers:', error);
    return res.status(500).json({ error: 'Failed to load officers.' });
  }
});

router.get(
  '/imports',
  authenticateToken,
  requireRole('admin', 'super_admin'),
  async (req, res) => {
    try {
      const imports = await listOfficerRosterImports({
        limit: Number(req.query.limit) || 50,
      });
      return res.json({ imports, total: imports.length });
    } catch (error) {
      console.error('[OFFICERS] Failed to list officer imports:', error);
      return res.status(500).json({ error: 'Failed to load officer import history.' });
    }
  }
);

export default router;
