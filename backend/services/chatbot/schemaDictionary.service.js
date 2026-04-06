import fs from 'node:fs';
import path from 'node:path';

let cached = null;
let cachedAt = 0;

const SCHEMA_PATH = path.resolve(process.cwd(), 'database', 'schema.sql');

const stripQuotes = (name) => String(name || '').replaceAll(/^"+|"+$/g, '');

export const loadSchemaDictionary = () => {
  const now = Date.now();
  if (cached && now - cachedAt < 5 * 60 * 1000) return cached;

  let sql = '';
  try {
    sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  } catch {
    cached = { tables: {}, tableNames: [] };
    cachedAt = now;
    return cached;
  }

  const tables = {};
  const createTableRe =
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([\w"]+)\s*\(([\s\S]*?)\)\s*;/gi;
  let match;
  while ((match = createTableRe.exec(sql))) {
    const rawTable = stripQuotes(match[1]);
    const body = match[2] || '';
    const cols = [];

    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('--')) continue;
      if (/^(primary|foreign|unique|constraint)\b/i.test(trimmed)) continue;

      const colRe = /^([\w"]+)\s+(\w+)/;
      const colMatch = colRe.exec(trimmed);
      if (!colMatch) continue;
      const colName = stripQuotes(colMatch[1]).replace(/,$/, '');
      if (!colName) continue;
      cols.push(colName);
    }

    if (rawTable) tables[rawTable] = Array.from(new Set(cols));
  }

  cached = { tables, tableNames: Object.keys(tables).sort((a, b) => a.localeCompare(b)) };
  cachedAt = now;
  return cached;
};

export const getAllowedTableNames = () => loadSchemaDictionary().tableNames;
