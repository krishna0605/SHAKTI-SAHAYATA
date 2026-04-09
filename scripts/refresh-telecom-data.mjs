import pool from '../backend/config/database.js';
import {
  combineDateAndTime,
  normalizeDateString,
  normalizeTimeString,
  parseLooseTimestamp,
} from '../backend/utils/timestamps.js';

const normalizeCdrRow = (row) => ({
  call_date: normalizeDateString(row.call_date),
  call_time: normalizeTimeString(row.call_time) || null,
  date_time: combineDateAndTime(row.call_date, row.call_time),
});

const normalizeIldRow = (row) => ({
  call_date: normalizeDateString(row.call_date),
  call_time: normalizeTimeString(row.call_time) || null,
  date_time: combineDateAndTime(row.call_date, row.call_time),
});

const normalizeTowerRow = (row) => {
  const call_date = normalizeDateString(row.call_date);
  const call_time = normalizeTimeString(row.call_time) || null;
  const start_time = parseLooseTimestamp(row.start_time) || combineDateAndTime(row.call_date, row.call_time);

  return { call_date, call_time, start_time };
};

const normalizeIpdrRow = (row) => ({
  start_time: parseLooseTimestamp(row.start_time) || row.start_time || null,
  end_time: parseLooseTimestamp(row.end_time) || row.end_time || null,
});

const valuesChanged = (current, next) => {
  const normalizedCurrent = current == null ? null : String(current);
  const normalizedNext = next == null ? null : String(next);
  return normalizedCurrent !== normalizedNext;
};

const backfillTable = async ({ name, selectSql, buildNextValues, updateSql }) => {
  const result = await pool.query(selectSql);
  let updated = 0;

  for (const row of result.rows) {
    const next = buildNextValues(row);
    const hasChange = Object.keys(next).some((key) => valuesChanged(row[key], next[key]));

    if (!hasChange) continue;

    await pool.query(updateSql, [...Object.values(next), row.id]);
    updated += 1;
  }

  console.log(`[refresh] ${name}: scanned ${result.rows.length}, updated ${updated}`);
  return { scanned: result.rows.length, updated };
};

const main = async () => {
  console.log('[refresh] Starting telecom data refresh...');

  try {
    await pool.query('BEGIN');

    const cdr = await backfillTable({
      name: 'cdr_records',
      selectSql: `
        SELECT id, call_date, call_time, date_time
        FROM cdr_records
      `,
      buildNextValues: normalizeCdrRow,
      updateSql: `
        UPDATE cdr_records
        SET call_date = $1,
            call_time = $2,
            date_time = $3
        WHERE id = $4
      `,
    });

    const ild = await backfillTable({
      name: 'ild_records',
      selectSql: `
        SELECT id, call_date, call_time, date_time
        FROM ild_records
      `,
      buildNextValues: normalizeIldRow,
      updateSql: `
        UPDATE ild_records
        SET call_date = $1,
            call_time = $2,
            date_time = $3
        WHERE id = $4
      `,
    });

    const tower = await backfillTable({
      name: 'tower_dump_records',
      selectSql: `
        SELECT id, call_date, call_time, start_time
        FROM tower_dump_records
      `,
      buildNextValues: normalizeTowerRow,
      updateSql: `
        UPDATE tower_dump_records
        SET call_date = $1,
            call_time = $2,
            start_time = $3
        WHERE id = $4
      `,
    });

    const ipdr = await backfillTable({
      name: 'ipdr_records',
      selectSql: `
        SELECT id, start_time, end_time
        FROM ipdr_records
      `,
      buildNextValues: normalizeIpdrRow,
      updateSql: `
        UPDATE ipdr_records
        SET start_time = $1,
            end_time = $2
        WHERE id = $3
      `,
    });

    await pool.query('COMMIT');
    console.log('[refresh] Telecom data refresh complete.');
    console.log(
      JSON.stringify(
        {
          cdr,
          ild,
          tower,
          ipdr,
        },
        null,
        2
      )
    );
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('[refresh] Telecom data refresh failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

await main();
