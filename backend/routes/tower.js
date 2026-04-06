/* ── Tower Dump Routes (migrated + auth) ── */
import { Router } from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
const toInt = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };

/* GET /api/tower/records?caseId=... */
router.get('/records', authenticateToken, async (req, res) => {
  const caseId = toInt(req.query.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId is required' });
  try {
    const result = await pool.query(
      'SELECT * FROM tower_dump_records WHERE case_id = $1 ORDER BY created_at DESC, id DESC',
      [caseId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/tower/records/count?caseId=... */
router.get('/records/count', authenticateToken, async (req, res) => {
  const caseId = toInt(req.query.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId is required' });
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM tower_dump_records WHERE case_id = $1', [caseId]);
    res.json({ count: result.rows[0]?.count || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* POST /api/tower/records — batch insert */
router.post('/records', authenticateToken, async (req, res) => {
  const { caseId, records, fileId } = req.body || {};
  const parsedCaseId = toInt(caseId);
  if (!parsedCaseId) return res.status(400).json({ error: 'caseId is required' });
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array is required' });
  }

  const batchSize = 500;
  let inserted = 0;
  try {
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const values = [];
      const placeholders = batch.map((r, idx) => {
        values.push(
          parsedCaseId, fileId || null,
          r.a_party || null, r.b_party || null,
          r.call_date || null, r.call_time || null,
          r.call_type || null,
          r.duration_sec ? parseInt(String(r.duration_sec), 10) || 0 : 0,
          r.imei || null, r.imsi || null,
          r.first_cell_id || r.cell_id || null,
          r.last_cell_id || null,
          r.cell_id || null, r.lac || null,
          r.lat != null ? parseFloat(r.lat) : null,
          r.long != null ? parseFloat(r.long) : null,
          r.azimuth || null,
          r.site_name || null, r.site_address || null,
          r.operator || null,
          r.raw_data ? JSON.stringify(r.raw_data) : null
        );
        const offset = idx * 21;
        return `(${Array.from({ length: 21 }, (_, j) => `$${offset + j + 1}`).join(', ')})`;
      }).join(', ');

      await pool.query(
        `INSERT INTO tower_dump_records (
           case_id, file_id, a_party, b_party,
           call_date, call_time, call_type, duration_sec,
           imei, imsi, first_cell_id, last_cell_id,
           cell_id, lac, lat, long, azimuth,
           site_name, site_address, operator, raw_data
         ) VALUES ${placeholders}`,
        values
      );
      inserted += batch.length;
    }
    res.json({ inserted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
