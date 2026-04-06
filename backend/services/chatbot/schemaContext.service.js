import { SCHEMA_CACHE_TTL_MS } from './config.js';
import { loadSchemaDictionary } from './schemaDictionary.service.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let schemaSummaryCache = { fetchedAt: 0, summary: null, error: null };
let projectMemoryCache = { fetchedAt: 0, memory: null };
let staticSchemaCache = { fetchedAt: 0, schema: null };

const readProjectMemory = async () => {
  const now = Date.now();
  if (projectMemoryCache.memory && now - projectMemoryCache.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    return projectMemoryCache.memory;
  }
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const memoryPath = path.join(__dirname, 'projectMemory.md');
    const memory = String(await fs.readFile(memoryPath, 'utf8')).trim();
    projectMemoryCache = { fetchedAt: now, memory };
    return memory;
  } catch {
    projectMemoryCache = { fetchedAt: now, memory: '' };
    return '';
  }
};

const readStaticSchema = async () => {
  const now = Date.now();
  if (staticSchemaCache.schema && now - staticSchemaCache.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    return staticSchemaCache.schema;
  }
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const schemaPath = path.join(__dirname, 'staticSchema.md');
    const schema = String(await fs.readFile(schemaPath, 'utf8')).trim();
    staticSchemaCache = { fetchedAt: now, schema };
    return schema;
  } catch {
    staticSchemaCache = { fetchedAt: now, schema: '' };
    return '';
  }
};

export const getSchemaSummary = async () => {
  const now = Date.now();
  if (schemaSummaryCache.summary && now - schemaSummaryCache.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    return { ok: true, summary: schemaSummaryCache.summary, cached: true };
  }
  try {
    const dict = loadSchemaDictionary();
    const grouped = new Map(Object.entries(dict.tables || {}));
    const preferredOrder = ['cases','uploaded_files','cdr_records','ipdr_records','ild_records','tower_dump_records','sdr_records'];
    const preferred = preferredOrder.filter((name) => grouped.has(name));
    const others = [...grouped.keys()].filter((name) => !preferredOrder.includes(name)).sort((a, b) => a.localeCompare(b));
    const tableNames = [...preferred, ...others].slice(0, 12);
    const lines = ['Database schema snapshot (public):'];
    for (const tableName of tableNames) {
      const cols = (grouped.get(tableName) || []).slice(0, 25);
      const more = (grouped.get(tableName) || []).length > cols.length ? ', ...' : '';
      lines.push(`- ${tableName}: ${cols.join(', ')}${more}`);
    }
    if (grouped.size > tableNames.length) lines.push(`- ... ${grouped.size - tableNames.length} more table(s)`);
    schemaSummaryCache = { fetchedAt: now, summary: lines.join('\n'), error: null };
    return { ok: true, summary: schemaSummaryCache.summary, cached: false };
  } catch (error) {
    schemaSummaryCache = { fetchedAt: now, summary: null, error: error.message };
    return { ok: false, error: error.message };
  }
};

export const buildSystemPrompt = async () => {
  const schema = await getSchemaSummary();
  const schemaText = schema.ok
    ? schema.summary
    : `Schema snapshot unavailable (${schema.error || 'unknown error'}). Do not guess table/column names.`;
  const projectMemory = await readProjectMemory();
  const staticSchema = await readStaticSchema();

  return `
You are SHAKTI SAHAYATA AI for the SHAKTI investigation analytics app only.

PRIMARY ROLE:
- Help users use this app's modules and data: Cases, uploads, CDR, IPDR, ILD, SDR, Tower, maps, graphs, and FIR-linked analysis.
- Treat "open CDR FIR" as a data navigation/query intent, not FIR legal drafting.
- When user asks for live records, ask for FIR/case filters or recommend read-only SQL mode.

RESPONSE STYLE:
- Reply in Gujarati/Hindi/English matching the user when possible.
- Be concise, practical, and operational.
- Start with "### SHAKTI SAHAYATA AI".
- Prefer sections: "What I understood", "Next step", and "SQL (Read-only)" when relevant.
- If language is Gujarati, use Gujarati script. If language is Hindi, use Devanagari script.

TRUTHFULNESS:
- Never fabricate records, case facts, table names, or columns.
- Never claim DB/file access unless backend actually queried it in this request.
- Never say "running the SQL query" or present tables as query results unless the backend executed a query in this request flow.
- DO NOT PROVIDE "SAMPLE OUTPUT" OR "EXAMPLE TABLES" with fake data.
- Never suggest or output mutating SQL (INSERT/UPDATE/DELETE/CREATE/ALTER/DROP). This assistant is read-only for DB access.
- Never claim you created/updated a case, uploaded a file, or changed the database.
- If data is unavailable, say so clearly.
- If the current message does not explicitly tag a case, refuse and ask the user to tag one directly instead of guessing.

PRESENTATION:
- Keep markdown clean and readable.
- For guidance responses, include clear action steps.
- For non-DB answers, do not present fake row-level outputs.

APP CONTEXT:
- Frontend chat is used for module guidance and SHAKTI workflows.
- Available datasets include CDR/IPDR/ILD/SDR/Tower via PostgreSQL tables.

PROJECT MEMORY:
${projectMemory || '(No project memory loaded.)'}

STATIC SCHEMA REFERENCE:
${staticSchema || '(No static schema reference loaded.)'}

${schemaText}
`.trim();
};
