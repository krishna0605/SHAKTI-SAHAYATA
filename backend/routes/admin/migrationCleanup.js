import { Router } from 'express';
import { authenticateAdminToken } from '../../middleware/admin/authenticateAdminToken.js';
import { requireAdminPermission, requireAdminRole, requireRecentAdminAuth } from '../../middleware/admin/authorizeAdmin.js';
import { logAdminAction } from '../../services/admin/adminAudit.service.js';
import {
  deleteMigrationCleanupArtifacts,
  fetchMigrationCleanupReport,
  generateMigrationCleanupReport,
  quarantineMigrationCleanupItems,
} from '../../services/admin/adminMigrationCleanup.service.js';

const router = Router();

router.use(authenticateAdminToken);
router.use(requireAdminRole('it_admin', 'it_auditor'));
router.use(requireAdminPermission('console_access'));

router.get('/report', async (_req, res) => {
  try {
    const report = await fetchMigrationCleanupReport();
    res.json(report || { reportId: null, status: 'empty', summary: {}, items: [] });
  } catch (error) {
    console.error('[ADMIN] Migration cleanup report error:', error);
    res.status(500).json({ error: 'Failed to load migration cleanup report' });
  }
});

router.post('/inventory', requireAdminRole('it_admin'), requireRecentAdminAuth(), async (req, res) => {
  try {
    const report = await generateMigrationCleanupReport({ adminAccountId: req.admin.adminId });
    await logAdminAction({
      adminAccountId: req.admin.adminId,
      sessionId: req.admin.sessionId,
      action: 'MIGRATION_CLEANUP_INVENTORY',
      resourceType: 'migration_cleanup',
      resourceId: report?.reportId || null,
      ipAddress: req.ip,
      details: {
        summary: report?.summary || {},
      },
    });
    res.status(201).json(report);
  } catch (error) {
    console.error('[ADMIN] Migration cleanup inventory error:', error);
    res.status(500).json({ error: 'Failed to inventory migration cleanup data' });
  }
});

router.post('/quarantine', requireAdminRole('it_admin'), requireRecentAdminAuth(), async (req, res) => {
  try {
    const reportId = String(req.body?.reportId || '').trim();
    if (!reportId) {
      return res.status(400).json({ error: 'reportId is required' });
    }

    const report = await quarantineMigrationCleanupItems({
      reportId,
      adminAccountId: req.admin.adminId,
    });

    await logAdminAction({
      adminAccountId: req.admin.adminId,
      sessionId: req.admin.sessionId,
      action: 'MIGRATION_CLEANUP_QUARANTINE',
      resourceType: 'migration_cleanup',
      resourceId: reportId,
      ipAddress: req.ip,
      details: {
        status: report?.status || null,
      },
    });

    return res.json(report);
  } catch (error) {
    console.error('[ADMIN] Migration cleanup quarantine error:', error);
    return res.status(500).json({ error: 'Failed to quarantine migration cleanup items' });
  }
});

router.post('/delete', requireAdminRole('it_admin'), requireRecentAdminAuth(), async (req, res) => {
  try {
    const reportId = String(req.body?.reportId || '').trim();
    if (!reportId) {
      return res.status(400).json({ error: 'reportId is required' });
    }

    const report = await deleteMigrationCleanupArtifacts({ reportId });
    await logAdminAction({
      adminAccountId: req.admin.adminId,
      sessionId: req.admin.sessionId,
      action: 'MIGRATION_CLEANUP_DELETE',
      resourceType: 'migration_cleanup',
      resourceId: reportId,
      ipAddress: req.ip,
      details: {
        status: report?.status || null,
      },
    });
    return res.json(report);
  } catch (error) {
    console.error('[ADMIN] Migration cleanup delete error:', error);
    return res.status(500).json({ error: 'Failed to delete migration cleanup artifacts' });
  }
});

export default router;
