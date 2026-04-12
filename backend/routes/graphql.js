import { Router } from 'express';
import { GraphQLError, buildSchema, graphql } from 'graphql';
import pool from '../config/database.js';
import { verifyAccessToken } from '../config/auth.js';
import { verifyAdminAccessToken } from '../config/adminAuth.js';
import { verifySupabaseAccessToken } from '../config/supabase.js';
import { getAdminProfileByAuthUserId, getOfficerProfileByAuthUserId } from '../services/auth/authIdentity.service.js';
import { getLiveHealth, getReadyHealth, getStartupStatus } from '../services/runtimeStatus.service.js';

const router = Router();

const schema = buildSchema(`
  type HealthSnapshot {
    status: String!
    service: String
    timestamp: String
    failed: [String!]!
    degraded: [String!]!
  }

  type CaseSummary {
    id: Int!
    caseName: String!
    caseNumber: String!
    status: String!
    priority: String!
    updatedAt: String!
    fileCount: Int!
    ownerName: String
  }

  type AdminWorkspaceSummary {
    generatedAt: String!
    openCases: Int!
    uploadsToday: Int!
    failedParseFiles: Int!
    failedJobs: Int!
    activeAdminSessions: Int!
  }

  type Query {
    health: HealthSnapshot!
    liveHealth: HealthSnapshot!
    startupStatus: HealthSnapshot!
    case(caseId: Int!): CaseSummary
    adminWorkspaceSummary: AdminWorkspaceSummary!
  }
`);

const toHealthSnapshot = (payload = {}) => ({
  status: payload.status || 'unknown',
  service: payload.service || 'shakti-backend',
  timestamp: payload.timestamp || new Date().toISOString(),
  failed: Array.isArray(payload.summary?.failed) ? payload.summary.failed : [],
  degraded: Array.isArray(payload.summary?.degraded) ? payload.summary.degraded : [],
});

const buildGraphqlContext = async (req) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return { user: null, admin: null };
  }

  try {
    return { user: verifyAccessToken(token), admin: null };
  } catch {
    // continue to admin token verification
  }

  try {
    const admin = verifyAdminAccessToken(token);
    return {
      user: null,
      admin: admin?.accountType === 'it_admin' ? admin : null,
    };
  } catch {
    // continue to Supabase token verification
  }

  try {
    const claims = await verifySupabaseAccessToken(token);
    const [user, admin] = await Promise.all([
      getOfficerProfileByAuthUserId(claims.sub),
      getAdminProfileByAuthUserId(claims.sub),
    ]);

    return {
      user: user ? { userId: user.id, role: user.role, buckleId: user.buckle_id } : null,
      admin: admin ? { adminId: admin.id, role: admin.role, accountType: admin.role } : null,
    };
  } catch {
    return { user: null, admin: null };
  }
};

const requireAuthenticatedInvestigator = (context) => {
  if (!context.user && !context.admin) {
    throw new GraphQLError('Authentication required for case access.', {
      extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
    });
  }
};

const requireAuthenticatedAdmin = (context) => {
  if (!context.admin) {
    throw new GraphQLError('Admin access token required for admin workspace data.', {
      extensions: { code: 'FORBIDDEN', http: { status: 403 } },
    });
  }
};

const rootValue = {
  health: () => toHealthSnapshot(getReadyHealth()),
  liveHealth: () => toHealthSnapshot(getLiveHealth()),
  startupStatus: () => toHealthSnapshot(getStartupStatus()),
  case: async ({ caseId }, context) => {
    requireAuthenticatedInvestigator(context);

    const result = await pool.query(
      `
        SELECT
          c.id,
          c.case_name,
          c.case_number,
          c.status,
          c.priority,
          c.updated_at,
          COALESCE(owner_user.full_name, creator.full_name, 'Unknown owner') AS owner_name,
          (
            SELECT COUNT(*)::int
            FROM uploaded_files uf
            WHERE uf.case_id = c.id
          ) AS file_count
        FROM cases c
        LEFT JOIN users creator ON creator.id = c.created_by_user_id
        LEFT JOIN LATERAL (
          SELECT u.full_name
          FROM case_assignments ca
          JOIN users u ON u.id = ca.user_id
          WHERE ca.case_id = c.id
            AND ca.role = 'owner'
            AND ca.is_active = TRUE
          ORDER BY ca.assigned_at DESC
          LIMIT 1
        ) owner_user ON TRUE
        WHERE c.id = $1
        LIMIT 1
      `,
      [caseId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      caseName: row.case_name,
      caseNumber: row.case_number,
      status: row.status,
      priority: row.priority,
      updatedAt: row.updated_at,
      fileCount: Number(row.file_count || 0),
      ownerName: row.owner_name || null,
    };
  },
  adminWorkspaceSummary: async (_args, context) => {
    requireAuthenticatedAdmin(context);

    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM cases WHERE status IN ('open', 'active')) AS open_cases,
        (SELECT COUNT(*)::int FROM uploaded_files WHERE uploaded_at >= CURRENT_DATE) AS uploads_today,
        (SELECT COUNT(*)::int FROM uploaded_files WHERE parse_status = 'failed') AS failed_parse_files,
        (
          SELECT COUNT(*)::int
          FROM ingestion_jobs
          WHERE status IN ('failed', 'partial_success', 'quarantined', 'mismatched', 'cancelled')
        ) AS failed_jobs,
        (SELECT COUNT(*)::int FROM admin_sessions WHERE ended_at IS NULL) AS active_admin_sessions
    `);

    const row = result.rows[0] || {};
    return {
      generatedAt: new Date().toISOString(),
      openCases: Number(row.open_cases || 0),
      uploadsToday: Number(row.uploads_today || 0),
      failedParseFiles: Number(row.failed_parse_files || 0),
      failedJobs: Number(row.failed_jobs || 0),
      activeAdminSessions: Number(row.active_admin_sessions || 0),
    };
  },
};

const explorerHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SHAKTI GraphQL Explorer</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0b1220; color: #e5eefc; }
      main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 48px; }
      h1 { margin: 0 0 8px; font-size: 28px; }
      p { color: #94a3b8; line-height: 1.6; }
      textarea, pre { width: 100%; box-sizing: border-box; border-radius: 14px; border: 1px solid rgba(148,163,184,.24); background: #0f172a; color: #e2e8f0; }
      textarea { min-height: 240px; padding: 16px; font: 14px/1.5 ui-monospace, SFMono-Regular, monospace; }
      pre { min-height: 280px; padding: 16px; overflow: auto; white-space: pre-wrap; }
      button { margin-top: 16px; border: 0; border-radius: 999px; padding: 12px 18px; background: #2563eb; color: white; font-weight: 600; cursor: pointer; }
      code { background: rgba(37,99,235,.12); padding: 2px 6px; border-radius: 999px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-top: 24px; }
    </style>
  </head>
  <body>
    <main>
      <h1>SHAKTI GraphQL Explorer</h1>
      <p>Use a bearer token in your browser or API client for authenticated fields. Public health queries work without auth.</p>
      <div class="grid">
        <div>
          <textarea id="query">{ health { status service timestamp } }</textarea>
          <button id="run">Run Query</button>
        </div>
        <pre id="result">Results will appear here.</pre>
      </div>
      <p>Example authenticated queries: <code>{ case(caseId: 1) { caseName status fileCount } }</code> and <code>{ adminWorkspaceSummary { openCases failedJobs } }</code>.</p>
    </main>
    <script>
      const queryEl = document.getElementById('query');
      const resultEl = document.getElementById('result');
      document.getElementById('run').addEventListener('click', async () => {
        resultEl.textContent = 'Running query...';
        try {
          const response = await fetch(window.location.pathname, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: queryEl.value })
          });
          resultEl.textContent = JSON.stringify(await response.json(), null, 2);
        } catch (error) {
          resultEl.textContent = String(error);
        }
      });
    </script>
  </body>
</html>`;

const parseGraphqlVariables = (value) => {
  if (!value) return undefined;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return undefined;
  }
};

const executeGraphqlRequest = async (req, res) => {
  const query = req.method === 'GET' ? String(req.query.query || '').trim() : String(req.body?.query || '').trim();
  if (!query) {
    return res.status(400).json({ errors: [{ message: 'GraphQL query is required.' }] });
  }

  const contextValue = await buildGraphqlContext(req);
  const variableValues = req.method === 'GET'
    ? parseGraphqlVariables(req.query.variables)
    : parseGraphqlVariables(req.body?.variables);
  const operationName = req.method === 'GET'
    ? String(req.query.operationName || '').trim() || undefined
    : String(req.body?.operationName || '').trim() || undefined;

  const result = await graphql({
    schema,
    source: query,
    rootValue,
    contextValue,
    variableValues,
    operationName,
  });

  const explicitStatus = result.errors?.find((error) => Number(error.extensions?.http?.status))
    ? Number(result.errors.find((error) => Number(error.extensions?.http?.status))?.extensions?.http?.status)
    : null;
  const status = explicitStatus || (result.errors?.length ? 400 : 200);

  return res.status(status).json(result);
};

router.get('/', async (req, res) => {
  if (process.env.NODE_ENV !== 'production' && !req.query.query) {
    return res.type('html').send(explorerHtml());
  }

  return executeGraphqlRequest(req, res);
});

router.post('/', async (req, res) => executeGraphqlRequest(req, res));

export default router;
