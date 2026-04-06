/* ── Settings Routes ── */
import { Router } from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';

const router = Router();

/* GET /api/settings — get all settings */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM app_settings ORDER BY key');
    const settings = {};
    result.rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* POST /api/settings — upsert a setting (admin only) */
router.post('/', authenticateToken, requireRole('super_admin', 'station_admin'), async (req, res) => {
  try {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key is required' });

    const result = await pool.query(
      `
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        RETURNING *
      `,
      [key, typeof value === 'string' ? value : JSON.stringify(value)]
    );

    res.status(201).json({ saved: true, id: result.rows[0].id, setting: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* PUT /api/settings/:key — update a setting (admin only) */
router.put('/:key', authenticateToken, requireRole('super_admin', 'station_admin'), async (req, res) => {
  try {
    const { value } = req.body;
    const result = await pool.query(
      'UPDATE app_settings SET value = $1, updated_at = NOW() WHERE key = $2 RETURNING *',
      [JSON.stringify(value), req.params.key]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Setting not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* POST /api/settings/reset — compatibility no-op reset hook */
router.post('/reset', authenticateToken, requireRole('super_admin', 'station_admin'), async (_req, res) => {
  res.json({ success: true, message: 'Settings reset endpoint is available. No destructive reset was performed.' });
});

export default router;
