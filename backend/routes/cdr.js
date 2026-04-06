/* ── CDR Routes (migrated from old project + auth) ── */
import { Router } from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

const toInt = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
};

const parseDate = (dateStr) => {
  if (!dateStr || dateStr === '-') return null;
  const match1 = String(dateStr).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match1) {
    const [, day, month, year] = match1;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const match2 = String(dateStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match2) {
    const [, year, month, day] = match2;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const match3 = String(dateStr).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (match3) {
    const [, day, monthStr, yearStr] = match3;
    const month = months[monthStr.toLowerCase()] || '01';
    const year = yearStr.length === 2 ? `20${yearStr}` : yearStr;
    return `${year}-${month}-${day.padStart(2, '0')}`;
  }
  return null;
};

/* GET /api/cdr/records?caseId=...
   Returns columns aliased for backward compat with frontend analysis components */
router.get('/records', authenticateToken, async (req, res) => {
  const caseId = toInt(req.query.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId is required' });
  try {
    const result = await pool.query(
      `SELECT *, calling_number AS a_party, called_number AS b_party
       FROM cdr_records WHERE case_id = $1 ORDER BY created_at DESC, id DESC`,
      [caseId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/cdr/records/count?caseId=... */
router.get('/records/count', authenticateToken, async (req, res) => {
  const caseId = toInt(req.query.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId is required' });
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM cdr_records WHERE case_id = $1', [caseId]);
    res.json({ count: result.rows[0]?.count || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/cdr/records/unique-a?caseId=... */
router.get('/records/unique-a', authenticateToken, async (req, res) => {
  const caseId = toInt(req.query.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId is required' });
  try {
    const result = await pool.query(
      `SELECT DISTINCT calling_number AS a_party FROM cdr_records
       WHERE case_id = $1 AND calling_number IS NOT NULL AND calling_number <> ''
       ORDER BY calling_number`,
      [caseId]
    );
    res.json(result.rows.map(r => r.a_party));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* POST /api/cdr/records — batch insert
   Accepts both old format (a_party/b_party) and new format (calling_number/called_number) */
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
      const placeholders = batch.map((record, index) => {
        const durationSec = record.duration_sec || record.duration ? parseInt(String(record.duration_sec || record.duration), 10) || 0 : 0;
        const recordFileId = record.file_id || fileId || null;
        values.push(
          parsedCaseId, recordFileId,
          record.calling_number || record.a_party || '',
          record.called_number || record.b_party || null,
          record.call_type || null, record.call_time || record.toc || null,
          parseDate(record.call_date), durationSec,
          record.first_cell_id || null, record.last_cell_id || null,
          record.imei_a || record.imei || null,
          record.imei_b || null,
          record.cell_id_a || null, record.cell_id_b || null,
          record.roaming || null,
          record.operator || 'UNKNOWN',
          record.lat != null ? parseFloat(record.lat) : null,
          record.long != null ? parseFloat(record.long) : null
        );
        const offset = index * 18;
        return `(${Array.from({ length: 18 }, (_, j) => `$${offset + j + 1}`).join(', ')})`;
      }).join(', ');

      await pool.query(
        `INSERT INTO cdr_records (
           case_id, file_id, calling_number, called_number,
           call_type, call_time, call_date, duration_sec,
           first_cell_id, last_cell_id, imei_a, imei_b,
           cell_id_a, cell_id_b, roaming, operator, lat, long
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
