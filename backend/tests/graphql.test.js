import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn(async (sql) => {
  const text = String(sql);

  if (text.includes('FROM cases c') && text.includes('SELECT') && text.includes('file_count')) {
    return {
      rows: [
        {
          id: 41,
          case_name: 'Alpha Case',
          case_number: 'CASE-41',
          status: 'open',
          priority: 'high',
          updated_at: '2026-04-09T08:00:00.000Z',
          owner_name: 'Officer One',
          file_count: 3,
        },
      ],
      rowCount: 1,
    };
  }

  if (text.includes('uploads_today') && text.includes('failed_parse_files') && text.includes('active_admin_sessions')) {
    return {
      rows: [
        {
          open_cases: 6,
          uploads_today: 4,
          failed_parse_files: 1,
          failed_jobs: 2,
          active_admin_sessions: 1,
        },
      ],
      rowCount: 1,
    };
  }

  return { rows: [], rowCount: 0 };
});

vi.mock('../config/database.js', () => ({
  default: {
    query: queryMock,
    on: vi.fn(),
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
  },
}));

vi.mock('../middleware/rateLimit.js', () => ({
  rateLimit: (_req, _res, next) => next(),
  authRateLimit: (_req, _res, next) => next(),
  adminAuthRateLimit: (_req, _res, next) => next(),
}));

vi.mock('../middleware/auditLogger.js', () => ({
  auditLogger: (_req, _res, next) => next(),
}));

vi.mock('../services/runtimeStatus.service.js', () => ({
  getLiveHealth: () => ({ status: 'alive', timestamp: '2026-04-09T09:00:00.000Z', service: 'shakti-backend' }),
  getReadyHealth: () => ({
    status: 'ready',
    timestamp: '2026-04-09T09:00:00.000Z',
    service: 'shakti-backend',
    summary: { failed: [], degraded: [] },
  }),
  getStartupStatus: () => ({
    status: 'ready',
    timestamp: '2026-04-09T09:00:00.000Z',
    service: 'shakti-backend',
    summary: { failed: [], degraded: ['backups'] },
  }),
}));

vi.mock('../services/chatbot/ollama.service.js', () => ({
  isOllamaAvailable: vi.fn(async () => true),
}));

vi.mock('../services/chatbot/config.js', () => ({
  CHATBOT_MAX_MESSAGE_LENGTH: 2000,
  OLLAMA_MODEL: 'phi3.5',
  getOllamaRuntimeConfig: () => ({ baseUrl: 'http://localhost:11434', model: 'phi3.5', source: 'test' }),
}));

const { createApp } = await import('../app.js');
const app = createApp();

const createOfficerToken = () =>
  jwt.sign(
    {
      userId: 11,
      buckleId: 'BK-1100',
      email: 'officer.one@police.gov.in',
      fullName: 'Officer One',
      role: 'investigator',
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' },
  );

const createAdminToken = () =>
  jwt.sign(
    {
      adminId: 101,
      email: 'it.admin@police.gov.in',
      fullName: 'IT Admin',
      role: 'it_admin',
      permissions: ['console_access'],
      accountType: 'it_admin',
      sessionId: 'sess-admin-1',
      recentAuthAt: Math.floor(Date.now() / 1000),
    },
    process.env.JWT_ADMIN_SECRET,
    { audience: 'admin-console', expiresIn: '10m', subject: '101' },
  );

describe('graphql route', () => {
  it('returns public health data without authentication', async () => {
    const response = await request(app)
      .post('/graphql')
      .send({ query: '{ health { status service } }' });

    expect(response.status).toBe(200);
    expect(response.body.data.health.status).toBe('ready');
    expect(response.body.data.health.service).toBe('shakti-backend');
  });

  it('returns a case summary for an authenticated investigator', async () => {
    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${createOfficerToken()}`)
      .send({ query: '{ case(caseId: 41) { caseName caseNumber status fileCount ownerName } }' });

    expect(response.status).toBe(200);
    expect(response.body.data.case.caseName).toBe('Alpha Case');
    expect(response.body.data.case.fileCount).toBe(3);
  });

  it('blocks admin workspace summary without an admin token', async () => {
    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${createOfficerToken()}`)
      .send({ query: '{ adminWorkspaceSummary { openCases failedJobs } }' });

    expect(response.status).toBe(403);
    expect(response.body.errors[0].message).toContain('Admin access token required');
  });

  it('returns admin workspace summary for an authenticated admin', async () => {
    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${createAdminToken()}`)
      .send({ query: '{ adminWorkspaceSummary { openCases uploadsToday failedParseFiles failedJobs activeAdminSessions } }' });

    expect(response.status).toBe(200);
    expect(response.body.data.adminWorkspaceSummary.openCases).toBe(6);
    expect(response.body.data.adminWorkspaceSummary.failedJobs).toBe(2);
  });
});
