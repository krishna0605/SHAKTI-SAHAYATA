/* ── IPDR Routes (migrated from old project + auth) ── */
import { Router } from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
const toInt = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };
const toFloat = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* GET /api/ipdr/records?caseId=... */
router.get('/records', authenticateToken, async (req, res) => {
  const caseId = toInt(req.query.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId is required' });
  try {
    const result = await pool.query(
      'SELECT * FROM ipdr_records WHERE case_id = $1 ORDER BY created_at DESC, id DESC',
      [caseId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/ipdr/records/count?caseId=... */
router.get('/records/count', authenticateToken, async (req, res) => {
  const caseId = toInt(req.query.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId is required' });
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM ipdr_records WHERE case_id = $1', [caseId]);
    res.json({ count: result.rows[0]?.count || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* POST /api/ipdr/records — batch insert */
router.post('/records', authenticateToken, async (req, res) => {
  const { caseId, records, fileId } = req.body || {};
  const parsedCaseId = toInt(caseId);
  if (!parsedCaseId) return res.status(400).json({ error: 'caseId is required' });
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array is required' });
  }

  const batchSize = 300;
  let inserted = 0;
  try {
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const values = [];
      const placeholders = batch.map((r, idx) => {
        values.push(
          parsedCaseId, fileId || null,
          r.source_ip || null, r.destination_ip || null,
          r.source_port || null, r.destination_port || null,
          r.msisdn || r.subscriber_msisdn || null,
          r.imsi || r.subscriber_imsi || null,
          r.imei || r.subscriber_imei || null,
          r.private_ip || null, r.public_ip || null,
          r.nat_ip || null, r.nat_port || null,
          r.protocol || null,
          toInt(r.uplink_volume || r.data_volume_uplink),
          toInt(r.downlink_volume || r.data_volume_downlink),
          toInt(r.total_volume),
          r.start_time || r.session_start_time || null,
          r.end_time || r.session_end_time || null,
          r.duration || null,
          r.cell_id || r.first_cell_id || null,
          r.lac || null,
          r.domain_name || null,
          r.url || null,
          r.operator || null,
          r.raw_data ? JSON.stringify(r.raw_data) : null
        );
        const offset = idx * 26;
        return `(${Array.from({ length: 26 }, (_, j) => `$${offset + j + 1}`).join(', ')})`;
      }).join(', ');

      await pool.query(
        `INSERT INTO ipdr_records (
           case_id, file_id, source_ip, destination_ip,
           source_port, destination_port, msisdn, imsi, imei,
           private_ip, public_ip, nat_ip, nat_port,
           protocol, uplink_volume, downlink_volume, total_volume,
           start_time, end_time, duration,
           cell_id, lac, domain_name, url, operator, raw_data
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
