import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn(async (sql) => {
  const text = String(sql);

  if (text.includes('totp_secret_configured') && text.includes('FROM admin_accounts')) {
    return {
      rows: [{ role: 'it_admin', totp_enabled: false, totp_secret_configured: false }],
      rowCount: 1,
    };
  }

  if (text.includes('files_uploaded_today') && text.includes('retried_jobs')) {
    return {
      rows: [
        {
          files_uploaded_today: 2,
          pending_parsing: 0,
          parsing_in_progress: 0,
          validation_failures: 0,
          normalization_queued: 0,
          successful_ingestions: 2,
          retried_jobs: 0,
        },
      ],
      rowCount: 1,
    };
  }

  if (text.includes('uf.id AS upload_id') && text.includes('latest_job.id AS normalization_job_id')) {
    expect(text).toContain('ij.file_id = uf.id');
    return {
      rows: [
        {
          upload_id: 72,
          file_name: 'cdr.csv',
          case_id: 41,
          case_name: 'Current Case',
          case_number: 'CASE-41',
          file_type: 'cdr',
          source: 'cdr',
          uploaded_by: 'Officer One',
          uploaded_at: '2026-04-09T10:00:00.000Z',
          parse_status: 'completed',
          normalization_job_id: 'job-current',
          normalization_status: 'completed',
          extracted_records: 118,
          error_summary: null,
          parser_version: '2.1.0',
          normalizer_version: '2.1.0',
          file_checksum: 'checksum-current',
          storage_path: '/app/uploads/72-cdr.csv',
          size_bytes: 2048,
          rejected_rows: 0,
          retry_count: 1,
          classification_result: 'ACCEPTED',
          status: 'completed',
        },
      ],
      rowCount: 1,
    };
  }

  if (text.includes("DATE_TRUNC('day', uploaded_at) AS bucket")) {
    return { rows: [], rowCount: 0 };
  }

  if (text.includes('failureBySource') || (text.includes('FROM ingestion_jobs') && text.includes("status IN ('failed', 'quarantined', 'mismatched')"))) {
    return { rows: [], rowCount: 0 };
  }

  if (text.includes('total_files') && text.includes('retention_expiring_assets')) {
    expect(text).toContain('ij.file_id = uf.id');
    return {
      rows: [
        {
          total_files: 3,
          total_storage_bytes: 4096,
          recent_uploads: 2,
          orphaned_files: 0,
          flagged_files: 0,
          retention_expiring_assets: 0,
        },
      ],
      rowCount: 1,
    };
  }

  if (text.includes('COALESCE(fc.detected_type, fc.expected_type, uf.file_type, \'unknown\') AS label')) {
    return { rows: [{ label: 'cdr', value: 3 }], rowCount: 1 };
  }

  if (text.includes('uf.id AS file_id') && text.includes('ij.id AS linked_job_id')) {
    expect(text).toContain('ij.file_id = uf.id');
    return {
      rows: [
        {
          file_id: 72,
          file_name: 'cdr.csv',
          linked_case_id: 41,
          linked_case_name: 'Current Case',
          linked_case_number: 'CASE-41',
          file_type: 'cdr',
          size_bytes: 2048,
          uploaded_by: 'Officer One',
          uploaded_at: '2026-04-09T10:00:00.000Z',
          checksum: 'checksum-current',
          retention_status: 'standard',
          integrity_status: 'verified',
          malware_scan_status: 'clean',
          linked_job_id: 'job-current',
          storage_path: '/app/uploads/72-cdr.csv',
          legal_hold: false,
          quarantined: false,
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
  getLiveHealth: () => ({ status: 'alive', timestamp: '2026-04-09T10:00:00.000Z', service: 'shakti-backend' }),
  getReadyHealth: () => ({ status: 'ready', timestamp: '2026-04-09T10:00:00.000Z', service: 'shakti-backend', summary: { failed: [], degraded: [] } }),
  getStartupStatus: () => ({ status: 'ready', timestamp: '2026-04-09T10:00:00.000Z', service: 'shakti-backend', summary: { failed: [], degraded: [] } }),
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

describe('admin workspace freshness', () => {
  beforeEach(() => {
    queryMock.mockClear();
  });

  it('uses file-linked job metadata for ingestion workspace rows', async () => {
    const response = await request(app)
      .get('/api/admin/ops/ingestion')
      .set('Authorization', `Bearer ${createAdminToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.items[0].uploadId).toBe(72);
    expect(response.body.items[0].normalizationJobId).toBe('job-current');
    expect(response.body.items[0].caseName).toBe('Current Case');
  });

  it('uses file-linked job metadata for storage workspace rows', async () => {
    const response = await request(app)
      .get('/api/admin/ops/storage')
      .set('Authorization', `Bearer ${createAdminToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.items[0].fileId).toBe(72);
    expect(response.body.items[0].linkedJobId).toBe('job-current');
    expect(response.body.items[0].linkedCaseName).toBe('Current Case');
  });
});
