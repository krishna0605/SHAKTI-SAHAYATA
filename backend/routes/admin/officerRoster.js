import { Router } from 'express';
import multer from 'multer';
import { authenticateAdminToken } from '../../middleware/admin/authenticateAdminToken.js';
import { requireAdminPermission } from '../../middleware/admin/authorizeAdmin.js';
import { logAdminAction } from '../../services/admin/adminAudit.service.js';
import { importOfficerRoster, listOfficerRosterImports } from '../../services/officerRoster.service.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

router.use(authenticateAdminToken);

router.get(
  '/imports',
  requireAdminPermission('manage_officer_roster', 'view_officer_roster'),
  async (req, res) => {
    try {
      const imports = await listOfficerRosterImports({
        limit: Number(req.query.limit) || 20,
      });
      return res.json({
        imports,
        total: imports.length,
      });
    } catch (error) {
      console.error('[ADMIN] Failed to list officer roster imports:', error);
      return res.status(500).json({ error: 'Failed to load officer roster imports.' });
    }
  }
);

router.post(
  '/import',
  requireAdminPermission('manage_officer_roster'),
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

      const fullSync = parseBoolean(req.body?.fullSync, false);
      const result = await importOfficerRoster({
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        adminAccountId: req.admin?.id || null,
        fullSync,
      });

      await logAdminAction({
        adminAccountId: req.admin?.id || null,
        sessionId: req.admin?.sessionId || null,
        action: 'OFFICER_ROSTER_IMPORT',
        resourceType: 'officer_roster',
        resourceId: result.importId ? String(result.importId) : null,
        details: {
          fileName: result.fileName,
          totalRows: result.totalRows,
          inserted: result.inserted,
          updated: result.updated,
          deactivated: result.deactivated,
          skipped: result.skipped,
          invalid: result.invalid,
          fullSync: result.fullSync,
        },
        ipAddress: req.ip,
      });

      return res.status(201).json(result);
    } catch (error) {
      console.error('[ADMIN] Officer roster import failed:', error);
      const message = error?.message || 'Failed to import officer roster.';
      const status = /Missing required columns|Roster file is empty|worksheet|Invalid file type/i.test(message) ? 400 : 500;
      return res.status(status).json({ error: message });
    }
  }
);

export default router;
